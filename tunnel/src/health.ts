// Timeout-guarded HTTP health probe. Zero-dep (global fetch + AbortSignal).
// Used by transports to confirm ollamas answers through a candidate endpoint.

export interface ProbeOptions {
  /** Abort the request after this many ms. */
  timeoutMs?: number;
  /** Treat these status codes as healthy. Default: any 2xx. */
  okStatuses?: number[];
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
  const { timeoutMs = 2000, okStatuses, fetchImpl = fetch } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
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
