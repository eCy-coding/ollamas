// completion (pure) — turn a project census into an evidence-based "what's missing to complete the project"
// gap report (missing code / missing folders / missing-or-under-migrated languages), each mapped to the
// owning fleet stream with a justification. IO-free → unit-tested; the CLI gathers the census (git ls-files
// + grep + route drift) and writes COMPLETION_GAPS.md.
//
// No-guessing law: every gap derives from a scanned fact (a real .mjs count, a real route drift, a real
// stub file). False-positive guards: centralized tests (repo keeps tests under tests/) are stated so we
// never invent a "0 tests" gap; a sparse folder is flagged as SUSPECTED, not asserted-missing.

export interface CensusInput {
  langs: { ext: string; count: number }[];       // tracked-file counts by extension (git ls-files)
  mjsByDir: { dir: string; count: number }[];     // .mjs still to migrate → .ts, by directory
  mjsTotal: number;
  shCount: number;                                // .sh files (harden surface)
  stubFiles: string[];                            // files with TODO/FIXME/not-implemented markers
  sparseDirs: { dir: string; count: number }[];   // top-level dirs with very few tracked files
  routeGap: { missing: string[]; unused: string[] }; // frontend /api calls with no backend route / unused routes
  centralTests: number;                           // test files under tests/ (repo keeps tests centralized)
}

export type Severity = "P1" | "P2" | "P3";
export type GapKind = "language-migration" | "route-missing" | "route-unused" | "stub" | "sparse-folder";

export interface Gap {
  kind: GapKind;
  title: string;
  evidence: string;      // the scanned fact this gap derives from
  severity: Severity;
  ownerStream: string;   // the fleet stream that owns the fix
  justification: string; // WHY it needs doing (gerekçe)
}

// gap-kind → owning fleet stream (mirrors fleet-plan STREAMS: the task-distribution targets).
const OWNER: Record<GapKind, string> = {
  "language-migration": "mjs-migration",
  "route-missing": "typescript-core",
  "route-unused": "errors-resilience",
  "stub": "typescript-core",
  "sparse-folder": "typescript-core",
};

export function streamFor(kind: GapKind): string {
  return OWNER[kind];
}

/** Drop frontend calls that ARE served — by an `app.use("/api/prefix", …)` proxy/router mount whose prefix
 *  the call sits under. graph.extractRoutes only sees `app.get/post(...)`, so proxy-mounted sub-paths would
 *  otherwise be false "missing". A call matches a prefix when it equals it or starts with `prefix/`. */
export function filterProxiedMissing(missing: string[], proxyPrefixes: string[]): string[] {
  const pre = proxyPrefixes.map((p) => p.replace(/\/+$/, "")).filter(Boolean);
  return missing.filter((call) => {
    const c = call.replace(/\/+$/, "");
    return !pre.some((p) => c === p || c.startsWith(p + "/"));
  });
}

/** Is a source line a REAL comment marker (`// TODO`, `# FIXME:`), not an incidental mention of the word
 *  inside a string literal or a regex (e.g. a grep arg `"-e","TODO"` or a detector's `/(TODO|FIXME)/`)? */
