// vC1 P3 — Gemini triage + adversarial verification + report. Each detected
// finding is judged by Gemini (is it a real, worth-fixing bug?) and then an
// INDEPENDENT refute pass tries to knock it down (implementer ≠ verifier). Only
// findings that survive both are kept. Pure parsers/renderers are unit-tested;
// the model call is dependency-injected (GenFn) so tests stay hermetic.

import { generate, resolveLocalCoder, type AiProvider } from "../server/ai";
import { detectAll, type Finding } from "./detect";
export type { Finding } from "./detect";
import { colabGen, colabRuntimeAvailable, COLAB_DEFAULT_MODEL } from "./colab-bridge";
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
  /** Which engine ran the verify pass: "local", "colab/<model>", or "local(first-pass)". */
  verifierEngine?: string;
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

/**
 * Hybrid triage: local first-pass verdict (0-manual, qwen3-coder), then — for
 * findings judged real — an INDEPENDENT verify pass on Gemini when a Colab
 * runtime is supplied (implementer ≠ verifier), else a local verify. Only real
 * findings' code context reaches Gemini (egress is bounded to escalations).
 * Backward-compatible: called with a single `localGen` (no colabGen) it behaves
 * as the original local-only triage.
 */
export async function triageFinding(
  cwd: string,
  f: Finding,
  localGen: GenFn,
  colabGen?: GenFn,
  localEng: EngineSel = { provider: "ollama-local", model: "" },
  colabModel: string = COLAB_DEFAULT_MODEL
): Promise<TriagedFinding> {
  const ctx = readContext(cwd, f.file, f.line);
  const verdict = parseVerdict(
    (await localGen(triagePrompt(f, ctx), { ...localEng, system: TRIAGE_SYSTEM, temperature: 0 })).text
  );
  if (!verdict.isReal) {
    return { ...f, verdict, refutation: { refuted: true, reason: "triage marked finding not-real" }, kept: false, verifierEngine: "local(first-pass)" };
  }
  // Escalate real findings to a stronger, independent verifier (Gemini if present).
  const useColab = !!colabGen;
  const verifier = colabGen ?? localGen;
  const opts = useColab
    ? { model: colabModel, system: REFUTE_SYSTEM, temperature: 0 }
    : { ...localEng, system: REFUTE_SYSTEM, temperature: 0 };
  const refutation = parseRefutation((await verifier(refutePrompt(f, ctx, verdict), opts)).text);
  return { ...f, verdict, refutation, kept: !refutation.refuted, verifierEngine: useColab ? `colab/${colabModel}` : "local" };
}

export async function triageAll(
  cwd: string,
  findings: Finding[],
  localGen: GenFn,
  colabGen?: GenFn,
  localEng?: EngineSel
): Promise<TriagedFinding[]> {
  const out: TriagedFinding[] = [];
  for (const f of findings) out.push(await triageFinding(cwd, f, localGen, colabGen, localEng)); // sequential: avoid rate-limit bursts
  return out;
}

const SEV_RANK: Record<Verdict["severity"], number> = { high: 0, medium: 1, low: 2 };

export function renderReport(triaged: TriagedFinding[], engine?: { provider: string; model: string }): string {
  const kept = triaged.filter((t) => t.kept).sort((a, b) => SEV_RANK[a.verdict.severity] - SEV_RANK[b.verdict.severity]);
  const dropped = triaged.filter((t) => !t.kept);
  const L: string[] = [];
  L.push("# BUGFIX_REPORT — ollamas Colab Koordinatör (vC1.6 hibrit)", "");
  if (engine) L.push(`Engine: **${engine.provider}** (${engine.model})`, "");
  L.push(`Toplam: ${triaged.length} · doğrulanmış: ${kept.length} · elenen: ${dropped.length}`, "");
  L.push("## Doğrulanmış buglar (öncelik sırası)", "");
  if (!kept.length) L.push("_(yok)_", "");
  for (const t of kept) {
    L.push(`### [${t.verdict.severity.toUpperCase()}] ${t.file}:${t.line} — ${t.rule}`);
    L.push(`- **Kaynak:** ${t.source} — ${t.message}`);
    L.push(`- **Doğrulayan:** ${t.verifierEngine ?? "?"}`);
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
  // Hybrid: local first-pass (0-manual) + Gemini verify on real findings when a
  // Colab runtime is reachable; degrades to local verify otherwise.
  const localEng: EngineSel = { provider: "ollama-local", model: await resolveLocalCoder() };
  const localGen: GenFn = (p, o) => generate(p, o);
  const colab = colabRuntimeAvailable() ? colabGen : undefined;
  const label = { provider: "hibrit", model: `local:${localEng.model}${colab ? ` + colab/${COLAB_DEFAULT_MODEL}` : ""}` };
  console.error("[triage] hybrid | local:", localEng.model, "| gemini-verify:", !!colab, "| findings:", findings.length);
  const triaged = await triageAll(cwd, findings, localGen, colab, localEng);
  writeFileSync(join(cwd, "bugfix", "bugfix-findings.json"), JSON.stringify(triaged, null, 2) + "\n");
  writeFileSync(join(cwd, "bugfix", "BUGFIX_REPORT.md"), renderReport(triaged, label) + "\n");
  // Track every operation: one JSONL line per finding (engine used + verdict).
  const log = triaged
    .map((t) => JSON.stringify({ ts: new Date().toISOString(), file: t.file, line: t.line, verifier: t.verifierEngine, kept: t.kept }))
    .join("\n");
  writeFileSync(join(cwd, "bugfix", "triage.log"), log + "\n");
  console.error("[triage] kept:", triaged.filter((t) => t.kept).length, "→ bugfix/BUGFIX_REPORT.md + triage.log");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
