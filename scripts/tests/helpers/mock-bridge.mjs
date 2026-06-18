// In-memory mock of the host terminal-bridge for tests. Mirrors the real
// auth path (bin/host-bridge/hmac.mjs verifyHmacHeaders) and the /health /run
// /exec /write endpoint shapes, but never drives a real terminal. NOT a *.test.
// file, so vitest does not collect it as a suite.
import http from "node:http";
import { verifyHmacHeaders } from "../../../bin/host-bridge/hmac.mjs";

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

/**
 * Start a mock bridge. Returns { port, url, close, requests }.
 * If `secret` is set, POST routes require a valid HMAC (real verify logic).
 */
export async function startMockBridge({ secret = "" } = {}) {
  const seenNonces = new Set();
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body);
    };

    if (req.method === "GET" && url.pathname === "/health") {
      return send(200, { ok: true, service: "mock-terminal-bridge", tokenRequired: !!secret });
    }

    if (req.method === "POST" && ["/run", "/exec", "/write"].includes(url.pathname)) {
      const raw = await readBody(req);
      requests.push({ path: url.pathname, raw });
      if (secret) {
        const ok = verifyHmacHeaders(secret, {
          method: "POST",
          path: url.pathname,
          body: raw,
          signature: req.headers["x-bridge-signature"],
          timestamp: req.headers["x-bridge-timestamp"],
          nonce: req.headers["x-bridge-nonce"],
        }, seenNonces);
        if (!ok) return send(401, { ok: false, error: "bad auth" });
      }
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/write") return send(200, { ok: true, path: body.path, bytes: 0 });
      return send(200, { ok: true, target: body.target ?? null, exitCode: 0, output: "mocked", durationMs: 1 });
    }

    return send(404, { ok: false, error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
