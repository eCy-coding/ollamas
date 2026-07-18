#!/usr/bin/env tsx
/**
 * orchestration/bin/answer.ts — `ollamas answer`: the Definitive Answer Doctrine runner
 * (GROUNDED-ANSWER.md; pure core in lib/answer.ts).
 *
 * Arithmetic → COMPUTED by the deterministic evaluator. Code → EXECUTED for real (python3 / node,
 * bounded, output captured verbatim). HTML → mechanically VALIDATED. Facts → routed to the research
 * bridge and answered ONLY with a source attached; no source → UNVERIFIED. Every verdict is either
 * DEFINITIVE-with-evidence or an honest refusal to guess. Failures are recorded to the brain ledger.
 *
 * Run:
 *   tsx orchestration/bin/answer.ts "2+2=?"
 *   tsx orchestration/bin/answer.ts --python 'print(2+2)'
 *   tsx orchestration/bin/answer.ts --js 'console.log(2+2)'
 *   tsx orchestration/bin/answer.ts --html '<div><p>hi</p></div>'
 *   tsx orchestration/bin/answer.ts --fact "what year was TypeScript released"
 *   tsx orchestration/bin/answer.ts --json "…"
 */
import { execFileSync } from "node:child_process";
import { classifyQuestion, evalArithmetic, checkHtml, renderVerdict, definitive, unverified, type Verdict, type QuestionKind } from "./lib/answer";
import { corroborate, extractKeyFact, renderImpasse, type ResearchAttempt } from "./lib/answer-research";
import { channelStats, orderChannels, channelOutcomes, questionKey } from "./lib/answer-learn";
import { remember, readLedger } from "./lib/brain-ledger";
import { emitEvent, resetRun } from "./lib/tracker-io";
import type { LedgerEntry } from "./lib/organization";

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const FORCED: QuestionKind | null =
  argv.includes("--python") ? "python" : argv.includes("--js") ? "javascript"
  : argv.includes("--html") ? "html" : argv.includes("--fact") ? "fact" : null;
const question = argv.filter((a) => !a.startsWith("--")).join(" ");
const EXEC_MS = Number(process.env.ANSWER_EXEC_MS || 10_000);

/** Real execution — the answer IS the captured output (law #3). Errors reported verbatim. */
function runCode(kind: "python" | "javascript", code: string): Verdict {
  const [bin, flag] = kind === "python" ? ["python3", "-c"] : ["node", "-e"];
  try {
    const out = execFileSync(bin, [flag, code], { encoding: "utf8", timeout: EXEC_MS, stdio: ["ignore", "pipe", "pipe"] });
    const answer = out.trimEnd();
    return definitive(kind, answer === "" ? "(no output, exit 0)" : answer, "executed",
      `${bin} ran the code for real; stdout captured verbatim`);
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    const detail = (err.stderr?.toString().trim() || err.message).slice(0, 400);
    return unverified(kind, `execution failed — reported verbatim, not guessed:\n   ${detail.replace(/\n/g, "\n   ")}`);
  }
}

// ── Facts: RESEARCH-UNTIL-VERIFIED (it is either right or wrong — GROUNDED-ANSWER.md §research) ──
// One channel's claim is a CANDIDATE, never an answer. The loop keeps researching across
// independent channels until ≥2 agree on the same key fact (corroboration = DEFINITIVE). Only when
// every channel is exhausted does it report the impasse honestly — candidates + sources on the
// record, gap remembered in the brain for the next attempt.

const CITE = "Answer with the single key fact FIRST (one line), then the source (name + where to check). If you truly cannot ground it, reply exactly: UNVERIFIABLE.";

async function channelOdysseus(q: string): Promise<ResearchAttempt> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/odysseus/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "research", query: `${q}\n\n${CITE}` }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json() as { ok?: boolean; result?: string };
    const text = (body.result ?? "").trim();
    // ORG-FAULT-ODY-001: ok:true can embed an error in the text — scan payload, never trust ok alone.
    const usable = Boolean(body.ok) && text.length > 0 && !/UNVERIFIABLE|error|exception/i.test(text.slice(0, 80));
    return { channel: "odysseus-research", text, ok: usable };
  } catch (e) {
    return { channel: "odysseus-research", text: (e as Error).message, ok: false };
  }
}

function channelCloud(provider: string): (q: string) => Promise<ResearchAttempt> {
  return async (q: string) => {
    const channel = `cloud:${provider}`;
    try {
      const res = await fetch("http://127.0.0.1:3000/api/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, messages: [{ role: "user", content: `${q}\n\n${CITE}` }] }),
        signal: AbortSignal.timeout(45_000),
      });
      const body = await res.json() as { text?: string };
      const text = (body.text ?? "").trim();
      return { channel, text, ok: text.length > 0 && !/UNVERIFIABLE/i.test(text.slice(0, 40)) };
    } catch (e) {
      return { channel, text: (e as Error).message, ok: false };
    }
  };
}

/** Baseline channel order (cheapest-diverse). The LIVE order is learned: channels with ≥3 recorded
 *  outcomes are re-ranked by Wilson accuracy — the loop consults its historically-best sources
 *  first, and gets better with every question it settles (answer-learn.ts). */
