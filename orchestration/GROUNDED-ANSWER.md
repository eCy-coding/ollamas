# GROUNDED-ANSWER.md — The Definitive Answer Doctrine

> The rich-English, assumption-free formulation of the operator's requirement, and the master prompt
> every answering surface of ollamas (and its sub-models) must obey. Engine: `bin/lib/answer.ts` ·
> CLI: `ollamas answer` (`bin/answer.ts`) · Tests: `tests/answer.test.ts`.

## The requirement, translated faithfully and completely

> **I do not want a system that assumes.** When I write `2+2=?`, I do not want something that wonders
> "is it perhaps 4? could it be 5, or maybe 3?" — I want a system that goes to the SOURCE of truth
> for that question, finds that the correct answer is 4, and states **definitively: 4**. This holds
> for ANY mathematics question I ask; it holds for ANY Python code; it holds for C-family languages
> and HTML5; and it holds for ANY general-knowledge question. Think step by step — but let every step
> stand on verified ground, never on guesswork.

## The doctrine (how "no assumptions" becomes executable)

An answer is allowed exactly these shapes. Nothing in between exists:

1. **DEFINITIVE** — the answer was obtained from its authoritative source, and the evidence ships
   with it:
   - **Mathematics** → the expression is COMPUTED by a deterministic evaluator (not predicted by a
     model). `2+2=?` → the evaluator computes → **4**. The evidence is the computation itself.
   - **Code (Python, JavaScript/TypeScript, C-family)** → the code is EXECUTED (or compiled) in a
     bounded sandbox and the ACTUAL output/exit state is the answer. "What does `print(2+2)` print?"
     → run it → **`4`** — because it *did* print 4, not because a model believes it would.
   - **Markup (HTML5)** → the document is mechanically VALIDATED (structure checked), and the
     verdict reports exactly what was checked.
   - **General knowledge** → the answer must arrive WITH its source (research bridge / registry /
     documented reference). A fact without a source is not an answer; it is a guess wearing a suit.
2. **RESEARCH-UNTIL-VERIFIED (facts never stop at "I don't know")** — a fact question that no
   single channel can settle triggers the research loop: INDEPENDENT channels are consulted one
   after another (odysseus deep research, then diverse cloud corpora), every claim is only a
   CANDIDATE, and the answer becomes DEFINITIVE the moment **two independent channels agree on the
   same key fact** (corroboration). A wrong claim from one channel cannot survive — it is outvoted,
   as it must be: *the answer is either right or wrong.* Engine: `bin/lib/answer-research.ts`
   (extractKeyFact + corroborate, deterministic), loop in `bin/answer.ts`.
3. **UNVERIFIED (honest impasse, never a guess)** — when no verification path exists (the expression is
   malformed, the runtime is unavailable, no source can be reached), the system says exactly that:
   *"cannot verify — here is what failed"*. It never fills the gap with a plausible number, never
   hedges with "probably", never offers three candidate answers. **"I don't know, and here is why"
   is a first-class answer. A confident guess is a defect.**

## Laws

1. **Source before sentence.** No answer is uttered before its verification path has run.
2. **Compute, don't recall, arithmetic.** Any calculable expression goes through the evaluator —
   even trivial ones. The model's memory of arithmetic is not a source.
3. **Run, don't simulate, code.** Code-behavior questions are answered by real execution with real
   captured output. Timeouts and errors are reported as themselves.
4. **Cite, don't improvise, facts.** Knowledge answers carry their source inline. No source → UNVERIFIED.
5. **One answer, stated once.** DEFINITIVE answers are stated plainly ("**4**"), with evidence
   attached — no hedging language ("maybe", "I think", "it could be") is permitted in them.
6. **Step by step, on the record.** Multi-step questions verify each step; the chain of evidence is
   part of the answer.
7. **Failure is spoken, never smoothed.** A failed verification is reported verbatim (the parser
   error, the traceback, the unreachable source) — and recorded to the brain ledger so the same gap
   is not stumbled into twice.

## Usage

```bash
tsx orchestration/bin/answer.ts "2+2=?"                      # → 4 — DEFINITIVE (computed)
tsx orchestration/bin/answer.ts --python 'print(sum(range(11)))'   # → 55 — DEFINITIVE (executed)
tsx orchestration/bin/answer.ts --js 'console.log([1,2,3].map(x=>x*2))'
tsx orchestration/bin/answer.ts --html '<div><p>hi</p></div>'      # structure verdict
tsx orchestration/bin/answer.ts "1/0"                        # → UNVERIFIED: division by zero (honest)
```

## §learning — the loop that gets better with every question

Accuracy is not a hope; it is a trained, measured property (`bin/lib/answer-learn.ts`):

- **Every settled round trains the router.** Channels that backed the corroborated fact record a
  hit; channels whose claim was OUTVOTED record a miss (a wrong "2014" is a permanent, evidence-
  lowering event). Rounds WITHOUT agreement record nothing — scoring without ground truth would
  itself be guessing.
- **The research order is learned.** `orderChannels` re-ranks channels by Wilson accuracy (n≥3;
  thin evidence keeps the hand-tuned baseline) — the loop consults its historically-best sources
  first. Observed live: after three settled rounds, cloud:groq (3/3) overtook odysseus-research,
  whose long-report number extraction had been outvoted twice.
- **Accuracy is benchmarked.** `bin/answer-bench.ts` runs the golden set (offline computables MUST
  score 100% — they are either right or wrong) plus optional live facts, and prints the learned
  channel scoreboard → `ANSWER-BENCH.md`. Interactive live view: every research round streams its
  channel probes to `ollamas follow`.
- **Known limit on the record:** long research reports can yield a wrong FIRST number to
  `extractKeyFact` (observed: odysseus "21.4"/"6.2") — safely outvoted today; answer-line-priority
  extraction is the next accuracy upgrade.
