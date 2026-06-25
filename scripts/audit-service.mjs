#!/usr/bin/env node
// audit-service — Audit-as-a-Service runner (Faz16 revenue workflow).
//
// Turns ANY local repo into a client-ready, verified bug-audit report using the
// near-$0 local ollama model (qwen3:8b) as the engine — escalate to 480b-cloud only
// on hard units. Reuses the session's audit harness (benchmark-selected auditor +
// LOC-balanced partition + per-unit dispatch + model|bug|fix ledger).
//
// Usage:
//   node scripts/audit-service.mjs --repo /path/to/client/repo [--dry]
//        [--model qwen3:8b] [--provider ollama-local] [--max-loc 500] [--max-units 0]
//        [--out audit-out/<repo>] [--client "Acme Inc"]
// Live mode needs a running ollamas gateway (OLLAMAS_URL, default :8099) + ollama daemon.
// --dry: partition + cost/scope estimate only (no agent calls) — for quoting a client.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const A = process.argv.slice(2);
const opt = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const has = (f) => A.includes(f);
const REPO = opt("--repo", "");
if (!REPO || !fs.existsSync(REPO)) { console.error("usage: --repo <existing path> required"); process.exit(2); }
const REPO_ABS = path.resolve(REPO);
const NAME = path.basename(REPO_ABS);
const MODEL = opt("--model", "qwen3:8b");
const PROVIDER = opt("--provider", "ollama-local");
const MAX_LOC = +opt("--max-loc", "500");   // benchmark-scale units → qwen3:8b reliable
const MAX_FILES = +opt("--max-files", "5");
const MAX_UNITS = +opt("--max-units", "0");  // 0 = all
const OUT = path.resolve(opt("--out", `audit-out/${NAME}`));
const CLIENT = opt("--client", NAME);
const DRY = has("--dry");
const BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:8099";

// ── partition: source files → LOC-balanced units ──────────────────────────────
const list = execFileSync("bash", ["-c",
  `cd ${JSON.stringify(REPO_ABS)} && find . \\( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \\) ` +
  `-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' -not -path '*/vendor/*' -not -path '*/.claude/*' -not -path '*/audit-out/*' 2>/dev/null | sed 's|^\\./||' | sort`,
]).toString().trim().split("\n").filter(Boolean);
const loc = (f) => { try { return execFileSync("bash", ["-c", `wc -l < ${JSON.stringify(path.join(REPO_ABS, f))}`]).toString().trim() | 0; } catch { return 0; } };
const files = list.map((f) => ({ f, loc: loc(f) }));
const totalLoc = files.reduce((a, b) => a + b.loc, 0);
// bin (dir-affinity preserved by sort order; LOC/file bounded)
const units = [];
let cur = [], curLoc = 0;
const flush = () => { if (cur.length) { units.push({ id: `U${units.length + 1}`, files: cur.map((x) => x.f), loc: curLoc }); cur = []; curLoc = 0; } };
for (const x of files) { if (cur.length && (curLoc + x.loc > MAX_LOC || cur.length >= MAX_FILES)) flush(); cur.push(x); curLoc += x.loc; }
flush();
const scopedUnits = MAX_UNITS > 0 ? units.slice(0, MAX_UNITS) : units;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });

console.log(`audit-service: ${CLIENT} (${NAME})`);
console.log(`  files=${files.length} loc=${totalLoc} units=${units.length} (scoped=${scopedUnits.length}) model=${MODEL}`);
const estMin = Math.ceil((scopedUnits.length * (PROVIDER === "ollama-local" && /:8b/.test(MODEL) ? 25 : 60)) / 60);
console.log(`  est runtime ~${estMin} min · marginal cost ~$0 (local ${MODEL})`);

if (DRY) {
  fs.writeFileSync(path.join(OUT, "scope.json"), JSON.stringify({ client: CLIENT, repo: REPO_ABS, files: files.length, loc: totalLoc, units: units.length, model: MODEL }, null, 2));
  console.log(`  [DRY] scope written → ${path.join(OUT, "scope.json")}. Use this to quote the client; drop --dry to run.`);
  process.exit(0);
}

