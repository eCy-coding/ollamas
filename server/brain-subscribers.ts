// Brain event subscribers (S30/S31/S33/S34/S44 aggregate + S32/S35/S37 poll) —
// the ephemeral-source half of the integration layer. Bus events are aggregated
// in memory and FLUSHED periodically (default 10 min, and at flushNow() for
// tests/shutdown): per-signal daily rollups, not per-event rows — a thousand
// tool calls become one procedural line per tool per day (deterministic id →
// same-day re-flushes upsert in place). Sources with in-process snapshot getters
// (key-health verdicts, MCP upstream status, model champion) are POLLED at flush
// instead of hooked: transitions between polls collapse to steady-state facts,
// zero edits in their modules.
//
// Every write goes through the injected store surface → S24 redaction, AUDN,
// ns-jail all apply; everything lands in ns "ops"; budgetAllow() bounds each
// signal's slice.
import { subscribe, budgetAllow, deterministicId, type BrainEvent } from "./brain-bus";
import type { BrainMemoryInput, BrainFactInput } from "./brain";

export const OPS_NS = "ops";

export interface SubscriberWriter {
  remember(m: BrainMemoryInput): Promise<unknown>;
  assertFact(f: BrainFactInput): Promise<unknown>;
}

export interface SnapshotPollers {
  /** provider id → live verdict (e.g. "ok" | "degraded"). */
  providerVerdicts?: () => Record<string, string>;
  /** upstream id → status (e.g. "ready" | "down"). */
  upstreamStatus?: () => Record<string, string>;
  /** current champion model id (or null). */
  champion?: () => string | null;
}

export interface FlushReport {
  tools: number;
  errors: number;
  jobs: number;
  council: number;
  align: number;
  polledFacts: number;
}

interface Agg {
  tools: Map<string, { ok: number; fail: number }>;
  errors: Map<string, number>;
  jobs: Map<string, { done: number; failed: number }>;
  council: Map<string, { sum: number; n: number }>;
  align: { ok: number; fail: number };
}

const emptyAgg = (): Agg => ({
  tools: new Map(),
  errors: new Map(),
  jobs: new Map(),
  council: new Map(),
  align: { ok: 0, fail: 0 },
});

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

let installed = false;

export interface BrainSubscribers {
  flushNow(): Promise<FlushReport>;
  stop(): void;
}

