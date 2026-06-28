/**
 * orchestration/bin/lib/dispatchbench.ts — vO18 Distributed-Dispatch research→test→update CORE (pure, zero-dep).
 *
 * "Test them and update the choice based on test results" loop for the Mac↔desktop-ert7724 fleet.
 * CONSUME measured dispatch runs (candidate working-principle variant × machine) → aggregate → selectBest
 * (ordered gate: correctness → tool-efficiency → latency → tok/s, mirrors optimize.selectBest) → portable
 * DISPATCH prompt + machine→variant selection. Plus assignWorker: pure routing (mirrors fleet.decideTransition).
 *
 * NO LLM, NO IO here — bin/dispatchbench.ts wraps with read-only file IO. Heavy dispatch-benching is a
 * downstream lane job (cli/scripts run real agent dispatch); this layer only CONSUMES + selects (benchprompt §).
 * Pattern adoption: promptfoo (eval-config), DSPy (metric-driven select), River/fleet.ts (claim+route) — idea-only.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type Machine = "mac" | "desktop-ert7724";

/** One measured dispatch run of a candidate working-principle variant on a machine. */
export interface DispatchRecord {
  variant: string;     // working-principle / system-prompt variant id (e.g. "ecypro-terse")
  machine: string;     // "mac" | "desktop-ert7724"
  correct: boolean;    // verdict===DONE && !demoSuspected (the evidence law)
  steps: number;       // tool steps taken
  dupTools: number;    // duplicate (tool,args) calls — efficiency penalty
  latencyMs: number;   // wall time
  tokS: number;        // tokens/sec measured on that machine
  ts?: string;
}

/** Per (variant, machine) aggregate. */
export interface DispatchAgg {
  variant: string;
  machine: string;
  runs: number;
  correctRatio: number;   // fraction of runs that were correct
  medianSteps: number;
  dupRate: number;        // mean dupTools per run
  medianLatencyMs: number;
  medianTokS: number;
}

/** Winning variant for one machine (or null = no data / none passed the gate). */
export interface MachineSelection {
  machine: string;
  variant: string | null;
  correctRatio: number;
  medianSteps: number;
  medianLatencyMs: number;
  medianTokS: number;
  reason: string;
}

export const DISPATCH_CORRECT_GATE = 0.7; // RouteLLM/optimize.ts parity: reject below correctness floor.

// ── Pure parsers ────────────────────────────────────────────────────────────────

function num(v: unknown, def = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

/** JSON value → DispatchRecord[]. Accepts {records:[…]} or a bare array. Bad rows skipped (never throws). */
export function parseDispatchRecords(json: unknown): DispatchRecord[] {
  const raw: unknown[] = Array.isArray(json)
    ? json
    : (json && typeof json === "object" && Array.isArray((json as { records?: unknown[] }).records))
      ? (json as { records: unknown[] }).records
      : [];
  const out: DispatchRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.variant !== "string" || typeof o.machine !== "string") continue;
    out.push({
      variant: o.variant, machine: o.machine,
      correct: o.correct === true,
      steps: num(o.steps), dupTools: num(o.dupTools),
      latencyMs: num(o.latencyMs), tokS: num(o.tokS),
      ts: typeof o.ts === "string" ? o.ts : undefined,
    });
  }
  return out;
}

