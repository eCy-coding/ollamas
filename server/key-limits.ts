// server/key-limits.ts — known per-provider rate limits (best-effort free-tier defaults,
// env-overridable). Pure. The reactive 429 cooldown (providers.ts) stays the backstop, so a
// wrong guess here never hard-fails — it only shifts WHEN proactive rotation/alerting kicks in.

export interface RateLimit { perMin: number; perDay: number } // 0 = unlimited / unknown

const DEFAULTS: Record<string, RateLimit> = {
  gemini: { perMin: 20, perDay: 1000 },
  "gemini-cli": { perMin: 20, perDay: 1000 },
  openai: { perMin: 500, perDay: 0 },
  anthropic: { perMin: 50, perDay: 0 },
  openrouter: { perMin: 200, perDay: 0 },
};

// Resolve the limit for a provider; env `KEY_LIMIT_<PROVIDER>_PERMIN/_PERDAY` overrides.
export function limitFor(provider: string, env: NodeJS.ProcessEnv = process.env): RateLimit {
  const d = DEFAULTS[provider] ?? { perMin: 0, perDay: 0 };
  const P = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const perMin = Number(env[`KEY_LIMIT_${P}_PERMIN`]) || d.perMin;
  const perDay = Number(env[`KEY_LIMIT_${P}_PERDAY`]) || d.perDay;
  return { perMin, perDay };
}

// Fraction (0..1+) of the TIGHTEST active limit a key has consumed. 0 when unlimited.
export function pctOfLimit(counts: { perMin: number; perDay: number }, limit: RateLimit): number {
  const m = limit.perMin > 0 ? counts.perMin / limit.perMin : 0;
  const d = limit.perDay > 0 ? counts.perDay / limit.perDay : 0;
  return Math.max(m, d);
}

// Approaching the limit → the proactive-rotation / alert threshold (default 80%).
export function approaching(pct: number, threshold = 0.8): boolean {
  return pct >= threshold;
}
