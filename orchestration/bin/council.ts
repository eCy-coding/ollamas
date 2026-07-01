#!/usr/bin/env tsx
/**
 * orchestration/bin/council.ts — Hibrit model-council: yetenek-eşlemeli 18-model fleet ollamas'ı
 * uçtan-uca analiz eder; her iddia deterministik `oracle` ile denetlenir (prose ≠ kanıt).
 *
 * İKİ MOD (bench-lane deseni: ağır = opt-in, default = tüket+uyar):
 *   • default (light, <60s autopilot-safe): canlı `ollama list` → buildRoster → COUNCIL_ROSTER.json
 *     yaz + cached COUNCIL.json özetini bas. Ağır iş YOK. autopilot bunu çağırır.
 *   • --lane <ad> | --all | --refresh (heavy): atanan analist seat'i lane-context'iyle POST
 *     /api/ai/generate'e dispatch → parseFindings → oracle checkable-claim denetimi → COUNCIL.json
 *     + docs/E2E_ANALYSIS.md üret. Tek-GPU: yerel model sıralı (contention yok), cloud serbest.
 *
 * Reuse: server/council.ts:scoreCouncil (skorlama), oracle/index.ts:verify (yer-gerçeği),
 *   lib/council-roster.ts (atama), lib/council.ts (prompt/parse/synth). Yeni skorlayıcı YOK.
 *
 * Çalıştır: tsx orchestration/bin/council.ts [--lane cli] [--all] [--json] [--refresh]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRoster, seatsForLane, LANES, type Roster, type Seat } from "./lib/council-roster";
import {
  buildLanePrompt, parseFindings, summarizeCouncil, checkableClaims,
  type LaneContext, type LaneResult, type Finding,
} from "./lib/council";
import { verify } from "../oracle/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const JSON_OUT = process.argv.includes("--json");
const ALL = process.argv.includes("--all") || process.argv.includes("--refresh");
const laneArg = (() => { const i = process.argv.indexOf("--lane"); return i >= 0 ? process.argv[i + 1] : null; })();
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const DISPATCH_TIMEOUT = Number(process.env.OLLAMAS_TIMEOUT_MS || 180_000);

// Lane → primary source directory (relative to repo). integrations spans client+tunnel; bench = scripts.
const LANE_DIR: Record<string, string[]> = {
  backend: ["server", "backend"], frontend: ["web", "src"], cli: ["cli"],
  scripts: ["scripts"], integrations: ["client", "tunnel"], bench: ["scripts"],
  orchestration: ["orchestration"],
};
const EXT_LANG: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript/React", ".js": "JavaScript", ".mjs": "JavaScript",
  ".sh": "Shell", ".sql": "SQL", ".py": "Python", ".rs": "Rust", ".go": "Go", ".css": "CSS",
};

/** Live pulled ollama models (exact tags). Falls back to empty on failure (roster surfaces gaps). */
function liveModels(): string[] {
  try {
    const out = execFileSync("ollama", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 });
    return out.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((m) => m && m.includes(":"));
  } catch { return []; }
}

/** Gather a compact, real context for a lane: file list, LOC, langs, key excerpts. */
function laneContext(lane: string): LaneContext {
  const dirs = (LANE_DIR[lane] || [lane]).map((d) => join(REPO, d)).filter(existsSync);
  const files: string[] = [];
  const langCount: Record<string, number> = {};
  let loc = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".") || e === "tests") continue;
      const p = join(dir, e);
      let st: ReturnType<typeof statSync>; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p, depth + 1); continue; }
      const ext = extname(e);
      const lang = EXT_LANG[ext];
      if (!lang) continue;
      langCount[lang] = (langCount[lang] || 0) + 1;
      const rel = p.slice(REPO.length + 1);
      if (files.length < 60) files.push(rel);
      try { loc += readFileSync(p, "utf8").split("\n").length; } catch { /* skip */ }
    }
  };
  for (const d of dirs) walk(d, 0);
  const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  // excerpt: head of the first up-to-3 source files (bounded)
  const excerpt = files.slice(0, 3).map((rel) => {
    try { return `// ${rel}\n` + readFileSync(join(REPO, rel), "utf8").split("\n").slice(0, 12).join("\n"); }
    catch { return ""; }
  }).filter(Boolean).join("\n\n").slice(0, 1800);
  return { lane, files, loc, langs, excerpt };
}