/** Median of a numeric list (sorted copy; 0 for empty). Deterministic. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 100) / 100;
}

/** Records → per (variant,machine) aggregates, sorted deterministically (machine, variant). */
export function aggregateDispatch(records: DispatchRecord[]): DispatchAgg[] {
  const groups = new Map<string, DispatchRecord[]>();
  for (const r of records) {
    const k = `${r.machine}|${r.variant}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const aggs: DispatchAgg[] = [];
  for (const [k, g] of groups) {
    const [machine, variant] = k.split("|");
    const correct = g.filter((r) => r.correct).length;
    aggs.push({
      variant, machine, runs: g.length,
      correctRatio: Math.round((correct / g.length) * 1000) / 1000,
      medianSteps: median(g.map((r) => r.steps)),
      dupRate: Math.round((g.reduce((s, r) => s + r.dupTools, 0) / g.length) * 100) / 100,
      medianLatencyMs: median(g.map((r) => r.latencyMs)),
      medianTokS: median(g.map((r) => r.tokS)),
    });
  }
  return aggs.sort((a, b) => a.machine.localeCompare(b.machine) || a.variant.localeCompare(b.variant));
}

// ── Selection (ordered gate, lexicographic — mirrors optimize.selectBest) ─────────

/**
 * Compare two gate-passing aggs; <0 means `a` is better. Ordered, lexicographic & deterministic:
 *   1. higher correctRatio   2. lower (medianSteps + dupRate)   3. lower latency   4. higher tok/s
 *   5. variant name (stable tie-break)
 */
function betterDispatch(a: DispatchAgg, b: DispatchAgg): number {
  if (a.correctRatio !== b.correctRatio) return b.correctRatio - a.correctRatio;
  const aEff = a.medianSteps + a.dupRate, bEff = b.medianSteps + b.dupRate;
  if (aEff !== bEff) return aEff - bEff;
  if (a.medianLatencyMs !== b.medianLatencyMs) return a.medianLatencyMs - b.medianLatencyMs;
  if (a.medianTokS !== b.medianTokS) return b.medianTokS - a.medianTokS;
  return a.variant.localeCompare(b.variant);
}

/** Best variant for ONE machine. Gate: correctRatio ≥ floor. None pass → null selection w/ reason. */
export function selectBestForMachine(aggs: DispatchAgg[], machine: string): MachineSelection {
  const pool = aggs.filter((a) => a.machine === machine);
  if (!pool.length) {
    return { machine, variant: null, correctRatio: 0, medianSteps: 0, medianLatencyMs: 0, medianTokS: 0,
      reason: "veri yok — bu makinede dispatch-bench koşulmadı (cli/scripts lane üretir)" };
  }
  const passing = pool.filter((a) => a.correctRatio >= DISPATCH_CORRECT_GATE);
  if (!passing.length) {
    const top = [...pool].sort((a, b) => b.correctRatio - a.correctRatio)[0];
    return { machine, variant: null, correctRatio: top.correctRatio, medianSteps: top.medianSteps,
      medianLatencyMs: top.medianLatencyMs, medianTokS: top.medianTokS,
      reason: `hiç aday correctness-gate ${DISPATCH_CORRECT_GATE} geçmedi (en iyi ${top.variant} ${top.correctRatio})` };
  }
  const best = [...passing].sort(betterDispatch)[0];
  return {
    machine, variant: best.variant, correctRatio: best.correctRatio, medianSteps: best.medianSteps,
    medianLatencyMs: best.medianLatencyMs, medianTokS: best.medianTokS,
    reason: `correct ${best.correctRatio} ≥ ${DISPATCH_CORRECT_GATE} · ${best.medianSteps} adım · ${best.dupRate} dup · ${best.medianLatencyMs}ms · ${best.medianTokS} tok/s`,
  };
}

/** Selection for every machine seen in the data (sorted). Always includes the canonical two. */
export function selectAllMachines(aggs: DispatchAgg[]): MachineSelection[] {
  const machines = new Set<string>(["mac", "desktop-ert7724"]);
  for (const a of aggs) machines.add(a.machine);
  return [...machines].sort().map((m) => selectBestForMachine(aggs, m));
}

// ── assignWorker — pure routing (mirrors fleet.ts decideTransition shape) ─────────

export type TaskKind = "codegen" | "analysis" | "host-tool";
export interface DispatchTask { id: string; kind: TaskKind; estTokens?: number; }
export interface FleetWorker { name: string; kind: "mac" | "remote"; healthy: boolean; tokS?: number; }
export type Assignment = { worker: string; reason: string } | { worker: null; reason: string };

/**
 * Route one task to a worker. Pure & deterministic. Rules (ordered):
 *  1. host-tool (macos_terminal/iTerm) runs ONLY on the local mac control worker. mac down → null.
 *  2. codegen/analysis (GPU-heavy) → healthy remote worker, highest tok/s (name tie-break).
 *  3. no healthy remote → mac substrate failover (the Hybrid fallback). mac down too → null.
 *  4. thrash-guard: if `current` is still healthy & eligible for this task, stay (avoid reassignment churn).
 */
export function assignWorker(
  task: DispatchTask, workers: FleetWorker[], opts?: { current?: string | null },
): Assignment {
  const healthy = workers.filter((w) => w.healthy);
  const mac = healthy.find((w) => w.kind === "mac") || null;
  const remotes = healthy.filter((w) => w.kind === "remote")
    .sort((a, b) => (b.tokS ?? 0) - (a.tokS ?? 0) || a.name.localeCompare(b.name));

  const eligible: FleetWorker[] =
    task.kind === "host-tool" ? (mac ? [mac] : []) : [...remotes, ...(mac ? [mac] : [])];

  if (!eligible.length) {
    return { worker: null, reason: task.kind === "host-tool"
      ? "host-tool görevi yalnız mac'te koşar, mac down → atanamaz"
      : "hiçbir sağlıklı worker yok → atanamaz" };
  }

  // Thrash-guard: keep the current worker if it is still eligible & healthy.
  if (opts?.current && eligible.some((w) => w.name === opts.current)) {
    return { worker: opts.current, reason: "thrash-guard: mevcut worker hâlâ uygun → değiştirme" };
  }

  const pick = eligible[0];
  const reason = task.kind === "host-tool"
    ? "host-tool → mac kontrol düzlemi"
    : pick.kind === "remote"
      ? `GPU-ağır ${task.kind} → remote ${pick.name} (${pick.tokS ?? "?"} tok/s)`
      : `remote yok → mac substrate failover (${task.kind})`;
  return { worker: pick.name, reason };
}

// ── Portable DISPATCH working-prompt generator ───────────────────────────────────

export interface DispatchPromptInput { ts: string; stale: boolean; machines: MachineSelection[]; }

/** Self-contained, paste-anywhere distributed-dispatch working prompt. Deterministic from input. */
export function buildDispatchPrompt(input: DispatchPromptInput): string {
  const rows = input.machines.map((m) =>
    `| ${m.machine} | ${m.variant ?? "—"} | ${m.correctRatio} | ${m.medianSteps} | ${m.medianLatencyMs}ms | ${m.medianTokS} | ${m.reason} |`,
  );
  const staleNote = input.stale
    ? `> ⚠️ **STALE / veri yok** — seçim son ölçüme dayanır. Taze ölçüm için cli/scripts lane'de dispatch-bench koş, \`~/.llm-mission-control/dispatch-bench.json\` güncellensin.`
    : `> ✅ Taze ölçüme dayalı seçim.`;
  return [
    `# OLLAMAS — DISTRIBUTED DISPATCH WORKING PROMPT (self-optimizing, portable)`,
    ``,
    `> Mac ↔ desktop-ert7724 dağıtık alt-agent işbirliği. \`dispatchbench.ts\` üretti — ölçüme-dayalı, deterministik.`,
    `> Veri (\`dispatch-bench.json\`) değişince makine-başı en-iyi working-principle seçimi OTOMATİK güncellenir.`,
    staleNote,
    ``,
    `<selected-variants>  (makine → en-iyi working-principle varyantı, ordered gate: correct → adım/dup → latency → tok/s)`,
    `| Makine | Variant | correct | adım | latency | tok/s | gerekçe |`,
    `|--------|---------|--------:|-----:|--------:|------:|---------|`,
    ...rows,
    `</selected-variants>`,
    ``,
    `<routing>  (assignWorker — pure, fleet.ts decideTransition deseni)`,
    `- host-tool (macos_terminal/iTerm) → YALNIZ mac kontrol düzlemi.`,
    `- codegen/analysis (GPU-ağır) → sağlıklı remote worker, en yüksek tok/s; yoksa mac substrate failover.`,
    `- thrash-guard: mevcut worker hâlâ uygunsa değiştirme.`,
    `</routing>`,
    ``,
    `<protocol>  (choke-point yasası N-012)`,
    `- Dispatch YALNIZ HTTP: POST http://<worker>:<port>/api/agent/chat (SSE), agent-dispatch.mjs gövde-şekli.`,
    `- ToolRegistry import YOK — her makine kendi server'ı kendi dosya-sisteminin tek choke-point'i.`,
    `- Görev-başı yazma-kökü izolasyonu (--root); ledger claim→heartbeat→done (claims.ts deseni).`,
    `</protocol>`,
    ``,
    `<evidence-law>`,
    `Bir "çalışıyor" iddiası ANCAK yapılı raporla geçerli: steps>0 && !demoSuspected && non-demo provider && verdict===DONE.`,
    `Mock YOK — gerçek SSE structured report. Yanlış-ama-hızlı varyant diskalifiye (correctness-gate ${DISPATCH_CORRECT_GATE}).`,
    `</evidence-law>`,
  ].join("\n");
}
