// Timeout-guarded HTTP health probe. Zero-dep (global fetch + AbortSignal).
// Used by transports to confirm ollamas answers through a candidate endpoint.

import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage, ClientRequest } from "node:http";
import { assertPrivateUrl } from "./guard.ts";

export interface ProbeOptions {
  /** Abort the request after this many ms. */
  timeoutMs?: number;
  /** Treat these status codes as healthy. Default: any 2xx. */
  okStatuses?: number[];
  /**
   * Refuse to probe (return false) unless the target host is private/sovereign
   * (loopback / RFC1918 / CGNAT / .local). Defends against DNS-rebinding to a public
   * IP (RISK-TUNNEL-016). Default false (backward-compatible); transports pass true.
   */
  requirePrivateHost?: boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Probe `${baseUrl}${path}`. Returns true only on an allowed status before timeout.
 * Network error / timeout / non-ok status → false (never throws).
 */
export async function probeHttp(
  baseUrl: string,
  path = "/healthz",
  opts: ProbeOptions = {},
): Promise<boolean> {
  const { timeoutMs = 2000, okStatuses, requirePrivateHost = false, fetchImpl = fetch } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  if (requirePrivateHost && !assertPrivateUrl(url)) return false; // DNS-rebind guard
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: "manual",
    });
    if (okStatuses) return okStatuses.includes(res.status);
    return res.status >= 200 && res.status < 300;
  } catch {
    return false; // abort, DNS fail, connection refused — all mean "not reachable"
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal request signature so tests can inject a fake instead of node:https. */
export type HttpsRequestImpl = (
  url: string,
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;

export interface HttpsProbeOptions {
  timeoutMs?: number;
  okStatuses?: number[];
  /**
   * Skip TLS chain verification. Default FALSE — verify against the system trust
   * store, which already contains the mkcert root CA after `mkcert -install`, so a
   * normal verified probe succeeds on the Mac. Only enable for local debugging;
   * disabling verification exposes the probe to LAN MITM (RISK-TUNNEL-007).
   */
  insecure?: boolean;
  /** Refuse non-private hosts (DNS-rebind guard, RISK-TUNNEL-016). Default false. */
  requirePrivateHost?: boolean;
  /** Injected for tests; defaults to node:https request. */
  requestImpl?: HttpsRequestImpl;
}

/**
 * HTTPS health probe. Verifies TLS by default (mkcert CA is system-trusted).
 * Never throws; timeout / connection error / non-ok status → false.
 */
export function probeHttps(
  baseUrl: string,
  path = "/healthz",
  opts: HttpsProbeOptions = {},
): Promise<boolean> {
  const { timeoutMs = 2000, okStatuses, insecure = false, requirePrivateHost = false, requestImpl = httpsRequest } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  if (requirePrivateHost && !assertPrivateUrl(url)) return Promise.resolve(false); // DNS-rebind guard
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const req = requestImpl(url, { rejectUnauthorized: !insecure, method: "GET" }, (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // drain so the socket frees
        if (okStatuses) return done(okStatuses.includes(status));
        done(status >= 200 && status < 300);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done(false);
      });
      req.on("error", () => done(false));
      req.end();
    } catch {
      done(false);
    }
  });
}
