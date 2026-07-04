import { describe, it, expect } from "vitest";
import { extractDiff, looksApplyable, targetFiles, classifyProposal, renderApplyReport, renderShipReport, riskTier, proposalIsAdditive, buildFleetCommitMsg, type ShipResult } from "../bin/lib/fleet-apply";
import { hasSearchReplace, parseSearchReplace, applyEdit } from "../bin/lib/search-replace";

const NEW_FILE = `diff --git a/scripts/x.ts b/scripts/x.ts
new file mode 100644
--- /dev/null
+++ b/scripts/x.ts
@@
+export const x = 1;`;

const NUMBERED = `--- a/start.sh
+++ b/start.sh
@@ -6,3 +6,4 @@ set -euo pipefail
 line
+added`;

const ILLUSTRATIVE = `--- a/start.sh
+++ b/start.sh
@@ set -euo pipefail
+require_env PORT`;

describe("extractDiff", () => {
  it("pulls the first fenced diff block", () => {
    const md = "## Change: x\n## Diff:\n```diff\n" + NUMBERED + "\n```\nVERDICT: DONE";
    expect(extractDiff(md)).toContain("@@ -6,3 +6,4 @@");
  });
  it("returns '' when there is no diff block", () => {
    expect(extractDiff("## Change: describe only, no diff")).toBe("");
  });
});

describe("looksApplyable", () => {
  it("true for a new-file diff", () => { expect(looksApplyable(NEW_FILE)).toBe(true); });
  it("true for a numbered hunk", () => { expect(looksApplyable(NUMBERED)).toBe(true); });
  it("false for an illustrative @@ with no line numbers", () => { expect(looksApplyable(ILLUSTRATIVE)).toBe(false); });
  it("false for empty / headerless", () => { expect(looksApplyable("")).toBe(false); expect(looksApplyable("just prose")).toBe(false); });
});

describe("targetFiles", () => {
  it("extracts the touched file", () => {
    expect(targetFiles(NEW_FILE)).toEqual(["scripts/x.ts"]);
    expect(targetFiles(NUMBERED)).toEqual(["start.sh"]);
  });
});

describe("classifyProposal", () => {
  it("apply-ready only when shaped AND git-apply-check passed", () => {
    expect(classifyProposal("mjs", "terminal", "m", NEW_FILE, true).applyReady).toBe(true);
    expect(classifyProposal("mjs", "terminal", "m", NEW_FILE, false).applyReady).toBe(false);
    expect(classifyProposal("mjs", "terminal", "m", NEW_FILE, false).reason).toMatch(/apply --check.* failed/);
  });
  it("illustrative diff is never apply-ready, with a clear reason", () => {
    const r = classifyProposal("shell", "conductor", "m", ILLUSTRATIVE, null);
    expect(r.applyReady).toBe(false);
    expect(r.reason).toContain("illustrative");
  });
  it("no diff → flagged", () => {
    expect(classifyProposal("s", "t", "m", "", null).reason).toBe("no diff block");
  });
});

describe("SEARCH/REPLACE proposal path (vO52 loop-close)", () => {
  const PROPOSAL = `# shell-harden · terminal · gpt-oss:20b-cloud
## Change: harden start.sh
## Edit:
### file: start.sh
<<<<<<< SEARCH
set -euo pipefail
=======
set -euo pipefail
require_env PORT
>>>>>>> REPLACE
## Test: unset PORT → exits nonzero
VERDICT: DONE`;

  it("detects a SEARCH/REPLACE proposal (not a unified diff)", () => {
    expect(hasSearchReplace(PROPOSAL)).toBe(true);
    const e = parseSearchReplace(PROPOSAL);
    expect(e[0].file).toBe("start.sh");
    expect(e[0].search).toBe("set -euo pipefail");
  });
  it("resolves deterministically against real file content (the reliable apply path)", () => {
    const content = "#!/bin/bash\nset -euo pipefail\necho boot";
    const r = applyEdit(content, parseSearchReplace(PROPOSAL)[0]);
    expect(r.ok).toBe(true);
    expect(r.content).toContain("require_env PORT");
  });
});