const BASELINE_CHANNELS = ["odysseus-research", "cloud:groq", "cloud:gemini", "cloud:github-models", "cloud:cerebras"];
const CHANNEL_FNS: Record<string, (q: string) => Promise<ResearchAttempt>> = {
  "odysseus-research": channelOdysseus,
  "cloud:groq": channelCloud("groq"),
  "cloud:gemini": channelCloud("gemini"),
  "cloud:github-models": channelCloud("github-models"),
  "cloud:cerebras": channelCloud("cerebras"),
};

/** Persist one corroboration round's channel hits/misses (+ live scoreboard to stderr). */
function recordRound(q: string, attempts: ResearchAttempt[], agreed: string | null): void {
  try {
    const entries = channelOutcomes(
      questionKey(q),
      attempts.map((a) => ({ channel: a.channel, ok: a.ok, fact: a.ok ? extractKeyFact(a.text) : null })),
      agreed, new Date().toISOString(),
    );
    for (const e of entries) remember(e.tier, `${e.summary} [${e.actorId}]`, { ok: e.ok, actorId: e.actorId, taskId: e.taskId }, e.ts);
  } catch { /* best-effort — learning must never block answering */ }
}

/** Rebuild structured entries from brain records (same reconstruction as org-train). */
function ledgerEntries(): LedgerEntry[] {
  return readLedger().flatMap((r): LedgerEntry[] => {
    const ok = r.meta?.ok;
    if (typeof ok !== "boolean" || typeof r.meta?.taskId !== "string" || typeof r.meta?.actorId !== "string") return [];
    return [{ type: "outcome", tier: r.tier, ts: r.ts, taskId: r.meta.taskId as string, actorId: r.meta.actorId as string, ok, summary: r.fact }];
  });
}

async function answerFact(q: string, maxChannels = BASELINE_CHANNELS.length): Promise<Verdict> {
  const stats = channelStats(ledgerEntries());
  const order = orderChannels(BASELINE_CHANNELS, stats);
  const runId = `ollamas:answer-${questionKey(q)}`;
  const ts = () => new Date().toISOString();
  try {
    resetRun();
    emitEvent({ type: "start", ts: ts(), runId, title: `Araştırılıyor: ${q.slice(0, 60)}`, source: "ollamas", items: order.map((id) => ({ id, label: `${id} kanalı` })) });
  } catch { /* tracker best-effort */ }
  if (!JSON_OUT && stats.size > 0) process.stderr.write(`  📊 öğrenilmiş kanal sırası: ${order.join(" → ")}\n`);

  const attempts: ResearchAttempt[] = [];
  for (const id of order.slice(0, Math.min(maxChannels, order.length))) {
    try { emitEvent({ type: "item", ts: ts(), runId, id, status: "active" }); } catch { /* */ }
    const attempt = await CHANNEL_FNS[id](q);
    attempts.push(attempt);
    if (!JSON_OUT) process.stderr.write(`  🔎 ${attempt.channel}: ${attempt.ok ? `"${(extractKeyFact(attempt.text) ?? "?")}"` : "kanal sessiz"}\n`);
    const c = corroborate(attempts);
    try { emitEvent({ type: "item", ts: ts(), runId, id, status: attempt.ok ? "done" : "failed" }); } catch { /* */ }
    if (c.agreed) {
      recordRound(q, attempts, c.agreed); // hits AND outvoted misses become permanent evidence
      try { emitEvent({ type: "finish", ts: ts(), runId }); } catch { /* */ }
      const backers = c.votes[0].channels;
      const sourceTexts = attempts.filter((a) => a.ok && backers.includes(a.channel)).map((a) => `[${a.channel}] ${a.text.slice(0, 220)}`);
      return definitive("fact", c.agreed, `corroborated(${backers.join("+")})`,
        `${backers.length} independent channels agree on "${c.agreed}":\n   ${sourceTexts.join("\n   ")}`);
    }
  }
  try { emitEvent({ type: "finish", ts: ts(), runId }); } catch { /* */ }
  const c = corroborate(attempts);
  return unverified("fact", renderImpasse(c.votes, attempts.length) + " — gap recorded; research continues on the next ask.");
}

async function main(): Promise<void> {
  if (!question) { console.error('kullanım: answer.ts [--python|--js|--html|--fact] "<soru>"'); process.exit(2); }
  const kind = FORCED ?? classifyQuestion(question);
  let v: Verdict;
  switch (kind) {
    case "arithmetic": v = evalArithmetic(question); break;
    case "python": v = runCode("python", question); break;
    case "javascript": v = runCode("javascript", question); break;
    case "html": v = checkHtml(question); break;
    case "fact": v = await answerFact(question); break;
  }
  if (!v.definitive) {
    try { remember("learned", `answer UNVERIFIED (${v.kind}): "${question.slice(0, 120)}" — ${v.evidence.slice(0, 200)}`, { doctrine: "grounded-answer" }); } catch { /* best-effort */ }
  }
  if (JSON_OUT) console.log(JSON.stringify(v));
  else process.stdout.write(renderVerdict(v) + "\n");
  process.exit(v.definitive ? 0 : 1);
}

main().catch((e) => { console.error("[answer] fatal:", (e as Error)?.message ?? e); process.exit(1); });
