// automator-probe (pure) — track what each model PRODUCED when asked to author macOS Automator-compatible
// artifacts (Quick Actions / Run Shell Script services / AppleScript / shell) that support the ollamas
// project. IO-free → unit-tested. The CLI (bin/automator-probe.ts) does the sequential dispatch, the
// per-model Desktop subdir, and the filesystem scan; this module classifies + renders.
//
// Why separate from chrome-probe: chrome-probe answers "can the model OPEN Chrome" (a tool-call capability
// verdict). This answers "what did the model PRODUCE" — an artifact-count tracked from a real directory
// scan, independent of whether the model emitted a VERDICT line. Reuses providerFor + DispatchReport.

import { providerFor, type DispatchReport, type ChromeProvider } from "./chrome-probe";

export type { ChromeProvider };
export { providerFor };

export type ArtifactKind = "workflow" | "applescript" | "shell" | "plist" | "readme" | "other";

export interface Artifact { name: string; kind: ArtifactKind }

export interface AutomatorRow {
  model: string;
  provider: ChromeProvider;
  produced: boolean;        // wrote ≥1 real file into its subdir (verdict-independent)
  fileCount: number;
  kinds: ArtifactKind[];    // distinct kinds present, sorted
  verdict: string;          // DONE | OK | BLOCKED | INCOMPLETE (from the run)
  artifacts: Artifact[];    // per-file name + kind
  note: string;             // short evidence line (final message / error)
}

/** Filesystem-safe per-model directory name: ':' and other separators → '_', collapse repeats. */
export function sanitizeModelDir(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

/** Classify an artifact by filename/extension. A `.workflow` bundle dir counts as a workflow. */
export function artifactKind(name: string): ArtifactKind {
  const n = name.toLowerCase();
  if (n.endsWith(".workflow")) return "workflow";
  if (n.endsWith(".scpt") || n.endsWith(".applescript") || n.endsWith(".scptd")) return "applescript";
  if (n.endsWith(".sh") || n.endsWith(".command") || n.endsWith(".bash") || n.endsWith(".zsh")) return "shell";
  if (n.endsWith(".plist")) return "plist";
  if (n.endsWith(".md") || n === "readme" || n.startsWith("readme")) return "readme";
  return "other";
}

/** Build the per-file artifact list (name + kind) from scanned relative paths, sorted by name. */
export function toArtifacts(scannedFiles: string[]): Artifact[] {
  return [...scannedFiles]
    .filter((f) => f && f.trim())
    .sort()
    .map((name) => ({ name, kind: artifactKind(name) }));
}

/** Classify one model's Automator run: produced = it wrote ≥1 file into its subdir (independent of the
 *  VERDICT line — a model may write files then stop without emitting DONE; we track the truth). */
export function classifyAutomatorRun(model: string, report: DispatchReport, scannedFiles: string[]): AutomatorRow {
  const artifacts = toArtifacts(scannedFiles);
  const kinds = [...new Set(artifacts.map((a) => a.kind))].sort();
  const verdict = report.verdict ?? "INCOMPLETE";
  const finalMsg = (report.messages ?? []).filter((m) => m && m.trim()).pop() ?? "";
  const errLine = (report.errors ?? []).join(" | ");
  const note = (finalMsg || errLine || (artifacts.length ? "files written, no final message" : "no output"))
    .replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    model,
    provider: providerFor(model),
    produced: artifacts.length > 0,
    fileCount: artifacts.length,
    kinds,
    verdict,
    artifacts,
    note,
  };
}

const yn = (b: boolean) => (b ? "✅" : "—");

/** Render the "who produced what" matrix + per-model artifact detail. */
export function renderAutomatorProbe(rows: AutomatorRow[], ts: string): string {
  const producers = rows.filter((r) => r.produced);
  const L: string[] = [
    `# AUTOMATOR_PROBE.md — "produce Automator artifacts that support the project" tracking (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/automator-probe.ts\` · ${ts}. Each model was handed the SAME task`,
    `> one-by-one (sequential; single-GPU truth): author macOS Automator-compatible artifacts (Quick Action /`,
    `> Run Shell Script / AppleScript / shell) that support ollamas, into \`~/Desktop/ollamas-automator/<model>/\`.`,
    `> "Produced" = the model wrote ≥1 real file into its own directory (tracked by a filesystem scan).`,
    ``,
    `## Result: ${producers.length}/${rows.length} models produced artifacts`,
    ``,
    `| # | Model | Provider | Produced | Files | Kinds | Verdict | Note |`,
    `|---|-------|----------|----------|-------|-------|---------|------|`,
    ...rows.map((r, i) =>
      `| ${i + 1} | \`${r.model}\` | ${r.provider} | ${yn(r.produced)} | ${r.fileCount} | ${r.kinds.join(", ") || "—"} | ${r.verdict} | ${r.note.replace(/\|/g, "\\|").slice(0, 70)} |`
    ),
    ``,
    `## What each model produced`,
    ...rows.flatMap((r) =>
      r.produced
        ? [`- **\`${r.model}\`** (${r.fileCount}): ${r.artifacts.map((a) => `\`${a.name}\` [${a.kind}]`).join(", ")}`]
        : [`- **\`${r.model}\`**: (nothing) — ${r.verdict}`]
    ),
    ``,
    `## Ethics`,
    `> Producing files is on the operator's OWN Mac and explicitly requested (the request IS the gate for the`,
    `> privileged write tier). Writes are scoped to \`~/Desktop/ollamas-automator/<model>/\` (per-model, no`,
    `> arbitrary Desktop clutter). Artifacts are PRODUCED and tracked, never executed. Bounded (per-model`,
    `> timeout, sequential). No mass targeting, no other host.`,
  ];
  return L.join("\n");
}
