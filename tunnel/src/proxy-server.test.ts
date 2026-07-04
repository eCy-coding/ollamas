// vT12: gateway IO shell — real localhost sockets (ephemeral ports) prove
// auth/ratelimit/routing/streaming end-to-end without mocks (ERR-TUNNEL-003 lesson:
// fake-fetch unit tests can pass while the real path is broken).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createGateway, type Gateway } from "./proxy-server.ts";
import { addKey, type PxyVault } from "./proxy.ts";
import { createLimiter } from "./ratelimit.ts";

// ---------- helpers ----------

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startStub(handler: Handler): Promise<{ server: Server; url: string; port: number }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no addr");
  return { server, url: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

function makeVault(): { vault: PxyVault; raw: string } {
  return addKey({ keys: [] }, "test", "ab".repeat(16));
}

interface GwCtx {
  gw: Gateway;
  base: string;
  raw: string;
  stubs: Server[];
}

/** Gateway wired to one stub serving BOTH targets (separate stubs where a test needs them). */
async function startGateway(
  handler: Handler,
  opts: { limiter?: (k: string) => boolean } = {},
): Promise<GwCtx> {
  const stub = await startStub(handler);
  const { vault, raw } = makeVault();
  const gw = createGateway({
    port: 0,
    keys: vault.keys,
    limiter: opts.limiter ?? createLimiter({ capacity: 1000, ratePerSec: 1000 }),
    upstreams: { ollamas: stub.url, ollama: stub.url },
  });
  const port = await gw.listen();
  return { gw, base: `http://127.0.0.1:${port}`, raw, stubs: [stub.server] };
}

async function stop(ctx: GwCtx): Promise<void> {
  await ctx.gw.close();
  for (const s of ctx.stubs) s.close();
}

const okHandler: Handler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
};

// ---------- auth ----------

test("gateway: 401 without key on non-health path", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/api/agent/chat`, { method: "POST", body: "{}" });
    assert.equal(r.status, 401);
  } finally {
    await stop(ctx);
  }
});

test("gateway: 401 with bad key", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/v1/models`, {
      headers: { authorization: "Bearer pxy_deadbeefdeadbeefdeadbeefdeadbeef" },
    });
    assert.equal(r.status, 401);
  } finally {
    await stop(ctx);
  }
});

test("gateway: 200 with valid key, proxied body intact", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/v1/models`, {
      headers: { authorization: `Bearer ${ctx.raw}` },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    await stop(ctx);
  }
});

test("gateway: /api/health public (no key) — probe path for autopilot/doctor", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/api/health`);
    assert.equal(r.status, 200);
  } finally {
    await stop(ctx);
  }
});

test("gateway: X-Proxy-Key header also authorizes", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/v1/models`, { headers: { "x-proxy-key": ctx.raw } });
    assert.equal(r.status, 200);
  } finally {
    await stop(ctx);
  }
});

// ---------- routing / limits ----------

test("gateway: 404 for non-allowlisted path (even with key)", async () => {
  const ctx = await startGateway(okHandler);
  try {
    const r = await fetch(`${ctx.base}/admin/secrets`, {
      headers: { authorization: `Bearer ${ctx.raw}` },
    });
    assert.equal(r.status, 404);
  } finally {
    await stop(ctx);
  }
});

test("gateway: 429 when limiter denies", async () => {
  const ctx = await startGateway(okHandler, { limiter: () => false });
  try {
    const r = await fetch(`${ctx.base}/v1/models`, {
      headers: { authorization: `Bearer ${ctx.raw}` },
    });
    assert.equal(r.status, 429);
  } finally {
    await stop(ctx);
  }
});

test("gateway: 502 generic body when upstream down (no internal detail leak)", async () => {
  const stub = await startStub(okHandler);
  stub.server.close(); // free the port → upstream dead
  await once(stub.server, "close");
  const { vault, raw } = makeVault();
  const gw = createGateway({
    port: 0,
    keys: vault.keys,
    limiter: createLimiter({ capacity: 100, ratePerSec: 100 }),
    upstreams: { ollamas: stub.url, ollama: stub.url },
  });
  const port = await gw.listen();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${raw}` },
    });
    assert.equal(r.status, 502);
    const body = await r.text();
    assert.ok(!body.includes("ECONNREFUSED"), "must not leak errno");
    assert.ok(!body.includes(stub.url), "must not leak upstream url");
  } finally {
    await gw.close();
  }
});

