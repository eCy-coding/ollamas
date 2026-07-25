import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// eCym route-accuracy + exit-code contract (dc-3.2). ecy-cmd is a MODEL-LESS Tier1 matcher; its
// exit code IS the contract (0=match / 1=no-match→Tier2 / 2=ambiguous / 3=need_arg). This measures
// two things against the REAL binary + dataset: (a) route COVERAGE — a known trigger must resolve
// (exit ∈ {0,2,3}, not 1); (b) the exit-code contract holds (gibberish → 1). Live-guarded: SKIPS
// when ecy-cmd is not on this machine, so it never flakes CI.
const ECY = join(homedir(), ".local", "bin", "ecy-cmd");
const DS = join(homedir(), "ecy-model", "terminal-dataset.json");
const present = existsSync(ECY) && existsSync(DS);

interface Cmd { id: string; triggers: string[] }
function run(query: string): number {
  const r = spawnSync(ECY, [query], { timeout: 8000, encoding: "utf8" });
  return r.status ?? -1;
}

describe.skipIf(!present)("eCym ecy-cmd routing", () => {
  const cmds = (JSON.parse(readFileSync(DS, "utf8")).commands as Cmd[]).filter((c) => c.triggers?.length);
  // Deterministic sample (every Nth) so the test is stable run-to-run, ~20 commands.
  const step = Math.max(1, Math.floor(cmds.length / 20));
  const sample = cmds.filter((_, i) => i % step === 0).slice(0, 20);

  it("resolves ≥70% of known triggers (exit ∈ {0,2,3}, not no-match)", () => {
    let resolved = 0;
    for (const c of sample) {
      const code = run(c.triggers[0]);
      if (code === 0 || code === 2 || code === 3) resolved += 1;
    }
    const coverage = resolved / sample.length;
    expect(coverage, `route coverage ${(coverage * 100).toFixed(0)}% over ${sample.length} triggers`).toBeGreaterThanOrEqual(0.7);
  });

  it("honours the exit-code contract: gibberish → 1 (no-match)", () => {
    expect(run("zxqw plmk asdf 90210 nonsense")).toBe(1);
  });

  it("--id returns parseable JSON with the requested id", () => {
    const r = spawnSync(ECY, ["--id", "pwd", "nerede"], { timeout: 8000, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).id).toBe("pwd");
  });
});

describe.runIf(!present)("eCym ecy-cmd absent", () => {
  it("skips honestly when ecy-cmd/dataset is not on this machine", () => {
    expect(present).toBe(false);
  });
});
