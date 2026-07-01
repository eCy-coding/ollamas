// think — the sustainable problem-solving THINKING mechanism (pure core).
//
// Institutionalizes the loop we ran by hand: detect problem → look up a PROVEN, sourced solution →
// emit an evidence-backed directive. HARD RULE (no-guess): if the problem is not in the proven-solution
// registry, return NEEDS_RESEARCH — the mechanism NEVER invents a fix (honors "sadece kanıtla, tahmin yok").
// The registry (PROBLEM_REGISTRY.json) is append-only, so the mechanism LEARNS: each newly researched +
// verified fix is added, and next time that problem class is solved instantly with its citation.
//
// IO-free → unit-tested. The CLI (bin/think.ts) feeds real findings (conduct/critic/dod) in.

export interface RegistryEntry {
  category: string;
  pattern: string;        // regex (source) matched against a finding's text/detail
  provenSolution: string; // the fix to apply
  sources: string[];      // citations — WHY it is proven (no entry without a source)
  evidence: string;       // where it is already applied/verified in this repo
  appliedIn?: string;     // version tag
}
export interface Finding { kind?: string; target?: string; detail?: string; text?: string; }

export type ThinkResult =
  | { status: "PROVEN"; category: string; solution: string; sources: string[]; evidence: string }
  | { status: "NEEDS_RESEARCH"; category: "unknown"; probe: string };

/** Normalize a finding into one searchable string. */
export function findingText(f: Finding): string {
  return [f.kind, f.target, f.detail, f.text].filter(Boolean).join(" ").trim();
}

/** Match a finding to the first registry entry whose pattern hits. Deterministic (registry order). */
export function classify(f: Finding, registry: RegistryEntry[]): RegistryEntry | null {
  const text = findingText(f);
  if (!text) return null;
  for (const e of registry) {
    try { if (new RegExp(e.pattern, "i").test(text)) return e; } catch { /* bad regex → skip */ }
  }
  return null;
}

/** Look up a PROVEN solution; unknown → NEEDS_RESEARCH (never guesses). */
export function think(f: Finding, registry: RegistryEntry[]): ThinkResult {
  const hit = classify(f, registry);
  if (hit && hit.sources.length > 0) {
    return { status: "PROVEN", category: hit.category, solution: hit.provenSolution, sources: hit.sources, evidence: hit.evidence };
  }
  return { status: "NEEDS_RESEARCH", category: "unknown", probe: findingText(f).slice(0, 120) || "(empty finding)" };
}

export interface ThinkSummary {
  total: number;
  proven: number;
  needsResearch: number;
  results: { finding: string; result: ThinkResult }[];
}

/** Run the thinking loop over a batch of findings. */
export function thinkAll(findings: Finding[], registry: RegistryEntry[]): ThinkSummary {
  const results = (findings ?? []).map((f) => ({ finding: findingText(f).slice(0, 100), result: think(f, registry) }));
  return {
    total: results.length,
    proven: results.filter((r) => r.result.status === "PROVEN").length,
    needsResearch: results.filter((r) => r.result.status === "NEEDS_RESEARCH").length,
    results,
  };
}

/** Render THINK.md — proven directive per problem, or an explicit needs-research flag (no fabrication). */
export function renderThink(s: ThinkSummary, ts: string): string {
  const L = [
    `# THINK.md — sustainable problem-solving loop (evidence-based, no-guess)`,
    ``, `> Auto: \`tsx orchestration/bin/think.ts\` · ${ts} · ${s.total} problem · ${s.proven} proven · ${s.needsResearch} needs-research`,
    `> Rule: unknown problems are flagged NEEDS_RESEARCH — the mechanism never invents a fix (only cited, proven solutions).`,
    ``,
  ];
  for (const r of s.results) {
    if (r.result.status === "PROVEN") {
      L.push(`## ✅ ${r.result.category} — PROVEN`);
      L.push(`- Problem: ${r.finding}`);
      L.push(`- Solution: ${r.result.solution}`);
      L.push(`- Sources: ${r.result.sources.join(" · ")}`);
      L.push(`- Evidence: ${r.result.evidence}`, ``);
    } else {
      L.push(`## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)`);
      L.push(`- Problem: ${r.result.probe}`);
      L.push(`- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).`, ``);
    }
  }
  return L.join("\n");
}
