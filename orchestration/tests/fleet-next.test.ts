import { describe, it, expect } from "vitest";
import { diffTarget, isAdditive, prioritizeNext, renderNext, type ProposalRef } from "../bin/lib/fleet-next";

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
