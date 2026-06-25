import { describe, it, expect } from "vitest";
import { interpretGitCommit } from "../bin/host-bridge/tools/lib/git-commit-parse.mjs";

// H12: git_commit ended its command with `| tail -4`, so the pipeline exit was tail's 0
// even when git commit failed → it reported ok:true (false success). interpretGitCommit
// reads git's REAL exit code.
describe("interpretGitCommit (H12)", () => {
  it("git failure → ok:false / committed:false (was wrongly true under tail)", () => {
    const r = interpretGitCommit({ exitCode: 1, output: "nothing to commit, working tree clean" }, false);
    expect(r.ok).toBe(false);
    expect(r.committed).toBe(false);
  });
  it("git success → ok/committed true", () => {
    const r = interpretGitCommit({ exitCode: 0, output: "[main abc1234] msg\n 1 file changed" }, false);
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(true);
    expect(r.pushed).toBe(false);
  });
  it("push requested + chain success → pushed true", () => {
    expect(interpretGitCommit({ exitCode: 0, output: "ok" }, true).pushed).toBe(true);
  });
  it("push requested + chain failure → pushed false", () => {
    expect(interpretGitCommit({ exitCode: 1, output: "! [rejected]" }, true).pushed).toBe(false);
  });
  it("trims output to the last few lines", () => {
    const out = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    expect(interpretGitCommit({ exitCode: 0, output: out }, false).output.split("\n").length).toBeLessThanOrEqual(6);
  });
});
