// fleet-agent seams — tests the PURE pipeline bin/fleet-agent.ts composes (report parse → self-gate →
// vendor-candidate derivation → merged-budget pool fail-over → exhaustion contract → grounding targets)
// without spawning agent-dispatch/gemini or touching the network. Provider routing lives in
// tests/fleet-agent-provider.test.ts — NOT repeated here.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STREAMS } from "../bin/lib/fleet-plan";
import { dispatchTarget } from "../bin/lib/chrome-probe";
import { FOCUS, focusFile } from "../bin/lib/fleet-prompt";
import { saveQuota, loadQuota } from "../bin/lib/gemini-quota";
import { guardQuota } from "../bin/lib/gemini-quota";
import { saveBudget, loadBudget, guardVendor, pickVendor, isVendorExhausted, type BudgetFile } from "../bin/lib/vendor-budget";

const TODAY = "2026-07-04";
const REPO = join(__dirname, "..", "..");

/** Reproduce fleet-agent's parseReport: verdict + proposal (from "## Change") + tool-step count. */
function parseReport(out: string): { verdict: string; proposal: string; steps: number } {
  const j = JSON.parse(out);
  const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n") : "";
  const i = msgs.search(/##\s*Change/i);
  const proposal = i >= 0 ? msgs.slice(i).trim() : "";
  return { verdict: j.verdict ?? "?", proposal, steps: (j.steps ?? []).length };
}
/** Reproduce main()'s self-gate: DONE/OK verdict AND a "## Change" proposal. */
const gated = (r: { verdict: string; proposal: string }) =>
  (r.verdict === "DONE" || r.verdict === "OK") && /##\s*Change/i.test(r.proposal);

describe("fleet-agent parseReport + self-gate (main()'s escalation exit condition)", () => {
  it("a zero-step PROPOSE run with the proposal in messages still gates (vO39 root-fix)", () => {
    const out = JSON.stringify({ verdict: "DONE", steps: [], messages: ["preamble", "## Change: harden x\nbody\nVERDICT: DONE"] });
    const r = parseReport(out);
    expect(r.steps).toBe(0);
    expect(r.proposal.startsWith("## Change: harden x")).toBe(true);
    expect(gated(r)).toBe(true);
  });
  it("chatty DONE without a ## Change block does NOT gate (retry with more budget)", () => {
    const r = parseReport(JSON.stringify({ verdict: "DONE", steps: [{ n: 1 }], messages: ["I did it, trust me. VERDICT: DONE"] }));
    expect(r.proposal).toBe("");
    expect(gated(r)).toBe(false);
  });
  it("missing verdict/messages degrade gracefully (verdict '?', no gate, no throw)", () => {
    const r = parseReport(JSON.stringify({ steps: [] }));
    expect(r).toEqual({ verdict: "?", proposal: "", steps: 0 });
    expect(gated(r)).toBe(false);
  });
});

/** Reproduce main()'s streamVendorCandidates: prefer entries → managed free-tier vendor candidates. */
function streamVendorCandidates(streamId: string): { vendor: string; provider: string; model: string }[] {
  const spec = STREAMS.find((s) => s.id === streamId);
  if (!spec) return [];
  const out: { vendor: string; provider: string; model: string }[] = [];
  for (const p of spec.prefer) {
    const [vendor, model] = p.split("::");
    if (model) { out.push({ vendor, provider: vendor, model }); continue; }
    if (/^gemini[-.\d]/i.test(p)) out.push({ vendor: "gemini", provider: "gemini-cli", model: p });
  }
  return out;
}

describe("fleet-agent vendor-candidate derivation over the live STREAMS data", () => {
  it("errors-resilience yields gemini + groq candidates; bare ollama tags carry no budget", () => {
    const c = streamVendorCandidates("errors-resilience");
    expect(c).toContainEqual({ vendor: "gemini", provider: "gemini-cli", model: "gemini-2.5-flash" });
    expect(c).toContainEqual({ vendor: "groq", provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(c.some((x) => x.model.includes(":") && !x.model.includes("::"))).toBe(false); // no ollama tags leaked
  });
  it("every derived API candidate agrees with dispatchTarget on the raw prefer entry", () => {
    for (const s of STREAMS) {
      for (const p of s.prefer.filter((m) => m.includes("::"))) {
        const c = streamVendorCandidates(s.id).find((x) => `${x.provider}::${x.model}` === p)!;
        expect(dispatchTarget(p)).toEqual({ provider: c.provider, model: c.model });
      }
    }
  });
});

describe("fleet-agent pool fail-over (combinedBudget: pool file + gemini single-state merge)", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  it("gemini exhausted in ITS OWN quota file + groq fresh in the pool → picks groq", () => {
    dir = mkdtempSync(join(tmpdir(), "fleet-agent-"));
    const quotaF = join(dir, "gemini-quota.json");
    const budgetF = join(dir, "vendor-budget.json");
    saveQuota(quotaF, { date: TODAY, used: 20, limit: 20 });         // latched for the day
    saveBudget(budgetF, { groq: { date: TODAY, used: 3, limit: 20 } });
    // exactly main()'s combinedBudget: pool map + map.gemini = loadQuota(single-state file)
    const map: BudgetFile = loadBudget(budgetF);
    map.gemini = loadQuota(quotaF);
    expect(pickVendor(["gemini", "groq"], map, TODAY, ["gemini", "groq"])).toBe("groq");
  });
  it("every candidate vendor spent → null (honest ERROR, loop waits for reset)", () => {
    dir = mkdtempSync(join(tmpdir(), "fleet-agent-"));
    const quotaF = join(dir, "gemini-quota.json");
    const budgetF = join(dir, "vendor-budget.json");
    saveQuota(quotaF, { date: TODAY, used: 20, limit: 20 });
    saveBudget(budgetF, { groq: { date: TODAY, used: 20, limit: 20 } });
    const map: BudgetFile = loadBudget(budgetF);
    map.gemini = loadQuota(quotaF);
    expect(pickVendor(["gemini", "groq"], map, TODAY)).toBeNull();
  });
});

/** Reproduce main()'s isExhaustionErr: shared detector OR this layer's own budget-gate wording. */
const isExhaustionErr = (err?: string) => !!err && (isVendorExhausted(err) || /budget|exhaust/i.test(err));

describe("fleet-agent exhaustion contract — pre-flight gate messages must trigger fail-over", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  it("guardVendor's blocked msg and guardQuota's blocked msg are both recognized", () => {
    dir = mkdtempSync(join(tmpdir(), "fleet-agent-"));
    const budgetF = join(dir, "vendor-budget.json");
    const quotaF = join(dir, "gemini-quota.json");
    saveBudget(budgetF, { groq: { date: TODAY, used: 20, limit: 20 } });
    saveQuota(quotaF, { date: TODAY, used: 20, limit: 20 });
    const gv = guardVendor(budgetF, "groq", TODAY);
    const gq = guardQuota(quotaF, TODAY);
    expect(gv.allowed).toBe(false);
    expect(gq.allowed).toBe(false);
    expect(isExhaustionErr(gv.msg)).toBe(true);   // → poolFallback fires
    expect(isExhaustionErr(gq.msg)).toBe(true);
    expect(isExhaustionErr("503 model overloaded")).toBe(false); // transient ≠ exhausted (backoff, not fail-over)
  });
});

describe("fleet-agent gemini grounding contract — FOCUS targets must exist on disk", () => {
  it("every STREAMS id has a focus file and it exists at the repo root", () => {
    for (const s of STREAMS) {
      const target = focusFile(s.id);
      expect(target, `stream ${s.id} needs a FOCUS entry`).not.toBe("");
      expect(existsSync(join(REPO, target)), `${target} (stream ${s.id}) missing`).toBe(true);
    }
    expect(Object.keys(FOCUS).sort()).toEqual(STREAMS.map((s) => s.id).sort());
  });
});
