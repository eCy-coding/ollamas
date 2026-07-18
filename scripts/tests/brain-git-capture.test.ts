// Brain git-capture (Tur 6) — pure builder units. The hook script feeds git context in;
// buildCapture decides WHAT the brain remembers before every commit/merge/push.
import { describe, it, expect } from "vitest";
import { buildCapture, withTimeout } from "../brain-git-capture";

describe("withTimeout (fast-fail capture)", () => {
  it("resolves a fast promise before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("rejects a slow promise at the deadline (never hangs the commit)", async () => {
    const slow = new Promise((r) => setTimeout(() => r("late"), 5000));
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timed out after 50ms/);
  });
});

const ctx = {
  op: "commit" as const,
  branch: "feat/complementary-integrations",
  stagedStat: " server/brain.ts | 40 ++++\n docs/BRAIN-ENGINE.md | 12 ++\n 2 files changed, 52 insertions(+)",
  lastSubject: "feat(brain): v2 — semantic fact search",
  now: 1_752_600_000_000,
};

describe("buildCapture", () => {
  it("builds an episodic memory carrying op, branch and the staged summary", () => {
    const out = buildCapture(ctx);
    expect(out.memory.tier).toBe("episodic");
    expect(out.memory.id).toBe("git:commit:1752600000000");
    expect(out.memory.content).toContain("commit @ feat/complementary-integrations");
    expect(out.memory.content).toContain("server/brain.ts");
    expect(out.memory.content).toContain("feat(brain): v2");
  });

  it("asserts bi-temporal facts: active branch + compact commit head (graph hygiene)", () => {
    const out = buildCapture(ctx);
    expect(out.facts).toContainEqual({ subject: "ollamas", predicate: "active_branch", object: "feat/complementary-integrations" });
    // The fact carries only the "type(scope)" head — a full commit title as a graph
    // node is unreadable noise; the episodic memory keeps the full subject.
    expect(out.facts).toContainEqual({ subject: "ollamas", predicate: "last_commit_subject", object: "feat(brain)" });
    expect(out.memory.content).toContain("feat(brain): v2 — semantic fact search");
  });

  it("push/merge ops keep distinct ids and content labels", () => {
    const push = buildCapture({ ...ctx, op: "push" });
    expect(push.memory.id).toBe("git:push:1752600000000");
    expect(push.memory.content).toContain("push @");
    const merge = buildCapture({ ...ctx, op: "merge" });
    expect(merge.memory.content).toContain("merge @");
  });

  it("caps oversized staged stats so hook writes stay cheap", () => {
    const big = buildCapture({ ...ctx, stagedStat: "x".repeat(10_000) });
    expect(big.memory.content.length).toBeLessThan(3000);
  });
});
