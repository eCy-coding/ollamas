// server/ecysearcher-proxy.ts — reverse-proxy the eCySearcher threat-intel Flask API under ollamas.
//
// eCySearcher (a separate Python/Flask stack, default http://localhost:5000) has an OPEN REST API
// (no auth). Exposing it straight to the browser would mean CORS + an unguarded surface. Instead the
// cockpit hits ollamas at /api/ecysearcher/* (localOwnerGuard'd in server.ts) → this forwards to the
// Flask API and returns the JSON. So eCySearcher stays reachable ONLY by the local owner, through
// the ollamas choke-point. Graceful 502 when eCySearcher is down — never throws into the request.
import type { Request, Response } from "express";

/** Base URL of the eCySearcher Flask API. */
export function ecyBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ECYSEARCHER_URL || "http://localhost:5000").replace(/\/$/, "");
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