// ---------- header rewrite observed by upstream ----------

test("gateway: upstream sees rewritten host + preserved authorization", async () => {
  let seenHost = "";
  let seenAuth = "";
  let seenXff: string | undefined = "sentinel";
  const ctx = await startGateway((req, res) => {
    seenHost = req.headers.host ?? "";
    seenAuth = req.headers.authorization ?? "";
    seenXff = req.headers["x-forwarded-for"] as string | undefined;
    okHandler(req, res);
  });
  try {
    const r = await fetch(`${ctx.base}/api/agent/chat`, {
      headers: {
        "x-proxy-key": ctx.raw,
        authorization: "Bearer olm_upstream",
        "x-forwarded-for": "6.6.6.6",
      },
    });
    assert.equal(r.status, 200);
    assert.equal(seenHost, "localhost:3000"); // ollamas /mcp allowlist requirement
    assert.equal(seenAuth, "Bearer olm_upstream"); // untouched passthrough
    assert.equal(seenXff, undefined); // inbound spoof stripped
  } finally {
    await stop(ctx);
  }
});

// ---------- streaming ----------

test("gateway: SSE chunks pass through incrementally (no buffering)", async () => {
  let sendNext: () => void = () => {
    throw new Error("upstream handler not reached");
  };
  const ctx = await startGateway((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    // chunk 2/3 released only when the test confirms chunk 1 arrived
    sendNext = () => {
      res.write("data: two\n\n");
      res.end("data: three\n\n");
    };
  });
  try {
    const r = await fetch(`${ctx.base}/api/agent/chat`, {
      headers: { "x-proxy-key": ctx.raw, accept: "text/event-stream" },
    });
    assert.equal(r.status, 200);
    const reader = r.body?.getReader();
    assert.ok(reader);
    const first = await reader.read(); // resolves ⇒ chunk 1 crossed BEFORE stream end
    assert.match(new TextDecoder().decode(first.value), /data: one/);
    sendNext();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    assert.match(rest, /data: three/);
  } finally {
    await stop(ctx);
  }
});

test("gateway: POST request body piped to upstream intact", async () => {
  let received = "";
  const ctx = await startGateway((req, res) => {
    req.on("data", (c: Buffer) => (received += c.toString()));
    req.on("end", () => okHandler(req, res));
  });
  try {
    const payload = JSON.stringify({ model: "qwen3-coder:30b", messages: [{ role: "user", content: "hi" }] });
    const r = await fetch(`${ctx.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "x-proxy-key": ctx.raw, "content-type": "application/json" },
      body: payload,
    });
    assert.equal(r.status, 200);
    assert.equal(received, payload);
  } finally {
    await stop(ctx);
  }
});

// ---------- access log ----------

test("gateway: access log JSONL is secret-free (prefix only, no raw key)", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pxy-log-"));
  const logPath = join(dir, "access.jsonl");
  const stub = await startStub(okHandler);
  const { vault, raw } = makeVault();
  const gw = createGateway({
    port: 0,
    keys: vault.keys,
    limiter: createLimiter({ capacity: 100, ratePerSec: 100 }),
    upstreams: { ollamas: stub.url, ollama: stub.url },
    accessLogPath: logPath,
  });
  const port = await gw.listen();
  try {
    await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { "x-proxy-key": raw } });
    await gw.close();
    const log = readFileSync(logPath, "utf8");
    assert.ok(!log.includes(raw), "raw key must never hit the log");
    const line = JSON.parse(log.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(line["keyPrefix"], raw.slice(0, 8));
    assert.equal(line["path"], "/v1/models");
    assert.equal(line["status"], 200);
  } finally {
    stub.server.close();
  }
});
