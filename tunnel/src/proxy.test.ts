// vT12: proxy pure core — routing, pxy_ auth, header rewrite, key vault ops.
// All functions PURE (no sockets/disk); vault ops operate on injected objects.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeRequest,
  hashKey,
  authorize,
  rewriteHeaders,
  addKey,
  revokeKey,
  listKeys,
  type PxyVault,
} from "./proxy.ts";

// ---------- routeRequest ----------

test("route: /v1/* → ollama (native OpenAI compat)", () => {
  assert.deepEqual(routeRequest("/v1/chat/completions"), { target: "ollama" });
  assert.deepEqual(routeRequest("/v1/models"), { target: "ollama" });
});

test("route: /mcp and /api/* → ollamas", () => {
  assert.deepEqual(routeRequest("/mcp"), { target: "ollamas" });
  assert.deepEqual(routeRequest("/api/health"), { target: "ollamas" });
  assert.deepEqual(routeRequest("/api/agent/chat"), { target: "ollamas" });
});

test("route: non-allowlisted paths → null (gateway 404)", () => {
  assert.equal(routeRequest("/"), null);
  assert.equal(routeRequest("/etc/passwd"), null);
  assert.equal(routeRequest("/metrics"), null);
  assert.equal(routeRequest("/admin"), null);
  assert.equal(routeRequest("/v1x/steal"), null); // prefix must be a path segment
  assert.equal(routeRequest("/mcpx"), null);
});

test("route: normalizes traversal/duplicate slashes before matching", () => {
  // "/api/../v1/chat" normalizes to "/v1/chat" → routed as ollama, not ollamas
  assert.deepEqual(routeRequest("/api/../v1/chat/completions"), { target: "ollama" });
  assert.deepEqual(routeRequest("//api//health"), { target: "ollamas" });
  // escaping above root or weird schemes → null
  assert.equal(routeRequest("/../../etc/passwd"), null);
});

// ---------- hashKey / authorize ----------

const RAW = "pxy_0123456789abcdef0123456789abcdef";
function vaultWith(raw: string, revoked = false): PxyVault {
  return {
    keys: [{ prefix: raw.slice(0, 8), sha256: hashKey(raw), label: "t", createdAt: "2026-07-04T00:00:00Z", revoked }],
  };
}

test("auth: hashKey is sha256 hex, stable", () => {
  const h = hashKey("abc");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashKey("abc"));
});

test("auth: valid Bearer pxy_ key accepted, returns prefix only", () => {
  const r = authorize(`Bearer ${RAW}`, vaultWith(RAW).keys);
  assert.deepEqual(r, { ok: true, keyPrefix: RAW.slice(0, 8) });
});

test("auth: bare key (X-Proxy-Key style, no Bearer) accepted", () => {
  const r = authorize(RAW, vaultWith(RAW).keys);
  assert.equal(r.ok, true);
});

test("auth: revoked key rejected", () => {
  assert.deepEqual(authorize(`Bearer ${RAW}`, vaultWith(RAW, true).keys), { ok: false });
});

test("auth: wrong key / malformed / empty rejected without throw", () => {
  const keys = vaultWith(RAW).keys;
  assert.deepEqual(authorize("Bearer pxy_wrong", keys), { ok: false });
  assert.deepEqual(authorize("Bearer olm_notproxy", keys), { ok: false });
  assert.deepEqual(authorize("", keys), { ok: false });
  assert.deepEqual(authorize(undefined, keys), { ok: false });
  assert.deepEqual(authorize("Bearer", keys), { ok: false });
});

test("auth: empty key list rejects everything", () => {
  assert.deepEqual(authorize(`Bearer ${RAW}`, []), { ok: false });
});

// ---------- rewriteHeaders ----------

test("rewrite: host+origin forced to upstream localhost (ollamas)", () => {
  const out = rewriteHeaders(
    { host: "abc.trycloudflare.com", origin: "https://abc.trycloudflare.com", accept: "text/event-stream" },
    "ollamas",
  );
  assert.equal(out["host"], "localhost:3000");
  assert.equal(out["origin"], "http://localhost:3000");
  assert.equal(out["accept"], "text/event-stream"); // SSE accept preserved
});

test("rewrite: ollama target gets localhost:11434", () => {
  const out = rewriteHeaders({ host: "x" }, "ollama");
  assert.equal(out["host"], "localhost:11434");
});

test("rewrite: strips inbound x-forwarded-* and x-proxy-key; keeps authorization", () => {
  const out = rewriteHeaders(
    {
      "x-forwarded-for": "1.2.3.4",
      "x-forwarded-host": "evil.example",
      "x-proxy-key": RAW,
      authorization: "Bearer olm_upstreamkey",
    },
    "ollamas",
  );
  assert.equal(out["x-forwarded-for"], undefined);
  assert.equal(out["x-forwarded-host"], undefined);
  assert.equal(out["x-proxy-key"], undefined);
  assert.equal(out["authorization"], "Bearer olm_upstreamkey");
});

test("rewrite: origin absent stays absent (no fabrication)", () => {
  const out = rewriteHeaders({ host: "x" }, "ollamas");
  assert.equal(out["origin"], undefined);
});

// ---------- vault ops ----------

test("vault: addKey returns raw pxy_ key once + stores hash/prefix only", () => {
  const v0: PxyVault = { keys: [] };
  const { vault, raw } = addKey(v0, "iphone", "aa".repeat(16));
  assert.match(raw, /^pxy_[0-9a-f]{32}$/);
  assert.equal(vault.keys.length, 1);
  const k = vault.keys[0];
  assert.ok(k);
  assert.equal(k.label, "iphone");
  assert.equal(k.prefix, raw.slice(0, 8));
  assert.equal(k.sha256, hashKey(raw));
  assert.equal((k as unknown as Record<string, unknown>)["raw"], undefined); // raw never stored
  assert.equal(v0.keys.length, 0); // input not mutated
});

test("vault: authorize accepts a key created by addKey", () => {
  const { vault, raw } = addKey({ keys: [] }, "mac", "bb".repeat(16));
  assert.equal(authorize(`Bearer ${raw}`, vault.keys).ok, true);
});

test("vault: revokeKey by prefix; revoked key stops authorizing", () => {
  const { vault, raw } = addKey({ keys: [] }, "mac", "cc".repeat(16));
  const v2 = revokeKey(vault, raw.slice(0, 8));
  assert.equal(v2.keys[0]?.revoked, true);
  assert.deepEqual(authorize(`Bearer ${raw}`, v2.keys), { ok: false });
});

test("vault: revokeKey unknown prefix throws (explicit, no silent no-op)", () => {
  assert.throws(() => revokeKey({ keys: [] }, "pxy_none"), /prefix/);
});

test("vault: listKeys exposes prefix/label/createdAt/revoked — never sha256", () => {
  const { vault } = addKey({ keys: [] }, "mac", "dd".repeat(16));
  const rows = listKeys(vault);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), ["createdAt", "label", "prefix", "revoked"]);
});
