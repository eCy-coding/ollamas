// vC1 P3 — Gemini triage + adversarial verification + report. Each detected
// finding is judged by Gemini (is it a real, worth-fixing bug?) and then an
// INDEPENDENT refute pass tries to knock it down (implementer ≠ verifier). Only
// findings that survive both are kept. Pure parsers/renderers are unit-tested;
// the model call is dependency-injected (GenFn) so tests stay hermetic.

import { generate, pickEngine, type AiProvider } from "../server/ai";
import { detectAll, type Finding } from "./detect";
export type { Finding } from "./detect";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface Verdict {
  isReal: boolean;
  severity: "high" | "medium" | "low";
  rootCause: string;
  proposedFix: string;
}
export interface Refutation {
  refuted: boolean;
  reason: string;
}
export interface TriagedFinding extends Finding {
  verdict: Verdict;
  refutation: Refutation;
  kept: boolean;
}

export interface EngineSel {
  provider: AiProvider;
  model: string;
}
export type GenFn = (
  prompt: string,
  opts?: { provider?: AiProvider; model?: string; system?: string; temperature?: number }
) => Promise<{ text: string }>;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Extract the first balanced JSON object from model text (tolerant of fences/prose). */
export function extractJson(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseVerdict(text: string): Verdict {
  const j = extractJson(text);
  const sev = ["high", "medium", "low"].includes(j?.severity) ? j.severity : "low";
  return {
    isReal: !!j?.isReal,
    severity: sev,
    rootCause: String(j?.rootCause ?? ""),
    proposedFix: String(j?.proposedFix ?? ""),
  };
}

export function parseRefutation(text: string): Refutation {
  const j = extractJson(text);
  // Conservative: an unparseable verifier response counts as refuted so that
  // unverifiable findings never survive.
  if (!j) return { refuted: true, reason: "unparseable verifier response" };
  return { refuted: !!j.refuted, reason: String(j.reason ?? "") };
}

/** Read ±radius lines of source around a finding, 1-based line-numbered. */
export function readContext(cwd: string, file: string, line: number, radius = 12): string {
  if (!file) return "";
  const p = join(cwd, file);
  if (!existsSync(p)) return "";
  const lines = readFileSync(p, "utf8").split("\n");
  const from = Math.max(0, line - radius - 1);
  const to = Math.min(lines.length, line + radius);
  return lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join("\n");
}

const TRIAGE_SYSTEM =
  'You are a senior code auditor. Decide whether a reported finding is a REAL bug worth fixing. ' +
  'Reply with ONLY a JSON object: {"isReal":boolean,"severity":"high|medium|low","rootCause":string,"proposedFix":string}. No prose.';

const REFUTE_SYSTEM =
  'You are a skeptical reviewer whose job is to REFUTE a bug claim. Default to refuted=true unless the bug is clearly real AND impactful. ' +
  'Reply with ONLY a JSON object: {"refuted":boolean,"reason":string}.';

function triagePrompt(f: Finding, ctx: string): string {
  return `Finding from ${f.source} (rule ${f.rule}, severity ${f.severity}) at ${f.file}:${f.line}\nMessage: ${f.message}\n\nCode context:\n${ctx}\n\nIs this a real bug worth fixing? Respond JSON only.`;
}
function refutePrompt(f: Finding, ctx: string, v: Verdict): string {
  return `Claimed bug at ${f.file}:${f.line}\nRoot cause: ${v.rootCause}\nProposed fix: ${v.proposedFix}\n\nCode context:\n${ctx}\n\nRefute that this is a real, impactful bug if you can. Respond JSON only.`;
}

// ── Triage pipeline ──────────────────────────────────────────────────────────

export async function triageFinding(
  cwd: string,
  f: Finding,
  gen: GenFn,
  eng: EngineSel = { provider: "gemini", model: "gemini-3.5-flash" }
): Promise<TriagedFinding> {
  const ctx = readContext(cwd, f.file, f.line);
  const verdict = parseVerdict((await gen(triagePrompt(f, ctx), { ...eng, system: TRIAGE_SYSTEM, temperature: 0 })).text);
  const refutation = verdict.isReal
    ? parseRefutation((await gen(refutePrompt(f, ctx, verdict), { ...eng, system: REFUTE_SYSTEM, temperature: 0 })).text)
    : { refuted: true, reason: "triage marked finding not-real" };
  return { ...f, verdict, refutation, kept: verdict.isReal && !refutation.refuted };
}

export async function triageAll(cwd: string, findings: Finding[], gen: GenFn, eng: EngineSel): Promise<TriagedFinding[]> {
  const out: TriagedFinding[] = [];
  for (const f of findings) out.push(await triageFinding(cwd, f, gen, eng)); // sequential: avoid rate-limit bursts
  return out;
}

const SEV_RANK: Record<Verdict["severity"], number> = { high: 0, medium: 1, low: 2 };

export function renderReport(triaged: TriagedFinding[], engine?: EngineSel): string {
  const kept = triaged.filter((t) => t.kept).sort((a, b) => SEV_RANK[a.verdict.severity] - SEV_RANK[b.verdict.severity]);
  const dropped = triaged.filter((t) => !t.kept);
  const L: string[] = [];
  L.push("# BUGFIX_REPORT — ollamas Colab Koordinatör (vC1)", "");
  if (engine) L.push(`Triage engine: **${engine.provider}** (${engine.model})`, "");
  L.push(`Toplam: ${triaged.length} · doğrulanmış: ${kept.length} · elenen: ${dropped.length}`, "");
  L.push("## Doğrulanmış buglar (öncelik sırası)", "");
  if (!kept.length) L.push("_(yok)_", "");
  for (const t of kept) {
    L.push(`### [${t.verdict.severity.toUpperCase()}] ${t.file}:${t.line} — ${t.rule}`);
    L.push(`- **Kaynak:** ${t.source} — ${t.message}`);
    L.push(`- **Root cause:** ${t.verdict.rootCause}`);
    L.push(`- **Önerilen fix:** ${t.verdict.proposedFix}`, "");
  }
  L.push("## Elenen (false-positive / düşük etki)", "");
  if (!dropped.length) L.push("_(yok)_");
  for (const t of dropped) L.push(`- ${t.file}:${t.line} ${t.rule} — ${t.refutation.reason || "triage not-real"}`);
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  const arg = process.argv[2];
  const findings: Finding[] = arg && existsSync(arg) ? JSON.parse(readFileSync(arg, "utf8")) : detectAll(cwd);
  const eng = await pickEngine("code");
  console.error("[triage] engine:", eng.provider, eng.model, "| findings:", findings.length);
  const gen: GenFn = (p, o) => generate(p, o);
  const triaged = await triageAll(cwd, findings, gen, eng);
  writeFileSync(join(cwd, "bugfix", "bugfix-findings.json"), JSON.stringify(triaged, null, 2) + "\n");
  writeFileSync(join(cwd, "bugfix", "BUGFIX_REPORT.md"), renderReport(triaged, eng) + "\n");
  console.error("[triage] kept:", triaged.filter((t) => t.kept).length, "→ bugfix/BUGFIX_REPORT.md");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