/** Install all subscribers + the flush loop. Idempotent per process. */
export function registerBrainSubscribers(
  writer: SubscriberWriter,
  pollers: SnapshotPollers = {},
  opts: { intervalMs?: number; now?: () => number } = {},
): BrainSubscribers {
  if (installed) throw new Error("brain subscribers already installed (process-wide singleton)");
  installed = true;
  const now = opts.now ?? Date.now;
  let agg = emptyAgg();
  const lastPolled = { providers: new Map<string, string>(), upstreams: new Map<string, string>(), champion: null as string | null };

  const offs = [
    subscribe("tool.outcome", (e: BrainEvent) => {
      const tool = String(e.payload.tool ?? "unknown");
      const s = agg.tools.get(tool) ?? { ok: 0, fail: 0 };
      e.payload.ok ? s.ok++ : s.fail++;
      agg.tools.set(tool, s);
    }),
    subscribe("error.recorded", (e) => {
      const sig = String(e.payload.signature ?? "unknown").slice(0, 120);
      agg.errors.set(sig, (agg.errors.get(sig) ?? 0) + 1);
    }),
    subscribe("job.outcome", (e) => {
      const name = String(e.payload.name ?? "unknown");
      const s = agg.jobs.get(name) ?? { done: 0, failed: 0 };
      e.payload.outcome === "failed" ? s.failed++ : s.done++;
      agg.jobs.set(name, s);
    }),
    subscribe("council.score", (e) => {
      const model = String(e.payload.model ?? "council");
      const s = agg.council.get(model) ?? { sum: 0, n: 0 };
      s.sum += Number(e.payload.score ?? 0);
      s.n++;
      agg.council.set(model, s);
    }),
    subscribe("align.verdict", (e) => {
      e.payload.ok ? agg.align.ok++ : agg.align.fail++;
    }),
  ];

  async function flushNow(): Promise<FlushReport> {
    const t = now();
    const day = dayKey(t);
    const batch = agg;
    agg = emptyAgg(); // new events aggregate into a fresh window while we write
    const report: FlushReport = { tools: 0, errors: 0, jobs: 0, council: 0, align: 0, polledFacts: 0 };

    for (const [tool, s] of batch.tools) {
      if (!budgetAllow("tool-outcome", t)) break;
      await writer.remember({
        id: deterministicId("tool-outcome", `${tool}:${day}`),
        tier: "procedural",
        content: `tool ${tool} on ${day}: ${s.ok} ok / ${s.fail} fail`,
        source: "tool-registry", ns: OPS_NS,
      });
      report.tools++;
    }
    for (const [sig, n] of batch.errors) {
      if (!budgetAllow("error-memory", t)) break;
      await writer.remember({
        id: deterministicId("error-memory", `${sig}:${day}`),
        tier: "learned",
        content: `recurring error on ${day} (×${n}): ${sig}`,
        source: "error-tracking", ns: OPS_NS,
      });
      report.errors++;
    }
    for (const [name, s] of batch.jobs) {
      if (!budgetAllow("job-outcome", t)) break;
      await writer.remember({
        id: deterministicId("job-outcome", `${name}:${day}`),
        tier: "episodic",
        content: `job ${name} on ${day}: ${s.done} done / ${s.failed} failed`,
        source: "jobs", ns: OPS_NS,
      });
      report.jobs++;
    }
    for (const [model, s] of batch.council) {
      if (!budgetAllow("council-memory", t)) break;
      await writer.remember({
        id: deterministicId("council-memory", `${model}:${day}`),
        tier: "learned",
        content: `council ${model} on ${day}: avg score ${(s.sum / Math.max(1, s.n)).toFixed(3)} over ${s.n} rounds`,
        source: "council", ns: OPS_NS,
      });
      report.council++;
    }
    if (batch.align.ok + batch.align.fail > 0 && budgetAllow("align-memory", t)) {
      await writer.remember({
        id: deterministicId("align-memory", day),
        tier: "learned",
        content: `verifier on ${day}: ${batch.align.ok} pass / ${batch.align.fail} fail`,
        source: "alignment", ns: OPS_NS,
      });
      report.align++;
    }

    // Poll-captured facts: only CHANGES become assertions (assertFact supersedes).
    const pollFact = async (subject: string, predicate: string, object: string) => {
      if (!budgetAllow("snapshot-facts", t)) return;
      await writer.assertFact({ subject, predicate, object, ns: OPS_NS, episodeId: "snapshot-poll" });
      report.polledFacts++;
    };
    try {
      for (const [id, v] of Object.entries(pollers.providerVerdicts?.() ?? {})) {
        if (lastPolled.providers.get(id) !== v) {
          await pollFact(`provider:${id}`, "live_verdict", v);
          lastPolled.providers.set(id, v);
        }
      }
      for (const [id, st] of Object.entries(pollers.upstreamStatus?.() ?? {})) {
        if (lastPolled.upstreams.get(id) !== st) {
          await pollFact(`upstream:${id}`, "status", st);
          lastPolled.upstreams.set(id, st);
        }
      }
      const champ = pollers.champion?.() ?? null;
      if (champ && champ !== lastPolled.champion) {
        await pollFact("ollamas", "model_champion", champ);
        lastPolled.champion = champ;
      }
    } catch { /* pollers are best-effort — a broken snapshot never blocks aggregates */ }
    return report;
  }

  const timer = setInterval(() => { void flushNow().catch(() => { /* flush is best-effort */ }); },
    opts.intervalMs ?? 600_000);
  timer.unref?.();

  return {
    flushNow,
    stop() {
      clearInterval(timer);
      for (const off of offs) off();
      installed = false;
    },
  };
}
