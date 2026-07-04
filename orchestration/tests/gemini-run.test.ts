// gemini-run seams — the bin (orchestration/bin/gemini-run.ts) is main-only (top-level argv dispatch +
// process.exit at import → NOT importable). tests/gemini.test.ts covers lib/gemini; gemini-quota/vendor-
// budget/vendor-propose have their own unit tests. Here we test the bin's OWN composition seams, exactly
// as it wires them: the --budget view shaping, the --propose grounding guard + prompt, the PROPOSAL.md
// report shape (header must stay apply-ready downstream), the vO60 pool acceptance chain, and the
// dispatchVendorOnce failure-classification order (exhausted latches BEFORE transient retries).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadQuota, remaining, todayKey } from "../bin/lib/gemini-quota";
import { loadBudget, remaining as vendorRemaining, defaultLimitFor, isVendorExhausted } from "../bin/lib/vendor-budget";
import { focusFile, geminiGroundedPrompt } from "../bin/lib/fleet-prompt";
import { isActionableProposal, extractProposalText } from "../bin/lib/vendor-propose";
import { parseSearchReplace } from "../bin/lib/search-replace";
import { isTransient } from "../bin/lib/backoff";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // same resolution as the bin's HERE/../..

const SR = [
  "## Change: guard the SSE stream",
  "### file: server/agent-events.ts",
  "<<<<<<< SEARCH",
  "const a = 1;",
  "=======",
  "const a = 2;",
  ">>>>>>> REPLACE",
  "VERDICT: DONE.",
].join("\n");

describe("--budget view composition (gemini single-state file + API vendor pool)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gemini-run-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("stale gemini day shows used=0 + full remaining; pool rows mix real + default vendor states", () => {
    const today = todayKey();
    const quotaFile = join(dir, "gemini-quota.json");
    const budgetFile = join(dir, "vendor-budget.json");
    writeFileSync(quotaFile, JSON.stringify({ date: "2020-01-01", used: 5, limit: 20 }));
    writeFileSync(budgetFile, JSON.stringify({ groq: { date: today, used: 3, limit: 30 } }));
    // exactly the bin's --budget row shaping (gemini from the single-state file, API vendors from the pool)
    const gq = loadQuota(quotaFile);
    const gView = { vendor: "gemini", used: gq.date === today ? gq.used : 0, limit: gq.limit, remaining: remaining(gq, today) };
    expect(gView).toEqual({ vendor: "gemini", used: 0, limit: 20, remaining: 20 }); // stale day rolled over, not 5/15
    const pool = loadBudget(budgetFile);
    const rows = ["groq", "cerebras", "zai"].map((v) => {
      const st = pool[v] ?? { date: today, used: 0, limit: defaultLimitFor(v) };
      return { vendor: v, used: st.date === today ? st.used : 0, limit: st.limit, remaining: vendorRemaining(st, today) };
    });
    expect(rows[0]).toEqual({ vendor: "groq", used: 3, limit: 30, remaining: 27 });
    expect(rows[1]).toEqual({ vendor: "cerebras", used: 0, limit: defaultLimitFor("cerebras"), remaining: defaultLimitFor("cerebras") });
    expect(rows[2].remaining).toBe(rows[2].limit); // absent vendor → fresh default state
  });
});

describe("--propose grounding (focusFile + existsSync + geminiGroundedPrompt, as the bin composes them)", () => {
  it("unknown stream → empty target → the bin's exit-2 guard condition fires", () => {
    const target = focusFile("no-such-stream");
    expect(target).toBe("");
    expect(!target || !existsSync(join(REPO, target))).toBe(true);
  });

  it("known stream resolves a REAL repo file and the grounded prompt inlines its exact content", () => {
    const target = focusFile("errors-resilience");
    expect(target).toBe("server/agent-events.ts");
    const abs = join(REPO, target);
    expect(existsSync(abs)).toBe(true);
    const content = readFileSync(abs, "utf8");
    const prompt = geminiGroundedPrompt("errors-resilience", target, content);
    expect(prompt).toContain(`--- BEGIN ${target} ---`);
    expect(prompt).toContain(content.split("\n")[0]); // verbatim first line → SEARCH can be copied exactly
    expect(prompt).toContain(`stream "errors-resilience"`);
    expect(prompt).toContain("<<<<<<< SEARCH"); // apply-ready SR shape instructions present
  });
});

describe("PROPOSAL.md report shaping", () => {
  it("the bin's `# stream · vendor · model` header keeps the body apply-ready for fleet-apply", () => {
    // exact write shape from both the gemini and pool paths: `# ${stream} · ${vendor} · ${model}\n\n${text}\n`
    const doc = `# errors-resilience · gemini · gemini-2.5-flash\n\n${SR}\n`;
    expect(isActionableProposal(doc)).toBe(true); // header/footer must not break the downstream gate
    const edits = parseSearchReplace(doc);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({ file: "server/agent-events.ts", search: "const a = 1;", replace: "const a = 2;" });
  });
});

describe("pool acceptance chain — extractProposalText → isActionableProposal (vO60 empty-success guard)", () => {
  const report = (messages: unknown) => JSON.stringify({ ok: true, steps: 1, messages });

  it("an agent-dispatch report carrying an SR body is accepted end-to-end", () => {
    const text = extractProposalText(report(["## Plan: one small guard", SR]));
    expect(isActionableProposal(text)).toBe(true);
  });

  it("prose / empty / non-JSON bodies are all REJECTED before being written or counted", () => {
    const prose = extractProposalText(report(["The file looks fine; I would suggest adding error handling."]));
    expect(prose.length).toBeGreaterThan(20); // extracted fine…
    expect(isActionableProposal(prose)).toBe(false); // …but not apply-shaped → rejected
    expect(isActionableProposal(extractProposalText(report([])))).toBe(false); // the vO60 empty-success bug
    expect(isActionableProposal(extractProposalText("Error: ECONNREFUSED"))).toBe(false); // stderr blob, not a report
  });
});

describe("dispatchVendorOnce failure classification — exhausted latches BEFORE transient retries", () => {
  it("a 429 blob matches BOTH classifiers, so the bin's exhausted-first order decides (fail over, not retry); a plain timeout stays transient", () => {
    const quota = "HTTP 429 too many requests — rate limit; please retry";
    expect(isVendorExhausted(quota)).toBe(true); // checked first by the bin → latch + fail over
    expect(isTransient(quota)).toBe(true); // would also retry — order is the seam
    const timeout = "fetch failed: ETIMEDOUT";
    expect(isVendorExhausted(timeout)).toBe(false);
    expect(isTransient(timeout)).toBe(true); // retried with full-jitter backoff, never latched
  });
});
