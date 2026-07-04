// server/key-health.ts — always-running API-key autonomy loop + convergence signal.
//
// Two jobs, one module:
//  1. A periodic self-heal loop (mirrors server/oauth-gc.ts lifecycle + the ecysearcher.ts
//     health-tick/circuit-breaker pattern) that re-runs the key-doctor so a key dropped into
//     env / discovered via `gh` connects itself with zero operator action, and a key whose
//     cooldown expired is swept back into the live pool.
//  2. A cached, cheap-to-serve health snapshot behind GET /api/keys/health — the single
//     convergence signal ("N/N providers live") the autonomy mission converges on.
//
// SECURITY: this file never handles raw key values — it consumes the key-doctor's already-masked
// verdicts and the pool's count-only status. Nothing here can leak a secret.
import type { DoctorReport, CandidateStatus, CandidateSource } from "./key-doctor";
import { runDoctor, productionDoctorDeps } from "./key-doctor";
import { keySignupUrl, keyedCloudProviders } from "./provider-catalog";
import { ProviderRouter } from "./providers";

export type HealthStatus = "live" | "cooled" | "invalid" | "absent";

export interface ProviderHealth {
  provider: string;
  status: HealthStatus;
  /** Reached via an OAuth/CLI path (gh token) or inherently keyless (gemini-cli) — 0 manual key. */
  keyless: boolean;
  source?: CandidateSource;
  /** Present only when NOT live — the single manual step left to activate this provider. */
  signupUrl?: string;
}

export interface KeyHealthSnapshot {
  providers: ProviderHealth[];
  total: number;
  live: number;
  /** Providers with no key and no keyless path — each carries its one signup URL. */
  absent: string[];
  /** Every provider live (keyed or keyless). */
  converged: boolean;
  /** Providers live with ZERO manual key — the literal 0-manual set. */
  keylessLive: string[];
  updatedAt: number;
  /** True when the last refresh failed (circuit open) — snapshot is stale but served. */
  degraded: boolean;
  lastError?: string;
}

const LIVE_VERDICTS: ReadonlySet<CandidateStatus> = new Set([
  "connected",
  "already",
  "connected-unverified",
]);

/** A provider is keyless-reachable when its live key came from the gh OAuth token, or it is the
 *  inherently keyless gemini-cli (Google OAuth free tier). */
function isKeyless(provider: string, source?: CandidateSource): boolean {
  return source === "gh" || provider === "gemini-cli" || provider === "github-models";
}

/** Pure: fold a DoctorReport into a health snapshot. `poolLive(p)` (optional) is the count of
 *  non-cooled keys for a provider — a doctor-"already" provider whose whole pool is cooled is
 *  downgraded to "cooled" (unless it is keyless-reachable, which needs no pooled key). */
export function summarizeFromDoctor(
  report: DoctorReport,
  nowMs: number,
  poolLive: (provider: string) => number = () => 1,
): KeyHealthSnapshot {
  const providers: ProviderHealth[] = [];
  for (const [provider, v] of Object.entries(report.providers)) {
    const keyless = isKeyless(provider, v.source);
    let status: HealthStatus;
    if (LIVE_VERDICTS.has(v.status)) {
      status = !keyless && poolLive(provider) === 0 ? "cooled" : "live";
    } else if (v.status === "invalid") {
      status = "invalid";
    } else {
      status = "absent";
    }
    providers.push({
      provider,
      status,
      keyless,
      source: v.source,
      signupUrl: status !== "live" ? v.nextManualUrl || keySignupUrl(provider) || undefined : undefined,
    });
  }
  return finalize(providers, nowMs);
}

/** Pure: a cheap snapshot straight from the pool (count-only) + catalog — no doctor run, no
 *  network, no subprocess. Served before the first loop tick has populated the cache. */
export function cheapHealthFromPool(
  providers: string[],
  poolStatus: (provider: string) => { total: number; live: number },
  keyless: (provider: string) => boolean,
  signupUrl: (provider: string) => string,
  nowMs: number,
): KeyHealthSnapshot {
  const rows: ProviderHealth[] = providers.map((provider) => {
    const s = poolStatus(provider);
    const kl = keyless(provider);
    let status: HealthStatus;
    if (s.live > 0 || kl) status = "live";
    else if (s.total > 0) status = "cooled";
    else status = "absent";
    return {
      provider,
      status,
      keyless: kl,
      signupUrl: status !== "live" ? signupUrl(provider) || undefined : undefined,
    };
  });
  return finalize(rows, nowMs);
}

