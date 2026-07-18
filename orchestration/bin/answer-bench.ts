#!/usr/bin/env tsx
/**
 * orchestration/bin/answer-bench.ts — the accuracy benchmark of the Definitive Answer Doctrine
 * ("most correct answers" as a MEASURED metric, not a feeling — GROUNDED-ANSWER.md §learning).
 *
 * Offline golden set (deterministic, no network): arithmetic ×10 (the canonical 2+2=4 included),
 * real code execution ×4, HTML validation ×4 — every answer compared against the KNOWN truth.
 * `--live` adds fact questions with known answers through the full research-until-verified loop.
 * Writes ANSWER-BENCH.md with the score + the learned channel scoreboard; offline accuracy below
 * 100% exits 1 (the doctrine's floor: computable questions have exactly one right answer).
 *
 * Run:  tsx orchestration/bin/answer-bench.ts [--live] [--json]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evalArithmetic, checkHtml } from "./lib/answer";
import { channelStats, renderScoreboard } from "./lib/answer-learn";
import { readLedger } from "./lib/brain-ledger";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const argv = process.argv.slice(2);
const LIVE = argv.includes("--live");
const JSON_OUT = argv.includes("--json");

interface Row { kind: string; q: string; want: string; got: string; ok: boolean; }

const GOLDEN_ARITH: Array<[string, string]> = [
  ["2+2=?", "4"], ["7*8", "56"], ["100-64", "36"], ["144/12", "12"], ["2^10", "1024"],
  ["(3+4)*(2+5)", "49"], ["-8+3*5", "7"], ["0.5*8", "4"], ["10/4", "2.5"], ["2^3^2", "512"],
];
const GOLDEN_CODE: Array<["python" | "javascript", string, string]> = [
  ["python", "print(sum(range(101)))", "5050"],
  ["python", "print(len('ollamas'))", "7"],
  ["javascript", "console.log([1,2,3].reduce((a,b)=>a+b,0))", "6"],
  ["javascript", "console.log('ecy'.toUpperCase())", "ECY"],
];
const GOLDEN_HTML: Array<[string, string]> = [
  ["<!doctype html><div><p>ok<br></p></div>", "well-formed"],
  ["<ul><li>a</li><li>b</li></ul>", "well-formed"],
  ["<div><p>bad</div>", "UNVERIFIED"],
  ["<div><span></div></span>", "UNVERIFIED"],
];

function runCodeSync(kind: "python" | "javascript", code: string): string {
  const [bin, flag] = kind === "python" ? ["python3", "-c"] : ["node", "-e"];
  try { return execFileSync(bin, [flag, code], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trimEnd(); }
  catch (e) { return `EXEC-FAIL: ${(e as Error).message.slice(0, 60)}`; }
}

async function runLiveFacts(): Promise<Row[]> {
  const facts: Array<[string, string]> = [
    ["In what year was the TypeScript programming language first publicly released by Microsoft?", "2012"],
    ["In what year did the first version of Python (0.9.0) get released by Guido van Rossum?", "1991"],
    ["How many bits are in one byte?", "8"],
  ];
  const rows: Row[] = [];
  for (const [q, want] of facts) {
    try {
      const out = execFileSync(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), join(HERE, "answer.ts"), "--fact", "--json", q],
        { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });
      const v = JSON.parse(out.trim().split("\n").pop()!) as { definitive: boolean; answer?: string };
      rows.push({ kind: "fact", q: q.slice(0, 60), want, got: v.answer ?? "UNVERIFIED", ok: v.definitive && v.answer === want });
    } catch (e) { rows.push({ kind: "fact", q: q.slice(0, 60), want, got: `error: ${(e as Error).message.slice(0, 50)}`, ok: false }); }
  }
  return rows;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (const [q, want] of GOLDEN_ARITH) {
    const v = evalArithmetic(q);
    rows.push({ kind: "arithmetic", q, want, got: v.answer ?? "UNVERIFIED", ok: v.definitive && v.answer === want });
  }
  for (const [kind, code, want] of GOLDEN_CODE) {
    const got = runCodeSync(kind, code);
    rows.push({ kind, q: code.slice(0, 50), want, got, ok: got === want });
  }
  for (const [src, want] of GOLDEN_HTML) {
    const v = checkHtml(src);
    const got = v.definitive ? v.answer! : "UNVERIFIED";
    rows.push({ kind: "html", q: src.slice(0, 40), want, got, ok: got === want });
  }
  const offlineOk = rows.filter((r) => r.ok).length;
  const offlineTotal = rows.length;

  const liveRows = LIVE ? await runLiveFacts() : [];
  rows.push(...liveRows);

  const stats = channelStats(readLedger().flatMap((r) =>
    typeof r.meta?.ok === "boolean" && typeof r.meta?.taskId === "string" && typeof r.meta?.actorId === "string"
      ? [{ type: "outcome" as const, tier: r.tier, ts: r.ts, taskId: r.meta.taskId as string, actorId: r.meta.actorId as string, ok: r.meta.ok as boolean, summary: r.fact }]
      : []));
  const board = renderScoreboard(stats);

  const okAll = rows.filter((r) => r.ok).length;
  const md = [
    `# ANSWER-BENCH — Definitive Answer Doctrine accuracy (${LIVE ? "offline+live" : "offline"})`,
    ``,
    `- offline (computable — exactly one right answer): **${offlineOk}/${offlineTotal}**${LIVE ? `\n- live facts (research-until-verified): **${liveRows.filter((r) => r.ok).length}/${liveRows.length}**` : ""}`,
    `- learned channel scoreboard (from the brain ledger):`,
    ...(board.length ? board.map((l) => `  - ${l}`) : ["  - (no channel evidence recorded yet)"]),
    ``,
    `| kind | question | expected | got | ok |`,
    `|------|----------|----------|-----|----|`,
    ...rows.map((r) => `| ${r.kind} | \`${r.q.replace(/\|/g, "\\|")}\` | ${r.want} | ${r.got.replace(/\|/g, "\\|").slice(0, 40)} | ${r.ok ? "✅" : "❌"} |`),
    ``,
    `> Floor: offline accuracy MUST be 100% (computable questions are either right or wrong).`,
    `> Rerun: \`tsx orchestration/bin/answer-bench.ts [--live]\`.`,
  ].join("\n");
  writeFileSync(join(ORCH_DIR, "ANSWER-BENCH.md"), md + "\n");

  if (JSON_OUT) console.log(JSON.stringify({ offlineOk, offlineTotal, ok: okAll, total: rows.length, scoreboard: board }));
  else process.stdout.write(md + "\n");
  process.exit(offlineOk === offlineTotal ? 0 : 1);
}

main().catch((e) => { console.error("[answer-bench] fatal:", (e as Error)?.message ?? e); process.exit(1); });
