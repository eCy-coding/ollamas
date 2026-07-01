import { describe, it, expect } from "vitest";
import { diffTarget, isAdditive, prioritizeNext, renderNext, appliedStreams, type ProposalRef } from "../bin/lib/fleet-next";

const ADDITIVE = `## Change: add scripts/tsconfig.json
## Diff:
\`\`\`diff
+// scripts/tsconfig.json (new)
+{ "compilerOptions": { "allowJs": true } }
\`\`\``;
const EDIT = `## Change: add SSE error framing to agent-events.ts
## Diff:
\`\`\`diff
--- a/server/agent-events.ts
+++ b/server/agent-events.ts
@@
-  return formatSseDone(x);
+  return formatSseError(x);
\`\`\``;

describe("diffTarget — evidence anchor", () => {
  it("picks the +++ path", () => expect(diffTarget(EDIT)).toBe("server/agent-events.ts"));
  it("picks a new-file path", () => expect(diffTarget(ADDITIVE)).toBe("scripts/tsconfig.json"));
});

describe("isAdditive — new file vs edits existing", () => {
  it("new file only → additive", () => expect(isAdditive(ADDITIVE)).toBe(true));
  it("removes existing lines → NOT additive", () => expect(isAdditive(EDIT)).toBe(false));
});

describe("prioritizeNext — safe-additive first, research last", () => {
  const proposals: ProposalRef[] = [
    { stream: "errors-resilience", slot: "conductor", proposal: EDIT },
    { stream: "mjs-migration", slot: "conductor", proposal: ADDITIVE },
  ];
  const q = prioritizeNext(proposals, ["novel failure mode X"]);
  it("orders P1 additive → P2 edit → P3 research", () => {
    expect(q.map((t) => t.priority)).toEqual([1, 2, 3]);
    expect(q[0].kind).toBe("apply-additive");
    expect(q[0].stream).toBe("mjs-migration");
    expect(q[2].kind).toBe("research");
  });
  it("renders a queue with a conductor directive naming P1 targets", () => {
    const md = renderNext(q, "2026-07-01T00:00:00Z");
    expect(md).toContain("FLEET_NEXT.md");
    expect(md).toContain("scripts/tsconfig.json");
    expect(md).toContain("Apply the 1 P1");
  });
  it("empty → no blind-apply directive", () => {
    const md = renderNext(prioritizeNext([], []), "t");
    expect(md).toContain("Nothing to blind-apply");
  });
});

const CODINGS = `## B. CODE_PLAN stream proposals — apply status
| Stream | Proposal | Status | Evidence |
|--------|----------|--------|----------|
| mjs-migration | \`scripts/tsconfig.json\` | ✅ **DONE (applied)** | tsc 0 |
| test-coverage | \`cli/lib/client.ts\` | ✅ **DONE (applied)** | 6 green |
| typescript-core | computeGaps | ✅ **DONE** | already tested |
| pending-stream | something | 🔶 QUEUED | held |
`;

describe("appliedStreams — reconcile shipped work out of the queue (vO31)", () => {
  it("collects streams marked ✅ DONE (applied) or ✅ DONE from CODINGS_STATUS §B", () => {
    const s = appliedStreams(CODINGS);
    expect(s.has("mjs-migration")).toBe(true);
    expect(s.has("test-coverage")).toBe(true);
    expect(s.has("typescript-core")).toBe(true); // plain ✅ **DONE also counts
    expect(s.has("pending-stream")).toBe(false); // QUEUED stays pending
    expect(s.size).toBe(3);
  });

  it("empty/garbage input → empty set (safe)", () => {
    expect(appliedStreams("").size).toBe(0);
    expect(appliedStreams("no table here").size).toBe(0);
  });
});

describe("prioritizeNext — applied streams drop (loop can converge)", () => {
  const proposals: ProposalRef[] = [
    { stream: "mjs-migration", slot: "a", proposal: ADDITIVE },
    { stream: "errors-resilience", slot: "b", proposal: EDIT },
  ];

  it("drops proposals whose stream is already applied", () => {
    const applied = new Set(["mjs-migration"]);
    const q = prioritizeNext(proposals, [], applied);
    expect(q.find((t) => t.stream === "mjs-migration")).toBeUndefined(); // shipped → dropped
    expect(q.find((t) => t.stream === "errors-resilience")).toBeDefined(); // still pending
  });

  it("all applied → no P1 left (nextP1 == 0 → convergence reachable)", () => {
    const applied = new Set(["mjs-migration", "errors-resilience"]);
    const q = prioritizeNext(proposals, [], applied);
    expect(q.filter((t) => t.priority === 1).length).toBe(0);
    expect(q.filter((t) => t.kind !== "research").length).toBe(0);
  });

  it("empty applied set → backward-compatible (nothing dropped)", () => {
    const q = prioritizeNext(proposals, []);
    expect(q.length).toBe(2);
  });
});