/** Dispatch a single prompt to a model via the live server (never-throw). */
async function dispatch(model: string, prompt: string): Promise<{ text: string; tokPerSec?: number; ms: number; error?: string }> {
  const t0 = process.hrtime.bigint();
  try {
    const r = await fetch(`${OLLAMAS_URL}/api/ai/generate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, model }), signal: AbortSignal.timeout(DISPATCH_TIMEOUT),
    });
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    if (!r.ok) return { text: "", ms, error: `HTTP ${r.status}` };
    const j: any = await r.json();
    return { text: String(j.text ?? ""), tokPerSec: j.tokensPerSec, ms };
  } catch (e: any) {
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    return { text: "", ms, error: (e?.message ?? "dispatch error").slice(0, 80) };
  }
}

/** Present seats for a lane, ranked as analysts: architect/analyst/coder first, cloud slightly
 *  preferred (parallelizes; no local-GPU contention). The embedding seat can't do prose analysis
 *  so it is excluded from the analyst fan-out. */
function rankedSeats(roster: Roster, lane: string): Seat[] {
  const seats = seatsForLane(roster, lane).filter((s) => s.role !== "search" && s.model);
  const rank = (s: Seat) => {
    const roleRank = { architect: 0, analyst: 1, coder: 1, reviewer: 3, verifier: 2, adversary: 4, triage: 6 }[s.role] ?? 9;
    const cloudBonus = s.model?.includes("cloud") ? -0.4 : 0;
    return roleRank + cloudBonus;
  };
  return [...seats].sort((a, b) => rank(a) - rank(b));
}

/** Analyse a lane: try ranked seats until one produces findings (supervision: a failing/silent
 *  model falls through to the next capable seat). Bounded to MAX_ATTEMPTS to keep the pass cheap. */
async function runLane(roster: Roster, lane: string): Promise<LaneResult> {
  const seats = rankedSeats(roster, lane);
  if (!seats.length) return { lane, model: "(none)", ok: false, findings: [], error: "lane için present seat yok" };
  const ctx = laneContext(lane);
  const prompt = buildLanePrompt(ctx);
  const MAX_ATTEMPTS = 3;
  let last: LaneResult | null = null;
  for (const seat of seats.slice(0, MAX_ATTEMPTS)) {
    const d = await dispatch(seat.model!, prompt);
    const findings = parseFindings(lane, seat.model!, d.text);
    const res: LaneResult = { lane, model: seat.model!, ok: findings.length > 0, findings, tokPerSec: d.tokPerSec, ms: d.ms, error: d.error };
    if (res.ok) return res;             // success → done
    last = res;                          // remember for reporting; try next seat
    process.stderr.write(`    ${lane}: ${seat.model} boş/hata${d.error ? ` (${d.error})` : ""} → sıradaki seat\n`);
  }
  return last!;
}

/** Oracle-audit the checkable claims among findings (deterministic ground-truth). */
function auditFindings(findings: Finding[]): { claim: string; verdict: string; basis: string; proof: string }[] {
  return checkableClaims(findings).slice(0, 20).map((claim) => {
    const r = verify(claim);
    return { claim, verdict: r.verdict, basis: r.basis, proof: r.proof.slice(0, 120) };
  });
}

function writeRoster(roster: Roster, ts: string): void {
  const payload = {
    ts, chip: sysChip(), source: "council.ts (canlı ollama list)",
    present: roster.present, total: roster.seats.length,
    absentCapabilities: roster.absentCapabilities,
    lanesCovered: roster.lanesCovered, lanesUncovered: roster.lanesUncovered,
    seats: roster.seats.map((s) => ({
      capability: s.capability, role: s.role, model: s.model,
      available: s.available, responsibility: s.responsibility, lanes: s.lanes,
    })),
  };
  writeFileSync(join(ORCH_DIR, "COUNCIL_ROSTER.json"), JSON.stringify(payload, null, 2) + "\n");
}

function sysChip(): string {
  try { return execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unknown"; }
}

function renderE2E(results: LaneResult[], audits: ReturnType<typeof auditFindings>, ts: string): string {
  const s = summarizeCouncil(results);
  const lines: string[] = [
    `# E2E_ANALYSIS.md — ollamas 7-Lane Model-Council Analizi`,
    ``,
    `> Oto-üretim: \`tsx orchestration/bin/council.ts --all\` · ${ts}`,
    `> Her lane atanan model tarafından analiz edildi; checkable iddialar \`oracle\` ile denetlendi.`,
    ``,
    `## Özet`,
    `- Analiz edilen lane: ${s.lanes.length}/${LANES.length}`,
    `- Toplam bulgu: ${s.totalFindings} · Yanıtlayan model: ${s.respondedModels.join(", ") || "yok"}`,
    s.silentLanes.length ? `- ⚠️ Sessiz lane (bulgu-0): ${s.silentLanes.join(", ")}` : `- Tüm analiz edilen lane bulgu üretti`,
    ``,
    `## Lane-başı: hangi dil / hangi kod gerekli`,
    ``,
  ];
  for (const lr of results) {
    const langs = lr.findings.filter((f) => f.kind === "LANG").map((f) => f.text);
    const tasks = lr.findings.filter((f) => f.kind === "TASK");
    const risks = lr.findings.filter((f) => f.kind === "RISK");
    lines.push(`### ${lr.lane}  ·  analist: \`${lr.model}\`${lr.tokPerSec ? ` (${lr.tokPerSec.toFixed(0)} tok/s)` : ""}`);
    if (!lr.ok) { lines.push(`- ⚠️ yanıt yok / bulgu yok${lr.error ? ` — ${lr.error}` : ""}`, ``); continue; }
    lines.push(`- **Dil:** ${langs.join("; ") || "—"}`);
    if (tasks.length) { lines.push(`- **Kod işleri:**`); for (const t of tasks) lines.push(`  - ${t.text}`); }
    if (risks.length) { lines.push(`- **Risk/borç:**`); for (const r of risks) lines.push(`  - ${r.text}`); }
    lines.push(``);
  }
  lines.push(`## Oracle denetimi (deterministik yer-gerçeği)`);
  if (!audits.length) lines.push(`- Denetlenebilir (aritmetik/mantık) iddia bulunmadı — bulgular tasarım-önerisi (UNDECIDABLE, öznel-kapsam).`);
  else for (const a of audits) lines.push(`- [${a.verdict}] \`${a.claim}\` — ${a.basis}: ${a.proof}`);
  lines.push(``, `> Öncelik sıralaması için: \`tsx orchestration/bin/conduct.ts\` (RED > eksik > bayat).`);
  return lines.join("\n");
}

function nowIso(): string {
  // deterministic-safe: use git commit time as a stable stamp source is overkill; Date is fine at CLI top-level.
  try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

async function main(): Promise<void> {
  const ts = nowIso();
  const models = liveModels();
  const roster = buildRoster(models);
  writeRoster(roster, ts);

  const heavy = ALL || !!laneArg;
  if (!heavy) {
    // light mode: report cached + roster status (autopilot-safe)
    const cached = existsSync(join(ORCH_DIR, "COUNCIL.json"))
      ? JSON.parse(readFileSync(join(ORCH_DIR, "COUNCIL.json"), "utf8")) : null;
    const out = {
      mode: "light", ts, rosterPresent: roster.present, rosterTotal: roster.seats.length,
      lanesCovered: roster.lanesCovered.length, lanesUncovered: roster.lanesUncovered,
      cachedRun: cached?.ts ?? null, cachedFindings: cached?.summary?.totalFindings ?? null,
    };
    if (JSON_OUT) { process.stdout.write(JSON.stringify(out) + "\n"); return; }
    process.stdout.write(
      `🎭 council [light] · roster ${roster.present}/${roster.seats.length} present · ` +
      `lane coverage ${roster.lanesCovered.length}/${LANES.length}` +
      (roster.lanesUncovered.length ? ` · ⚠️ uncovered: ${roster.lanesUncovered.join(",")}` : "") +
      (cached ? ` · son analiz ${cached.ts} (${cached.summary?.totalFindings ?? "?"} bulgu)` : ` · analiz henüz yok (--all ile koş)`) + "\n"
    );
    return;
  }

  // heavy mode: dispatch real models per lane, audit, write artifacts
  const lanes = laneArg ? [laneArg] : LANES;
  const results: LaneResult[] = [];
  for (const lane of lanes) {
    process.stderr.write(`  council: ${lane} → dispatch...\n`);
    results.push(await runLane(roster, lane)); // sequential = single-GPU safe
  }
  const allFindings = results.flatMap((r) => r.findings);
  const audits = auditFindings(allFindings);
  const summary = summarizeCouncil(results);
  writeFileSync(join(ORCH_DIR, "COUNCIL.json"), JSON.stringify({ ts, summary, results, audits }, null, 2) + "\n");
  // E2E_ANALYSIS.md is a shared doc — only write the full report on --all (whole-project view)
  if (!laneArg) writeFileSync(join(REPO, "docs", "E2E_ANALYSIS.md"), renderE2E(results, audits, ts) + "\n");

  if (JSON_OUT) { process.stdout.write(JSON.stringify({ mode: "heavy", ts, summary, audits }) + "\n"); return; }
  process.stdout.write(`🎭 council [heavy] · ${results.length} lane · ${summary.totalFindings} bulgu · ${audits.length} oracle-denetim\n`);
  for (const r of results) process.stdout.write(`  ${r.ok ? "✓" : "✗"} ${r.lane} (${r.model}): ${r.findings.length} bulgu${r.error ? ` — ${r.error}` : ""}\n`);
  if (summary.silentLanes.length) process.stdout.write(`  ⚠️ sessiz lane: ${summary.silentLanes.join(", ")}\n`);
}

main().catch((e) => { console.error("[council] hata:", e?.message ?? e); process.exit(1); });
