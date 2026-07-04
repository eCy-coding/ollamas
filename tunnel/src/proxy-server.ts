// vT12: gateway IO shell — thin node:http/https wrapper around the pure core (proxy.ts).
// Streams request/response bodies with pipe() and never buffers (SSE-safe by construction).
//
// Order of gates per request: route(404) → public-health bypass → auth(401, BEFORE body read)
// → ratelimit(429) → forward. Upstream failure → generic 502 (no errno/url leak).
// Access log: secret-free JSONL (RISK-TUNNEL-025) + size rotation reuse (logrotate.ts).

import { createServer as createHttpServer, request as httpRequest, Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { appendFileSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { routeRequest, authorize, rewriteHeaders, UPSTREAMS, type PxyKeyRecord, type Target } from "./proxy.ts";
import { rotateIfNeeded } from "./logrotate.ts";
import { HEALTH_PATH } from "./health.ts";

export interface GatewayConfig {
  /** 0 = ephemeral (tests). Production default set by CLI (8443). */
  port: number;
  /** mkcert cert for LAN/mesh TLS; absent when running behind cloudflared (loopback HTTP). */
  tls?: { certPath: string; keyPath: string };
  keys: PxyKeyRecord[];
  limiter: (key: string) => boolean;
  /** Test override only; defaults to the hard-pinned loopback UPSTREAMS. */
  upstreams?: Record<Target, string>;
  accessLogPath?: string;
}

export interface Gateway {
  listen(): Promise<number>;
  close(): Promise<void>;
}

function deny(res: ServerResponse, status: number, msg: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
}

export function createGateway(cfg: GatewayConfig): Gateway {
  const upstreams = cfg.upstreams ?? UPSTREAMS;

  const logLine = (entry: Record<string, unknown>): void => {
    if (!cfg.accessLogPath) return;
    try {
      rotateIfNeeded(cfg.accessLogPath);
      appendFileSync(cfg.accessLogPath, JSON.stringify(entry) + "\n");
    } catch {
      // logging must never break serving (graceful-degrade, keystore N-013 lesson)
    }
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const started = Date.now();
    const rawUrl = req.url ?? "/";
    const pathname = rawUrl.split("?")[0] ?? "/";
    const search = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";

    let keyPrefix = "-";
    const finishLog = (status: number, bytes: number): void => {
      logLine({
        ts: new Date(started).toISOString(),
        keyPrefix,
        method: req.method ?? "-",
        path: pathname,
        status,
        ms: Date.now() - started,
        bytes,
      });
    };

    const routed = routeRequest(pathname);
    if (routed === null) {
      deny(res, 404, "not found");
      finishLog(404, 0);
      return;
    }

    // Public probe path: /api/health only (autopilot/doctor/transports probe unauthenticated).
    const isPublicHealth = pathname === HEALTH_PATH && req.method === "GET";
    if (!isPublicHealth) {
      // Try BOTH carriers: authorization may hold the upstream olm_ token (forwarded
      // untouched) while the gateway pxy_ key travels in x-proxy-key — either may match.
      const candidates = [req.headers["authorization"], req.headers["x-proxy-key"]].filter(
        (v): v is string => typeof v === "string",
      );
      let auth: ReturnType<typeof authorize> = { ok: false };
      for (const c of candidates) {
        auth = authorize(c, cfg.keys);
        if (auth.ok) break;
      }
      if (!auth.ok) {
        deny(res, 401, "unauthorized"); // before any body read
        req.resume(); // drain politely, we never parse it
        finishLog(401, 0);
        return;
      }
      keyPrefix = auth.keyPrefix;
      if (!cfg.limiter(keyPrefix)) {
        deny(res, 429, "rate limited");
        req.resume();
        finishLog(429, 0);
        return;
      }
    }

    const upstreamBase = upstreams[routed.target];
    const target = new URL(upstreamBase);
    const headers = rewriteHeaders(req.headers, routed.target);

    const up = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: pathname + search,
        headers: headers as Record<string, string | string[]>,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        let bytes = 0;
        upRes.on("data", (c: Buffer) => (bytes += c.length));
        upRes.pipe(res); // stream through — no buffering, SSE chunks flush as they arrive
        upRes.on("end", () => finishLog(upRes.statusCode ?? 502, bytes));
      },
    );
    up.on("error", () => {
      if (!res.headersSent) deny(res, 502, "upstream unavailable"); // generic: no errno/url
      else res.destroy();
      finishLog(502, 0);
    });
    req.pipe(up); // stream request body through untouched
    req.on("error", () => up.destroy());
  };

  let server: Server;
  if (cfg.tls) {
    server = createHttpsServer(
      { cert: readFileSync(cfg.tls.certPath), key: readFileSync(cfg.tls.keyPath) },
      handler,
    ) as unknown as Server;
  } else {
    server = createHttpServer(handler);
  }
  // Long-lived streams (SSE/chat): disable per-request timeout; keep header timeout sane.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;

  return {
    listen(): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(cfg.port, "0.0.0.0", () => {
          const addr = server.address();
          if (addr === null || typeof addr === "string") return reject(new Error("no address"));
          resolve(addr.port);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