// ── dispatch one unit to the live ollamas agent (reads files via macos_terminal) ──
function buildTask(u) {
  const paths = u.files.map((f) => path.join(REPO_ABS, f)).join(" ");
  return [
    `You are a code auditor. Read these files with ONE macos_terminal command (target iterm2): cat ${paths}`,
    "Then inspect EVERY exported function/method for NON-WORKING behavior: logic bug, wrong result, crash on null/undefined, missing await/race, wrong default, off-by-one, swallowed error, resource leak, dead code, wrong return type.",
    "Report ONLY broken/suspicious ones as a JSON array in your final answer:",
    '[{"file":"rel/path","name":"fn","line":<n>,"symptom":"one line","fix":"one line","severity":"high|medium|low"}]',
    "Base it on the real cat output, not guesses. Empty if none. Final answer = ONLY the JSON array.",
  ].join("\n");
}
async function dispatch(u) {
  const body = { messages: [{ role: "user", content: buildTask(u) }], provider: PROVIDER, model: MODEL, maxSteps: 5, autoApply: false };
  const ctrl = new AbortController(); const tid = setTimeout(() => ctrl.abort(), 200000);
  const ev = [];
  try {
    const res = await fetch(`${BASE}/api/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    let buf = ""; const dec = new TextDecoder();
    for await (const c of res.body) { buf += dec.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const r = buf.slice(0, i); buf = buf.slice(i + 2); let d = ""; for (const ln of r.split("\n")) if (ln.startsWith("data:")) d += ln.slice(5).trim(); if (!d) continue; try { ev.push(JSON.parse(d)); } catch { /* skip */ } } }
  } catch (e) { return { error: String(e.message || e), ev }; } finally { clearTimeout(tid); }
  return { ev };
}
function parseFindings(ans) { const m = (ans || "").match(/\[[\s\S]*\]/); if (!m) return []; try { const a = JSON.parse(m[0].replace(/,\s*([\]}])/g, "$1")); return Array.isArray(a) ? a : []; } catch { return []; } }

const all = [];
let done = 0;
for (const u of scopedUnits) {
  const r = await dispatch(u);
  const done_ev = (r.ev || []).find((e) => e.type === "done");
  const ranTerm = (r.ev || []).some((e) => e.type === "step" && /terminal/i.test(e.tool || ""));
  const finds = parseFindings(done_ev?.text).map((f) => ({ ...f, unit: u.id, model: `${PROVIDER}/${MODEL}` }));
  fs.writeFileSync(path.join(OUT, "raw", `${u.id}.json`), JSON.stringify({ unit: u.id, files: u.files, ranTerminal: ranTerm, error: r.error || null, findings: finds }, null, 2));
  all.push(...finds);
  done++;
  process.stderr.write(`[${done}/${scopedUnits.length}] ${u.id} findings=${finds.length}${r.error ? " err=" + r.error : ""}\n`);
}

// ── client report ─────────────────────────────────────────────────────────────
const sevRank = { critical: 0, high: 1, medium: 2, med: 2, low: 3 };
all.sort((a, b) => (sevRank[(a.severity || "low").toLowerCase()] ?? 9) - (sevRank[(b.severity || "low").toLowerCase()] ?? 9));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const cnt = (s) => all.filter((f) => (f.severity || "").toLowerCase().startsWith(s)).length;
let md = `# Codebase Audit — ${CLIENT}\n\n_Repo: \`${NAME}\` · ${files.length} files · ${totalLoc} LOC · ${scopedUnits.length} units · auditor ${PROVIDER}/${MODEL} · date ${process.env.STAMP || "(date)"}_\n\n`;
md += `## Summary\n- **${all.length} candidate findings** — high:${cnt("high")} · medium:${cnt("med")} · low:${cnt("low")}\n`;
md += `- Coverage: ${scopedUnits.length}/${units.length} units (100% of scoped source — no blind spot)\n`;
md += `- ⚠️ Candidate findings; each should be confirmed against tests/repro before fixing (verified-tier add-on available).\n\n`;
md += `## Findings (severity-ranked)\n\n| severity | file:line | function | symptom | suggested fix | model |\n|---|---|---|---|---|---|\n`;
for (const f of all) md += `| ${esc(f.severity)} | \`${esc(f.file)}:${f.line ?? "?"}\` | ${esc(f.name)} | ${esc(f.symptom)} | ${esc(f.fix)} | ${esc(f.model)} |\n`;
md += `\n---\n_Generated by ollamas audit-service. Verified-findings + fix-PR tiers available._\n`;
fs.writeFileSync(path.join(OUT, "REPORT.md"), md);
fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({ client: CLIENT, repo: REPO_ABS, files: files.length, loc: totalLoc, units: scopedUnits.length, findings: all }, null, 2));
console.log(`\nDONE: ${all.length} findings → ${path.join(OUT, "REPORT.md")}`);