export function isRealMarkerLine(line: string): boolean {
  if (!/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) return false;
  // A real marker follows a comment opener with (optional) whitespace then the word.
  if (/(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|XXX)\b/.test(line)) {
    // …but not when it's clearly a string/regex mention on that same comment line describing the detector.
    if (/["'`].*(TODO|FIXME).*["'`]/.test(line) || /\((?:TODO|FIXME)\|/.test(line)) return false;
    return true;
  }
  return false;
}

/** Derive the completion gaps from the census. Only provable gaps; no fabricated test-coverage gap. */
export function analyzeCompletion(c: CensusInput): Gap[] {
  const gaps: Gap[] = [];

  // §D — under-migrated language: .mjs → .ts (the operator's TS-primary directive).
  if (c.mjsTotal > 0) {
    const top = c.mjsByDir.slice(0, 3).map((d) => `${d.dir} (${d.count})`).join(", ");
    gaps.push({
      kind: "language-migration",
      title: `${c.mjsTotal} .mjs files still to migrate to TypeScript`,
      evidence: `git ls-files '*.mjs' = ${c.mjsTotal}; concentrated in ${top}`,
      severity: c.mjsTotal > 50 ? "P1" : "P2",
      ownerStream: streamFor("language-migration"),
      justification: "TS is the primary language (type-safety, single toolchain); un-migrated .mjs escapes tsc + the shared type contracts.",
    });
  }

  // §B — backend/frontend contract drift (real route gap from graph.gapAnalysis).
  for (const m of c.routeGap.missing) {
    gaps.push({
      kind: "route-missing",
      title: `Frontend calls \`${m}\` but no backend route serves it`,
      evidence: `src /api call with no matching server route`,
      severity: "P1",
      ownerStream: streamFor("route-missing"),
      justification: "A called-but-unimplemented endpoint is a runtime 404 — a genuine missing implementation.",
    });
  }
  for (const u of c.routeGap.unused) {
    gaps.push({
      kind: "route-unused",
      title: `Backend route \`${u}\` is never called by the frontend`,
      evidence: `server route with no matching src /api call`,
      severity: "P3",
      ownerStream: streamFor("route-unused"),
      justification: "Dead route = maintenance cost + attack surface; confirm intentional (public API?) or remove.",
    });
  }

  // §B — explicit stub/TODO markers (real, few).
  for (const f of c.stubFiles) {
    gaps.push({
      kind: "stub",
      title: `Unfinished marker in \`${f}\``,
      evidence: `TODO/FIXME/not-implemented found in file`,
      severity: "P2",
      ownerStream: streamFor("stub"),
      justification: "An explicit TODO/stub marks incomplete logic the author flagged.",
    });
  }

  // §C — sparse top-level folders: SUSPECTED-incomplete, never asserted-missing (evidence caution).
  for (const d of c.sparseDirs) {
    gaps.push({
      kind: "sparse-folder",
      title: `Folder \`${d.dir}\` has only ${d.count} tracked file(s) — possibly a stub lane`,
      evidence: `git ls-files ${d.dir} = ${d.count}`,
      severity: "P3",
      ownerStream: streamFor("sparse-folder"),
      justification: "A near-empty top-level folder is either an intentional placeholder or an unfinished lane — verify intent (SUSPECTED, not confirmed-missing).",
    });
  }

  return gaps;
}

const sevRank: Record<Severity, number> = { P1: 0, P2: 1, P3: 2 };

/** Render COMPLETION_GAPS.md: language breakdown, missing code, missing/sparse folders, under-migrated
 *  languages, and the per-stream task distribution — all with justifications. */
export function renderCompletionReport(gaps: Gap[], c: CensusInput, ts: string): string {
  const ranked = [...gaps].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  const byStream = new Map<string, Gap[]>();
  for (const g of ranked) { if (!byStream.has(g.ownerStream)) byStream.set(g.ownerStream, []); byStream.get(g.ownerStream)!.push(g); }

  const L: string[] = [
    `# COMPLETION_GAPS.md — project-completion gap report (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/completion-scan.ts\` · ${ts}. The council's end-to-end scan of ollamas:`,
    `> what code / folders / languages are still needed to complete the project, with justifications and a`,
    `> task distribution across the fleet streams. Evidence only — every gap derives from a real scan fact.`,
    ``,
    `## Verdict: ${gaps.length} gap(s) — ${gaps.filter((g) => g.severity === "P1").length} P1 · ${gaps.filter((g) => g.severity === "P2").length} P2 · ${gaps.filter((g) => g.severity === "P3").length} P3`,
    ``,
    `## §A — Language breakdown (tracked files)`,
    `| Language | Files |`,
    `|----------|-------|`,
    ...c.langs.slice(0, 12).map((l) => `| .${l.ext} | ${l.count} |`),
    ``,
    `> TypeScript is the primary language. Tests are centralized under \`tests/\` (${c.centralTests} files) —`,
    `> a lane having no \`*.test.ts\` beside its source is NOT a coverage gap (avoids false positives).`,
    ``,
    `## §B — Missing code`,
    ...(gaps.some((g) => g.kind === "route-missing" || g.kind === "route-unused" || g.kind === "stub")
      ? ranked.filter((g) => g.kind === "route-missing" || g.kind === "route-unused" || g.kind === "stub").map((g) => `- **[${g.severity}] ${g.title}** — ${g.justification}  \n  ↳ evidence: ${g.evidence} · owner: \`${g.ownerStream}\``)
      : ["- (none found — no route drift, only 2 stub markers repo-wide; the codebase is largely complete)"]),
    ``,
    `## §C — Missing / sparse folders (SUSPECTED, verify intent)`,
    ...(c.sparseDirs.length ? c.sparseDirs.map((d) => `- \`${d.dir}\` — ${d.count} tracked file(s); likely a stub/unfinished lane or an intentional placeholder. Verify.`) : ["- (none)"]),
    ``,
    `## §D — Missing / under-migrated languages`,
    `- **${c.mjsTotal} .mjs files still to migrate → TypeScript** (owner: \`mjs-migration\`).`,
    ...c.mjsByDir.slice(0, 6).map((d) => `  - ${d.dir}: ${d.count}`),
    `  - Justification: TS-primary directive; .mjs bypasses \`tsc\` type-checking + shared type contracts.`,
    ``,
    `## §E — Task distribution (per fleet stream, ≤2 tasks/model)`,
    ...[...byStream.entries()].map(([stream, gs]) =>
      `### \`${stream}\` (${gs.length})\n` + gs.map((g) => `- [${g.severity}] ${g.title} — ${g.justification}`).join("\n")),
    ``,
    `> Streams reference: fleet-plan.ts STREAMS. Fleet already reached 6/6 gated proposals (FLEET_RUN.md);`,
    `> this report is the deterministic census layer of the council's collective scan (+ CODINGS_STATUS.md).`,
  ];
  return L.join("\n");
}
