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
import { remember } from "./lib/brain-ledger";

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

/** Facts: only a sourced answer counts. Research bridge (odysseus via :3000) supplies the source;
 *  unreachable/empty → UNVERIFIED (law #4: no source, no answer). */
async function answerFact(q: string): Promise<Verdict> {
  try {
    const res = await fetch("http://127.0.0.1:3000/api/odysseus/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "research", query: `${q}\n\nAnswer definitively and CITE the source (name + where it can be checked). If you cannot ground the answer in a source, reply exactly: UNVERIFIABLE.` }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json() as { ok?: boolean; result?: string };
    const text = (body.result ?? "").trim();
    // ORG-FAULT-ODY-001: ok:true can embed an error in the text — scan payload, never trust ok alone.
    if (!body.ok || !text || /UNVERIFIABLE|error|exception/i.test(text.slice(0, 80))) {
      return unverified("fact", `no sourced answer available (bridge said: ${text.slice(0, 120) || "empty"})`);
    }
    return definitive("fact", text.split("\n")[0].slice(0, 200), "sourced(odysseus research)", text.slice(0, 500));
  } catch (e) {
    return unverified("fact", `research bridge unreachable — refusing to answer from model memory (${(e as Error).message.slice(0, 80)})`);
  }
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