describe("riskTier (batch auto-ship gate)", () => {
  const SR_ADDITIVE = `## Edit:\n### file: server/x.ts\n<<<<<<< SEARCH\nexport function a(){return 1;}\n=======\nexport function a(){return 1;}\nexport function b(){return 2;}\n>>>>>>> REPLACE\nVERDICT: DONE`;
  const SR_MODIFY = `## Edit:\n### file: server/x.ts\n<<<<<<< SEARCH\nconst a = t.entryPoint;\n=======\nconst a = path.basename(t.entryPoint);\n>>>>>>> REPLACE\nVERDICT: DONE`;
  const SR_SHELL = `## Edit:\n### file: start.sh\n<<<<<<< SEARCH\ncd "$REPO"\n=======\nrequire_env PORT\ncd "$REPO"\n>>>>>>> REPLACE\nVERDICT: DONE`;

  it("additive SEARCH/REPLACE in a gate-covered .ts → safe-auto", () => {
    expect(proposalIsAdditive(SR_ADDITIVE)).toBe(true);
    expect(riskTier(SR_ADDITIVE, "server/x.ts")).toBe("safe-auto");
  });
  it("a new-file diff (.ts) → safe-auto", () => {
    expect(riskTier(NEW_FILE, "scripts/x.ts")).toBe("safe-auto");
  });
  it("modifies existing logic in a .ts → review (gate passes but semantics need a human)", () => {
    expect(proposalIsAdditive(SR_MODIFY)).toBe(false);
    expect(riskTier(SR_MODIFY, "server/x.ts")).toBe("review");
  });
  it("a shell target the gate cannot verify → blocked (even if additive)", () => {
    expect(riskTier(SR_SHELL, "start.sh")).toBe("blocked");
  });
  it("unknown / missing target → blocked", () => {
    expect(riskTier(SR_ADDITIVE, "")).toBe("blocked");
    expect(riskTier(SR_ADDITIVE, "(unknown)")).toBe("blocked");
  });
  it("classifyProposal carries a tier", () => {
    expect(classifyProposal("s", "t", "m", NEW_FILE, true).tier).toBe("safe-auto");
  });
});

describe("renderShipReport (batch ledger)", () => {
  const shipped: ShipResult[] = [{ target: "errors.terminal", model: "qwen3-coder:480b", tier: "safe-auto", ok: true, files: ["server/x.ts"], reason: "applied + gate GREEN" }];
  const reverted: ShipResult[] = [];
  const skipped: ShipResult[] = [
    { target: "typescript.terminal", model: "m", tier: "review", ok: false, files: ["server/y.ts"], reason: "modifies existing logic — conductor must judge semantics" },
    { target: "shell.terminal", model: "m", tier: "blocked", ok: false, files: ["start.sh"], reason: "gate can't verify" },
  ];
  const md = renderShipReport(shipped, reverted, skipped, "2026-07-03T00:00:00Z");
  it("summarizes shipped/reverted/skipped and separates auto vs held", () => {
    expect(md).toContain("# FLEET_SHIP.md");
    expect(md).toContain("1 shipped · 0 reverted · 2 skipped");
    expect(md).toContain("errors.terminal");
    expect(md).toContain("Skipped (conductor must judge");
    expect(md).toContain("`typescript.terminal` (review)");
    expect(md).toContain("`shell.terminal` (blocked)");
  });
});

describe("renderApplyReport", () => {
  const rows = [
    classifyProposal("mjs-migration", "terminal", "gpt-oss:120b-cloud", NEW_FILE, true),
    classifyProposal("shell-harden", "conductor", "claude", ILLUSTRATIVE, null),
  ];
  const md = renderApplyReport(rows, "2026-07-03T00:00:00Z");
  it("reports the count, table and the apply-ready command hint", () => {
    expect(md).toContain("# FLEET_APPLY.md");
    expect(md).toContain("1/2 proposals apply-ready");
    expect(md).toContain("`gpt-oss:120b-cloud`");
    expect(md).toContain("--apply mjs-migration.terminal");
    expect(md).toContain("illustrative");
  });
});

describe("buildFleetCommitMsg — vO45 fleet-autonomy", () => {
  it("conventional feat(fleet:<stream>) + model attribution + files", () => {
    const m = buildFleetCommitMsg("errors-resilience", "qwen3-coder:480b-cloud", ["server/agent-events.ts"]);
    expect(m.split("\n")[0]).toBe("feat(fleet:errors-resilience): qwen3-coder:480b-cloud proposal — tsc+vitest green");
    expect(m).toContain("Author model: qwen3-coder:480b-cloud");
    expect(m).toContain("server/agent-events.ts");
    expect(m).toContain("no manual conductor");
  });
  it("stream scope sanitize + boş dosya listesi", () => {
    const m = buildFleetCommitMsg("weird/stream name!", "m", []);
    expect(m.split("\n")[0]).toMatch(/^feat\(fleet:weird-stream-name-\): m/);
    expect(m).toContain("(no files)");
  });
  it("subject satırı ≤ ~72 char makul", () => {
    const subj = buildFleetCommitMsg("s", "gpt-oss:20b-cloud", ["a.ts"]).split("\n")[0];
    expect(subj.length).toBeLessThan(80);
  });
});
