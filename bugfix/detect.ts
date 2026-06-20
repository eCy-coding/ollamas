// vC1 P2 — Detection harness. Collects findings from three deterministic sources
// (tsc, vitest cache, semgrep) and normalizes them into a single Finding[] shape
// for Gemini triage. No new analysis engine — battle-tested tools invoked as
// binaries (Semgrep) or parsed from existing gate output (tsc / vitest). Semgrep
// is best-effort: absent or failing, it is skipped without breaking detection.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type FindingSource = "tsc" | "vitest" | "semgrep";

export interface Finding {
  source: FindingSource;
  file: string;
  line: number; // 0 when unknown
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
}

// ── Pure parsers (unit-tested) ───────────────────────────────────────────────

const TSC_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

/** Parse `tsc --noEmit` output: `file(line,col): error TSxxxx: message`. */
export function parseTsc(output: string): Finding[] {
  const out: Finding[] = [];
  for (const raw of output.split("\n")) {
    const m = TSC_LINE.exec(raw.trim());
    if (!m) continue;
    out.push({
      source: "tsc",
      file: m[1],
      line: Number(m[2]),
      rule: m[5],
      severity: m[4] === "warning" ? "warning" : "error",
      message: m[6],
    });
  }
  return out;
}

/** Parse vitest's `test-results/.last-run.json` ({status, failedTests:[]}). */
export function parseVitestLastRun(json: any): Finding[] {
  const failed: string[] = Array.isArray(json?.failedTests) ? json.failedTests : [];
  return failed.map((name) => ({
    source: "vitest" as const,
    file: typeof name === "string" && name.includes(">") ? name.split(">")[0].trim() : "",
    line: 0,
    rule: "test-fail",
    severity: "error" as const,
    message: String(name),
  }));
}

const SARIF_LEVEL: Record<string, Finding["severity"]> = { error: "error", warning: "warning", note: "info" };

/** Parse a SARIF 2.1.0 document (Semgrep) into Finding[]. */
export function parseSarif(sarif: any): Finding[] {
  const out: Finding[] = [];
  for (const run of sarif?.runs ?? []) {
    // Build a ruleId → default level map for results that omit `level`.
    const ruleLevel: Record<string, string> = {};
    for (const r of run?.tool?.driver?.rules ?? []) {
      if (r?.id) ruleLevel[r.id] = r?.defaultConfiguration?.level ?? "warning";
    }
    for (const res of run?.results ?? []) {
      const loc = res?.locations?.[0]?.physicalLocation;
      const level = res?.level ?? ruleLevel[res?.ruleId] ?? "warning";
      out.push({
        source: "semgrep",
        file: loc?.artifactLocation?.uri ?? "",
        line: loc?.region?.startLine ?? 0,
        rule: res?.ruleId ?? "semgrep",
        severity: SARIF_LEVEL[level] ?? "warning",
        message: res?.message?.text ?? "",
      });
    }
  }
  return out;
}

// ── Runners (thin, side-effecting) ───────────────────────────────────────────

/** Run `tsc --noEmit` and parse diagnostics. tsc exits non-zero on errors. */
export function runTsc(cwd: string): Finding[] {
  const r = spawnSync("npx", ["tsc", "--noEmit"], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return parseTsc((r.stdout || "") + (r.stderr || ""));
}

/** Read the vitest last-run cache (does NOT run the suite — expensive/flaky). */
export function runVitestCache(cwd: string): Finding[] {
  const p = join(cwd, "test-results", ".last-run.json");
  if (!existsSync(p)) return [];
  try {
    return parseVitestLastRun(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return [];
  }
}

/** Best-effort Semgrep scan. Skipped (returns []) when semgrep is absent/fails. */
export function runSemgrep(cwd: string, paths: string[] = ["server", "bugfix"]): Finding[] {
  // Presence check without a shell (avoids spawn-shell-true injection surface).
  const has = spawnSync("semgrep", ["--version"], { encoding: "utf8" });
  if (has.status !== 0) return [];
  const config = process.env.SEMGREP_CONFIG || "auto";
  const r = spawnSync("semgrep", ["scan", "--sarif", "-q", "--config", config, ...paths], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  if (!r.stdout) return [];
  try {
    return parseSarif(JSON.parse(r.stdout));
  } catch {
    return [];
  }
}

/** Collect findings from all sources. */
export function detectAll(cwd: string = process.cwd()): Finding[] {
  return [...runTsc(cwd), ...runVitestCache(cwd), ...runSemgrep(cwd)];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const findings = detectAll();
  const bySource = findings.reduce<Record<string, number>>((a, f) => ((a[f.source] = (a[f.source] || 0) + 1), a), {});
  console.error("[detect] findings:", findings.length, bySource);
  process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
