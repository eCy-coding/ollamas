// Timeout-guarded HTTP health probe. Zero-dep (global fetch + AbortSignal).
// Used by transports to confirm ollamas answers through a candidate endpoint.

import { request as httpsRequest, type RequestOptions } from "node:https";
import type { IncomingMessage, ClientRequest } from "node:http";
import { Resolver } from "node:dns";
import { assertPrivateUrl } from "./guard.ts";

/**
 * dns.lookup-shaped fn. `callback` overloads: single (address, family) or, when the caller
 * passed `options.all === true` (node:https ALWAYS does), an array of {address, family}.
 */
export type LookupFn = (
  hostname: string,
  options: { all?: boolean } | unknown,
  callback: (
    err: Error | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void;

/** Minimal Resolver surface so tests can inject a fake (vT14). */
export interface ResolverLike {
  setServers(servers: string[]): void;
  resolve4(hostname: string, cb: (err: Error | null, addresses: string[]) => void): void;
}

/**
 * Build a `lookup` fn that resolves via specific public DNS servers (default 1.1.1.1/1.0.0.1),
 * bypassing the system resolver. Fixes RISK-TUNNEL-027: MagicDNS (100.100.100.100) NXDOMAINs
 * *.trycloudflare.com, so the cloudflare REVERSE probe fails on a mesh Mac. A node:dns `Resolver`
 * INSTANCE is isolated — unlike global dns.setServers(), which doesn't even affect dns.lookup.
 *
 * CRITICAL (ERR-TUNNEL-005 family, caught live): node:https calls lookup with `{all:true}` and then
 * REQUIRES an array back — returning a bare string gives "Invalid IP address: undefined". Honor `all`.
 */
export function resolverLookup(
  servers: string[] = ["1.1.1.1", "1.0.0.1"],
  resolver: ResolverLike = new Resolver(),
): LookupFn {
  resolver.setServers(servers);
  return (hostname, options, callback) => {
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    resolver.resolve4(hostname, (err, addresses) => {
      if (err) return wantsAll ? callback(err, [], 4) : callback(err, "", 4);
      if (wantsAll) {
        callback(null, addresses.map((address) => ({ address, family: 4 })));
      } else {
        callback(null, addresses[0] ?? "", 4);
      }
    });
  };
}

/**
 * ollamas health endpoint. The real server exposes `/api/health` (200, public) — NOT `/healthz`
 * (which 401s). Probing the wrong path made every transport look unhealthy against live ollamas
 * (ERR-TUNNEL-003, caught only by running it for real). Override via OLLAMAS_HEALTH_PATH if needed.
 */
export const HEALTH_PATH = process.env.OLLAMAS_HEALTH_PATH ?? "/api/health";

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
  path = HEALTH_PATH,
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
  /**
   * Custom DNS lookup (vT14): resolve the host via specific servers, bypassing the system
   * resolver. Pass `resolverLookup()` to reach *.trycloudflare.com despite MagicDNS (RISK-TUNNEL-027).
   */
  lookup?: LookupFn;
  /** Injected for tests; defaults to node:https request. */
  requestImpl?: HttpsRequestImpl;
}

/**
 * HTTPS health probe. Verifies TLS by default (mkcert CA is system-trusted).
 * Never throws; timeout / connection error / non-ok status → false.
 */
export function probeHttps(
  baseUrl: string,
  path = HEALTH_PATH,
  opts: HttpsProbeOptions = {},
): Promise<boolean> {
  const { timeoutMs = 2000, okStatuses, insecure = false, requirePrivateHost = false, lookup, requestImpl = httpsRequest } = opts;
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
      const reqOpts: RequestOptions = { rejectUnauthorized: !insecure, method: "GET" };
      if (lookup) (reqOpts as RequestOptions & { lookup: LookupFn }).lookup = lookup;
      const req = requestImpl(url, reqOpts, (res) => {
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
