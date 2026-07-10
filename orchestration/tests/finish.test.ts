// finish.test.ts — pure-function slice of bin/finish.ts (no real git/fs/network).
// Covers: per-checker PASS + FAIL paths via an injected fake CheckCtx, the short-circuit
// runner, the dry-vs-ship exit-code policy, and report rendering. No checker touches the
// real repo here — every command is stubbed, so fail-paths are deterministic.
import { describe, it, expect } from "vitest";
import {
  cleanTree, securityGating, laneTriage, depsGate, envContract,
  dodAll, thinkZero, coverageMatrix, opsRespawn, freshGate, mission25,
  CHECKERS, COVERAGE_MATRIX,
  runCheckers, evaluateGate, formatReport, freshGateScript,
  type CheckCtx, type Checker, type CheckResult, type Mode, type RunOut,
} from "../bin/finish";

// ── fake context builder ─────────────────────────────────────────────────────
interface FakeOpts {
  mode?: Mode;
  runMap?: Record<string, RunOut>;   // key = argv0 or a matched token → RunOut
  files?: Record<string, string>;    // rel → content (also drives exists)
  execFiles?: string[];              // rel paths that are executable
  branch?: string;
}
function ok(stdout = "", code = 0): RunOut { return { code, stdout, stderr: "" }; }
function fail(stderr = "boom", code = 1): RunOut { return { code, stdout: "", stderr }; }

function fakeCtx(o: FakeOpts = {}): CheckCtx {
  const files = o.files ?? {};
  return {
    mode: o.mode ?? "dry",
    root: "/repo",
    run: (cmd, args) => {
      const joined = [cmd, ...args].join(" ");
      const map = o.runMap ?? {};
      for (const key of Object.keys(map)) if (joined.includes(key)) return map[key];
      return ok();
    },
    exists: (rel) => rel in files || (o.execFiles ?? []).includes(rel),
    readText: (rel) => files[rel] ?? "",
    isExec: (rel) => (o.execFiles ?? []).includes(rel),
    branch: () => o.branch ?? "feat/x",
  };
}

// ── #1 cleanTree ─────────────────────────────────────────────────────────────
describe("cleanTree", () => {
  it("dry: dirty tree WARNs but passes (non-blocking)", () => {
    const r = cleanTree.run(fakeCtx({ mode: "dry", runMap: { "status --porcelain": ok(" M a.ts\n?? b.ts\n") } }));
    expect(r.pass).toBe(true);
    expect(r.evidence).toContain("dirty=2");
  });
  it("ship: dirty tree FAILS", () => {
    const r = cleanTree.run(fakeCtx({ mode: "ship", runMap: { "status --porcelain": ok(" M a.ts\n") } }));
    expect(r.pass).toBe(false);
  });
  it("ship: clean tree passes", () => {
    const r = cleanTree.run(fakeCtx({ mode: "ship", runMap: { "status --porcelain": ok("") } }));
    expect(r.pass).toBe(true);
  });
});

