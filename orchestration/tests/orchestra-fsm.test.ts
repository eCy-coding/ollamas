import { describe, it, expect } from "vitest";
import {
  nextPhase, bumpRetry, shouldResetRetry, isBlocking, enqueueTask, dequeueTask, pruneHistory,
  normalizeState, emptyOrchestraState, statusLine, RETRY_MAX, HISTORY_MAX, type PhaseInput,
} from "../bin/lib/orchestra-fsm";

const inp = (o: Partial<PhaseInput>): PhaseInput =>
  ({ phase: "MONITORING", actionTier: null, hasTask: false, converged: false, retryExceeded: false, ...o });

describe("nextPhase — the FSM walk", () => {
  it("linear boot → council → benchmark", () => {
    expect(nextPhase(inp({ phase: "BOOTSTRAPPING" }))).toBe("COUNCIL_DEBATE");
    expect(nextPhase(inp({ phase: "COUNCIL_DEBATE" }))).toBe("BENCHMARK_VALIDATION");
  });
  it("gate: converged + nothing broken + no task → DEPLOYMENT", () => {
    expect(nextPhase(inp({ phase: "BENCHMARK_VALIDATION", converged: true, actionTier: null, hasTask: false }))).toBe("DEPLOYMENT");
  });
  it("gate: not converged OR blocking tier OR explicit task → REPAIR", () => {
    expect(nextPhase(inp({ phase: "BENCHMARK_VALIDATION", converged: false }))).toBe("REPAIR");
    expect(nextPhase(inp({ phase: "BENCHMARK_VALIDATION", converged: true, actionTier: "RED" }))).toBe("REPAIR");
    expect(nextPhase(inp({ phase: "BENCHMARK_VALIDATION", converged: true, actionTier: null, hasTask: true }))).toBe("REPAIR");
  });
  it("repair loops to benchmark until retry cap → ESCALATE", () => {
    expect(nextPhase(inp({ phase: "REPAIR", retryExceeded: false }))).toBe("BENCHMARK_VALIDATION");
    expect(nextPhase(inp({ phase: "REPAIR", retryExceeded: true }))).toBe("ESCALATE");
  });
  it("deployment → monitoring; monitoring holds unless task/broken", () => {
    expect(nextPhase(inp({ phase: "DEPLOYMENT" }))).toBe("MONITORING");
    expect(nextPhase(inp({ phase: "MONITORING" }))).toBe("MONITORING");
    expect(nextPhase(inp({ phase: "MONITORING", hasTask: true }))).toBe("COUNCIL_DEBATE");
    expect(nextPhase(inp({ phase: "MONITORING", actionTier: "SECURITY" }))).toBe("COUNCIL_DEBATE");
  });
  it("escalate parks until a new task arrives", () => {
    expect(nextPhase(inp({ phase: "ESCALATE" }))).toBe("ESCALATE");
    expect(nextPhase(inp({ phase: "ESCALATE", hasTask: true }))).toBe("COUNCIL_DEBATE");
  });
});

describe("retry accounting", () => {
  it("bumpRetry increments + flags cap at RETRY_MAX", () => {
    let c = 0, r = bumpRetry(c); expect(r.retry_count).toBe(1); expect(r.exceeded).toBe(false);
    for (let i = 1; i < RETRY_MAX; i++) r = bumpRetry(r.retry_count);
    expect(r.retry_count).toBe(RETRY_MAX); expect(r.exceeded).toBe(true);
  });
  it("resets on deploy/new-council entry", () => {
    expect(shouldResetRetry("DEPLOYMENT")).toBe(true);
    expect(shouldResetRetry("COUNCIL_DEBATE")).toBe(true);
    expect(shouldResetRetry("REPAIR")).toBe(false);
  });
});

describe("task queue + blocking", () => {
  it("isBlocking only for RED/SECURITY/CONTRACT/REGRESSION", () => {
    expect(isBlocking("RED")).toBe(true);
    expect(isBlocking("ROADMAP")).toBe(false);
    expect(isBlocking(null)).toBe(false);
  });
  it("enqueue is idempotent on consecutive dupes; dequeue is FIFO", () => {
    let s = emptyOrchestraState("m");
    s = enqueueTask(s, "a"); s = enqueueTask(s, "a"); s = enqueueTask(s, "b");
    expect(s.pending_actions).toEqual(["a", "b"]);
    s = dequeueTask(s);
    expect(s.current_task).toBe("a"); expect(s.pending_actions).toEqual(["b"]);
  });
});

describe("history prune + state normalize", () => {
  it("pruneHistory caps at HISTORY_MAX", () => {
    let h: ReturnType<typeof pruneHistory> = [];
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = pruneHistory(h, { ts: String(i), phase: "MONITORING", note: "x" });
    expect(h.length).toBe(HISTORY_MAX);
    expect(h.at(-1)!.ts).toBe(String(HISTORY_MAX + 4));
  });
  it("normalizeState repairs garbage to a fresh state", () => {
    const s = normalizeState({ phase: "NONSENSE", retry_count: -3, history: "bad" }, "m");
    expect(s.phase).toBe("BOOTSTRAPPING");
    expect(s.retry_count).toBe(0);
    expect(s.history).toEqual([]);
    expect(s.conductor_model).toBe("m");
  });
  it("statusLine is a compact one-liner", () => {
    const line = statusLine(emptyOrchestraState("qwen3:8b"));
    expect(line).toContain("BOOTSTRAPPING");
    expect(line).toContain("qwen3:8b");
    expect(line).not.toContain("\n");
  });
});