function finalize(rows: ProviderHealth[], nowMs: number): KeyHealthSnapshot {
  rows.sort((a, b) => a.provider.localeCompare(b.provider));
  const liveRows = rows.filter((p) => p.status === "live");
  return {
    providers: rows,
    total: rows.length,
    live: liveRows.length,
    absent: rows.filter((p) => p.status === "absent").map((p) => p.provider),
    converged: rows.length > 0 && rows.every((p) => p.status === "live"),
    keylessLive: liveRows.filter((p) => p.keyless).map((p) => p.provider),
    updatedAt: nowMs,
    degraded: false,
  };
}

/** Pure: circuit-breaker backoff — consecutive failures widen the delay (capped). Mirrors the
 *  ecysearcher self-heal breaker so a persistently failing loop backs off instead of hot-spinning. */
export function nextBackoffMs(consecutiveFailures: number, baseMs: number, maxMs: number): number {
  if (consecutiveFailures <= 0) return baseMs;
  const grown = baseMs * 2 ** Math.min(consecutiveFailures, 6);
  return Math.min(grown, maxMs);
}

/** Pure: parse KEY_HEALTH_SOURCES into a validated source list. Default env+gh — both
 *  prompt-free (keychain reads can raise a macOS prompt, so it is opt-in only). */
export function parseSources(raw: string | undefined): CandidateSource[] {
  const allowed = new Set<CandidateSource>(["env", "keychain", "gh"]);
  const out = (raw ?? "env,gh")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is CandidateSource => allowed.has(s as CandidateSource));
  return out.length ? out : (["env", "gh"] as CandidateSource[]);
}

// ── IO: the always-running loop (thin wrapper over the pure functions above) ───────────────
let snapshot: KeyHealthSnapshot | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

/** Cached snapshot for GET /api/keys/health (null until the first tick populates it). */
export function getKeyHealth(): KeyHealthSnapshot | null {
  return snapshot;
}

async function tick(): Promise<void> {
  // Recovery: evict cooldowns that expired so a recovered key rejoins the live pool this tick.
  try {
    ProviderRouter.sweepCooldowns();
  } catch {
    /* best-effort */
  }
  const report = await runDoctor(
    { sources: parseSources(process.env.KEY_HEALTH_SOURCES), dryRun: false },
    productionDoctorDeps(),
  );
  snapshot = summarizeFromDoctor(report, Date.now(), (p) => ProviderRouter.keyPoolStatus(p).live);
}

/** Start the always-running key-health loop. Idempotent. Reschedules with circuit-breaker
 *  backoff on failure; the timer is unref'd so it never keeps the process alive. */
export function startKeyHealth(): void {
  if (timer) return;
  const base = Number(process.env.KEY_HEALTH_INTERVAL_MS || 900_000); // 15 min steady state
  const maxMs = Number(process.env.KEY_HEALTH_MAX_BACKOFF_MS || 3_600_000); // 1h backoff cap
  const bootDelay = Number(process.env.KEY_HEALTH_BOOT_DELAY_MS || 5_000);
  const schedule = (delay: number) => {
    timer = setTimeout(run, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  };
  const run = async () => {
    try {
      await tick();
      consecutiveFailures = 0;
      schedule(base);
    } catch (e: any) {
      consecutiveFailures++;
      if (snapshot) snapshot = { ...snapshot, degraded: true, lastError: String(e?.message ?? e).slice(0, 120) };
      schedule(nextBackoffMs(consecutiveFailures, base, maxMs));
    }
  };
  schedule(bootDelay); // first scan shortly after boot — never blocks app.listen
}

/** Stop the loop (graceful shutdown). Idempotent. */
export function stopKeyHealth(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Live fallback for the endpoint before the first tick: cheap pool+catalog snapshot. */
export function liveCheapSnapshot(): KeyHealthSnapshot {
  return cheapHealthFromPool(
    keyedCloudProviders(),
    (p) => ProviderRouter.keyPoolStatus(p),
    (p) => isKeyless(p),
    keySignupUrl,
    Date.now(),
  );
}