// ── #2 securityGating ────────────────────────────────────────────────────────
describe("securityGating", () => {
  it("passes when no continue-on-error", () => {
    const r = securityGating.run(fakeCtx({ files: { ".github/workflows/security.yml": "jobs:\n  scan: {}\n" } }));
    expect(r.pass).toBe(true);
  });
  it("fails when continue-on-error present", () => {
    const r = securityGating.run(fakeCtx({ files: { ".github/workflows/security.yml": "steps:\n  - run: x\n    continue-on-error: true\n" } }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain("continue-on-error=1");
  });
  it("fails when file missing", () => {
    expect(securityGating.run(fakeCtx({})).pass).toBe(false);
  });
});

// ── #3 laneTriage ────────────────────────────────────────────────────────────
describe("laneTriage", () => {
  it("skip-neutral when not generated", () => {
    const r = laneTriage.run(fakeCtx({}));
    expect(r.pass).toBe(true);
    expect(r.evidence).toContain("not-generated");
  });
  it("fails on TBD/PENDING", () => {
    const r = laneTriage.run(fakeCtx({ files: { "orchestration/out/LANE_TRIAGE.md": "row TBD\nrow PENDING\n" } }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain("=2");
  });
  it("passes when clean", () => {
    expect(laneTriage.run(fakeCtx({ files: { "orchestration/out/LANE_TRIAGE.md": "all resolved\n" } })).pass).toBe(true);
  });
});

// ── #4 depsGate / #5 envContract / #6 dodAll — exit-code driven ──────────────
describe("exit-code checkers", () => {
  it("depsGate passes on exit 0, fails on non-zero", () => {
    expect(depsGate.run(fakeCtx({ runMap: { "deps-gate.sh": ok("ok") } })).pass).toBe(true);
    expect(depsGate.run(fakeCtx({ runMap: { "deps-gate.sh": fail("over baseline") } })).pass).toBe(false);
  });
  it("envContract passes on exit 0, fails on non-zero", () => {
    expect(envContract.run(fakeCtx({ runMap: { "env-contract.ts": ok() } })).pass).toBe(true);
    expect(envContract.run(fakeCtx({ runMap: { "env-contract.ts": fail() } })).pass).toBe(false);
  });
  it("dodAll passes on exit 0, fails (high-lapse) on non-zero", () => {
    expect(dodAll.run(fakeCtx({ runMap: { "dod.ts": ok("[dod] 100/100, 0 lapse") } })).pass).toBe(true);
    const r = dodAll.run(fakeCtx({ runMap: { "dod.ts": fail("[dod] 40/100, 3 lapse (2 high)") } }));
    expect(r.pass).toBe(false);
  });
});

// ── #7 thinkZero ─────────────────────────────────────────────────────────────
describe("thinkZero", () => {
  it("passes when needsResearch=0", () => {
    const r = thinkZero.run(fakeCtx({ files: { "orchestration/bin/think.ts": "x" }, runMap: { "think.ts": ok('{"needsResearch":0}') } }));
    expect(r.pass).toBe(true);
  });
  it("fails when needsResearch>0", () => {
    const r = thinkZero.run(fakeCtx({ files: { "orchestration/bin/think.ts": "x" }, runMap: { "think.ts": ok('{"needsResearch":7}') } }));
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain("needsResearch=7");
  });
  it("fails on unparsable json", () => {
    const r = thinkZero.run(fakeCtx({ files: { "orchestration/bin/think.ts": "x" }, runMap: { "think.ts": ok("not json") } }));
    expect(r.pass).toBe(false);
  });
});

// ── #8 coverageMatrix ────────────────────────────────────────────────────────
describe("coverageMatrix", () => {
  it("has exactly 32 dimensions, all with a ref → 32/32 pass", () => {
    expect(COVERAGE_MATRIX).toHaveLength(32);
    expect(COVERAGE_MATRIX.every((d) => d.ref.trim().length > 0)).toBe(true);
    const r = coverageMatrix.run(fakeCtx({}));
    expect(r.pass).toBe(true);
    expect(r.evidence).toContain("32/32");
  });
});

// ── #9 opsRespawn ────────────────────────────────────────────────────────────
describe("opsRespawn", () => {
  it("passes when verify.sh present + executable", () => {
    expect(opsRespawn.run(fakeCtx({ execFiles: ["ops/launchd/verify.sh"] })).pass).toBe(true);
  });
  it("fails when missing/non-exec", () => {
    expect(opsRespawn.run(fakeCtx({})).pass).toBe(false);
  });
});

// ── #10 freshGate ────────────────────────────────────────────────────────────
describe("freshGate", () => {
  it("dry: skipped (skip-neutral pass)", () => {
    const r = freshGate.run(fakeCtx({ mode: "dry" }));
    expect(r.pass).toBe(true);
    expect(r.evidence).toContain("skipped");
  });
  it("ship: fails when clone gate exits non-zero", () => {
    const r = freshGate.run(fakeCtx({ mode: "ship", runMap: { "git clone": fail() } }));
    expect(r.pass).toBe(false);
  });
  it("freshGateScript wires ci→tsc→vitest→build", () => {
    const s = freshGateScript("/repo");
    expect(s).toContain("npm ci");
    expect(s).toContain("npx tsc --noEmit");
    expect(s).toContain("npx vitest run");
  });
});

// ── #11 mission25 ────────────────────────────────────────────────────────────
describe("mission25", () => {
  it("reports ratio, always skip-neutral pass", () => {
    const r = mission25.run(fakeCtx({ files: { "orchestration/MISSION.md": "- [x] a\n- [x] b\n- [ ] c\n" } }));
    expect(r.pass).toBe(true);
    expect(r.evidence).toContain("2/3");
  });
  it("skip-neutral when no mission file", () => {
    expect(mission25.run(fakeCtx({})).pass).toBe(true);
  });
});

// ── runner: short-circuit ────────────────────────────────────────────────────
describe("runCheckers", () => {
  const mk = (name: string, pass: boolean): Checker => ({ name, run: () => ({ name, pass, evidence: "" }) });
  it("runs all when shortCircuit=false", () => {
    const res = runCheckers([mk("a", true), mk("b", false), mk("c", true)], fakeCtx({}), { shortCircuit: false });
    expect(res.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
  it("stops at first fail when shortCircuit=true", () => {
    const res = runCheckers([mk("a", true), mk("b", false), mk("c", true)], fakeCtx({}), { shortCircuit: true });
    expect(res.map((r) => r.name)).toEqual(["a", "b"]);
  });
  it("CHECKERS has exactly 11, cheap→expensive order", () => {
    expect(CHECKERS).toHaveLength(11);
    expect(CHECKERS[0].name).toBe("cleanTree");
    expect(CHECKERS[9].name).toBe("freshGate");
  });
});

// ── gate policy: dry vs ship ─────────────────────────────────────────────────
describe("evaluateGate", () => {
  const pass3: CheckResult[] = [
    { name: "a", pass: true, evidence: "" },
    { name: "b", pass: true, evidence: "" },
    { name: "c", pass: true, evidence: "" },
  ];
  const partialFail: CheckResult[] = [
    { name: "a", pass: true, evidence: "" },
    { name: "b", pass: false, evidence: "" },
  ];
  it("dry: exit 0 even when a checker failed", () => {
    expect(evaluateGate(partialFail, { mode: "dry", total: 3 }).exitCode).toBe(0);
  });
  it("dry: exit 0 when all pass", () => {
    expect(evaluateGate(pass3, { mode: "dry", total: 3 }).exitCode).toBe(0);
  });
  it("ship: exit 0 only when all ran + passed", () => {
    expect(evaluateGate(pass3, { mode: "ship", total: 3 })).toMatchObject({ allPass: true, exitCode: 0 });
  });
  it("ship: exit 1 on short-circuited fail", () => {
    expect(evaluateGate(partialFail, { mode: "ship", total: 3 })).toMatchObject({ allPass: false, exitCode: 1 });
  });
});

// ── report rendering ─────────────────────────────────────────────────────────
describe("formatReport", () => {
  const res: CheckResult[] = [
    { name: "cleanTree", pass: true, evidence: "branch=feat/x" },
    { name: "laneTriage", pass: false, evidence: "TBD|PENDING=23" },
  ];
  it("renders a table with PASS/FAIL rows + HEAD + dry note", () => {
    const out = formatReport(res, { mode: "dry", total: 11, head: "abc1234" });
    expect(out).toContain("| cleanTree | ✅ PASS |");
    expect(out).toContain("| laneTriage | ❌ FAIL |");
    expect(out).toContain("HEAD=abc1234");
    expect(out).toContain("READ-ONLY");
  });
  it("ship mode omits the dry note", () => {
    expect(formatReport(res, { mode: "ship", total: 11, head: "abc" })).not.toContain("READ-ONLY");
  });
});
