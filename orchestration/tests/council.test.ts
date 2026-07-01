import { describe, it, expect } from "vitest";
import {
  buildLanePrompt, parseFindings, summarizeCouncil, checkableClaims,
  type LaneContext, type LaneResult,
} from "../bin/lib/council";

const CTX: LaneContext = {
  lane: "cli", files: ["cli/index.ts", "cli/lib/role.ts"], loc: 1200,
  langs: ["TypeScript"], excerpt: "export function route() {}",
};

describe("buildLanePrompt", () => {
  const p = buildLanePrompt(CTX);
  it("names the lane and the strict format", () => {
    expect(p).toContain('"cli" lane');
    expect(p).toContain("LANG:");
    expect(p).toContain("TASK:");
    expect(p).toContain("RISK:");
  });
  it("includes lane facts + files", () => {
    expect(p).toContain("1200 LOC");
    expect(p).toContain("cli/index.ts");
  });
});

describe("parseFindings — deterministic strict-format extraction", () => {
  it("extracts LANG/TASK/RISK lines", () => {
    const resp = [
      "LANG: TypeScript, shell",
      "TASK: add --json flag to role command",
      "TASK: cover parseArgs edge cases",
      "RISK: role-hook.ts silent exit hides errors",
      "some prose that should be ignored",
    ].join("\n");
    const f = parseFindings("cli", "qwen3:8b", resp);
    expect(f.length).toBe(4);
    expect(f.filter((x) => x.kind === "TASK").length).toBe(2);
    expect(f.find((x) => x.kind === "LANG")?.text).toBe("TypeScript, shell");
  });
  it("strips <think> traces and code fences", () => {
    const resp = "<think>hmm let me plan</think>\nLANG: TypeScript\n```ts\nTASK: not real\n```\nTASK: real task";
    const f = parseFindings("cli", "m", resp);
    const tasks = f.filter((x) => x.kind === "TASK");
    expect(tasks.length).toBe(1);
    expect(tasks[0].text).toBe("real task");
  });
  it("tolerates markdown bullet prefixes", () => {
    const f = parseFindings("cli", "m", "- TASK: bullet task\n* RISK: bullet risk");
    expect(f.map((x) => x.kind).sort()).toEqual(["RISK", "TASK"]);
  });
  it("empty response → no findings", () => {
    expect(parseFindings("cli", "m", "")).toEqual([]);
  });
});

describe("summarizeCouncil", () => {
  const results: LaneResult[] = [
    { lane: "cli", model: "qwen3:8b", ok: true, findings: [
      { lane: "cli", model: "qwen3:8b", kind: "LANG", text: "TypeScript" },
      { lane: "cli", model: "qwen3:8b", kind: "TASK", text: "t1" },
      { lane: "cli", model: "qwen3:8b", kind: "RISK", text: "r1" },
    ] },
    { lane: "frontend", model: "qwen2.5vl:32b", ok: true, findings: [] },
  ];
  const s = summarizeCouncil(results);
  it("counts tasks/risks per lane", () => {
    const cli = s.byLane.find((l) => l.lane === "cli")!;
    expect(cli.tasks).toBe(1);
    expect(cli.risks).toBe(1);
    expect(cli.langs).toEqual(["TypeScript"]);
  });
  it("surfaces silent lanes (no finding) — never hidden", () => {
    expect(s.silentLanes).toContain("frontend");
  });
  it("lists responded models", () => {
    expect(s.respondedModels.sort()).toEqual(["qwen2.5vl:32b", "qwen3:8b"]);
  });
});

describe("checkableClaims — only oracle-adjudicable propositions", () => {
  it("forwards arithmetic/logic, drops subjective prose", () => {
    const findings = [
      { lane: "x", model: "m", kind: "RISK" as const, text: "2+2=5 in the sum helper" },
      { lane: "x", model: "m", kind: "TASK" as const, text: "refactor the api client for clarity" },
      { lane: "x", model: "m", kind: "RISK" as const, text: "A and not A is assumed true" },
    ];
    const claims = checkableClaims(findings);
    expect(claims).toContain("2+2=5 in the sum helper");
    expect(claims.some((c) => /A and not A/.test(c))).toBe(true);
    expect(claims.some((c) => /refactor/.test(c))).toBe(false);
  });
});
