// server/ecysearcher-proxy.ts — reverse-proxy the eCySearcher threat-intel Flask API under ollamas.
//
// eCySearcher (a separate Python/Flask stack, default http://localhost:5000) has an OPEN REST API
// (no auth). Exposing it straight to the browser would mean CORS + an unguarded surface. Instead the
// cockpit hits ollamas at /api/ecysearcher/* (localOwnerGuard'd in server.ts) → this forwards to the
// Flask API and returns the JSON. So eCySearcher stays reachable ONLY by the local owner, through
// the ollamas choke-point. Graceful 502 when eCySearcher is down — never throws into the request.
import type { Request, Response } from "express";

/** Base URL of the eCySearcher Flask API (remapped host API port, default 5055 — see the lane). */
export function ecyBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ECYSEARCHER_URL) return env.ECYSEARCHER_URL.replace(/\/$/, "");
  const port = env.ECYSEARCHER_API_PORT || "5055";
  return `http://localhost:${port}`;
}

/** Build the upstream URL from the base + the sub-path (express strips the mount prefix into req.url).
 *  Pure → unit-testable. The sub-path already carries the query string. */
export function ecyTargetUrl(base: string, subPath: string): string {
  const b = base.replace(/\/$/, "");
  const p = subPath.startsWith("/") ? subPath : `/${subPath}`;
  return `${b}${p}`;
}

/** Methods whose body we forward. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Structured "eCySearcher is offline" body — a well-formed empty result the cockpit can render
 *  without treating it as an error. Shaped to satisfy every consumer (root probe, search, analytics). */
export function ecyOfflinePayload(): Record<string, unknown> {
  return { offline: true, ready: false, running: false, service: "ecysearcher", results: [], hits: [], total: 0, analytics: null };
}

/** Circuit-breaker middleware factory: when the supervisor reports the stack is NOT running, short-circuit
 *  to a 200 offline payload instead of letting the proxy fetch a dead upstream and 502. A 502-per-poll was
 *  logged by the browser as `api_error`, flooding RUM to CRITICAL even though "down" is an expected, benign
 *  state. Only when `isRunning()` is true do we fall through to the real proxy (which still 502s on a genuine
 *  unexpected fetch failure). `isRunning` is injected so this stays a pure, unit-testable factory. */
export function ecysearcherOfflineGate(isRunning: () => boolean) {
  return (_req: Request, res: Response, next: () => void): void => {
    if (isRunning()) return next();
    res.status(200).json(ecyOfflinePayload());
  };
}

/** Express handler for `app.use("/api/ecysearcher", localOwnerGuard, ecysearcherProxy)`. */
export async function ecysearcherProxy(req: Request, res: Response): Promise<void> {
  const target = ecyTargetUrl(ecyBaseUrl(), req.url || "/");
  try {
    const init: RequestInit = {
      method: req.method,
      headers: { accept: "application/json", ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}) },
      signal: AbortSignal.timeout(8000),
    };
    if (BODY_METHODS.has(req.method) && req.body && Object.keys(req.body).length) {
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      init.headers = { ...init.headers, "content-type": "application/json" };
    }
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.set("content-type", ct);
    res.send(text);
  } catch (e) {
    // eCySearcher down / unreachable → honest 502, never a thrown crash.
    res.status(502).json({ error: "eCySearcher unreachable", detail: String((e as Error)?.message || e), target });
  }
}
