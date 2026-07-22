// L35 — keep eCym reachable under GPU contention.
//
// WHY: the seat was wired as `ecym: llmActive() ? undefined : gen(...)`. eCym is a LOCAL model
// that shares the GPU with chat generation, so whenever anything else was generating, eCym
// vanished from the panel entirely — silently, with no entry in `degraded`. That is precisely
// backwards for an orchestra meant to work on real tasks: the member most likely to be dropped
// was dropped exactly when the machine was busiest, i.e. when tasks were actually running.
//
// Ladder, in order:
//   1. GPU quiet            → the full model (ECY_MODEL, default `ecy`)
//   2. GPU busy             → wait, bounded (ECYM_WAIT_MS, default 8s) — contention is usually brief
//   3. still busy           → a lighter local model (ECYM_FALLBACK_MODEL, default qwen3-4b-ca)
//   4. no fallback declared → null WITH a reason, so L33 records why the seat is empty
//
// The GPU is still respected: we never run the heavy model against a busy device, and the wait
// is bounded so a stuck generation cannot stall a turn.
export type Generator = (messages: { role: string; content: string }[]) => Promise<string>;

export interface EcymResolution {
  /** null when eCym genuinely cannot participate this turn. */
  generate: Generator | null;
  /** Which model answered — surfaced in the vault note so a fallback answer is not mistaken for the real one. */
  model?: string;
  /** Set when generate is null, or when a fallback was used. Feeds degradedReasons (L33). */
  reason?: string;
  waitedMs: number;
}

export const ecymModel = (env = process.env): string => env.ECY_MODEL || "ecy";
export const ecymFallbackModel = (env = process.env): string =>
  env.ECYM_FALLBACK_MODEL ?? "qwen3-4b-ca";
export const ecymWaitMs = (env = process.env): number => {
  const n = Number(env.ECYM_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : 8000;
};

export interface ResolveOpts {
  /** Injected for tests; defaults to the live gpu-coordinator. */
  busy?: () => boolean;
  /** Builds a generator for a model name — injected so this module stays provider-agnostic. */
  makeGenerator: (model: string) => Generator;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolve the eCym seat for one turn. Never throws; a caller that gets `generate: null` should
 * record `reason` rather than letting the seat disappear without explanation.
 */
export async function resolveEcym(opts: ResolveOpts): Promise<EcymResolution> {
  const env = opts.env ?? process.env;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const busy = opts.busy ?? (() => false);

  if (!busy()) return { generate: opts.makeGenerator(ecymModel(env)), model: ecymModel(env), waitedMs: 0 };

  // Bounded wait: contention is usually a single in-flight generation, over in a second or two.
  const budget = ecymWaitMs(env);
  const started = now();
  const step = Math.min(500, Math.max(50, budget));
  while (now() - started < budget) {
    await sleep(step);
    if (!busy()) {
      const waitedMs = now() - started;
      return { generate: opts.makeGenerator(ecymModel(env)), model: ecymModel(env), waitedMs };
    }
  }
  const waitedMs = now() - started;

  const fb = ecymFallbackModel(env).trim();
  if (!fb) {
    return { generate: null, reason: `GPU meşgul (${waitedMs}ms beklendi), fallback model tanımlı değil`, waitedMs };
  }
  return {
    generate: opts.makeGenerator(fb),
    model: fb,
    reason: `GPU meşgul (${waitedMs}ms beklendi) → hafif model ${fb}`,
    waitedMs,
  };
}
