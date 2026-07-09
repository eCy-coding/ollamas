import { describe, it, expect } from "vitest";
import {
  tallyVotes,
  summarizeCouncil,
  buildLanePrompt,
  parseFindings,
  checkableClaims,
  COUNCIL_QUORUM,
  type LaneResult,
  type LaneContext,
  type Finding,
} from "../bin/lib/council";

const seat = (lane: string, model: string, ok: boolean, kinds: ("TASK" | "RISK" | "LANG")[]): LaneResult => ({
  lane, model, ok, findings: kinds.map((kind) => ({ lane, model, kind, text: `${kind} x` })),
});

describe("tallyVotes — per-lane weighted quorum", () => {
  it("majority of responding seats agree → EXECUTE", () => {
    const v = tallyVotes([
      seat("cli", "a", true, ["TASK"]),
      seat("cli", "b", true, ["TASK", "RISK"]),
      seat("cli", "c", true, ["LANG"]), // responded but no TASK/RISK → does not agree
    ]);
    expect(v[0].participating).toBe(3);
    expect(v[0].agreeing).toBe(2);
    expect(v[0].confidence).toBeCloseTo(2 / 3);
    expect(v[0].decision).toBe("EXECUTE"); // 0.66 > 0.6
  });

  it("below quorum → HOLD", () => {
    const v = tallyVotes([
      seat("cli", "a", true, ["TASK"]),
      seat("cli", "b", true, ["LANG"]),
      seat("cli", "c", true, ["LANG"]),
    ]);
    expect(v[0].confidence).toBeCloseTo(1 / 3);
    expect(v[0].decision).toBe("HOLD"); // 0.33 < 0.6
  });

  it("silent lane / no participants → HOLD (never act on silence)", () => {
    const v = tallyVotes([seat("cli", "a", false, ["TASK"])]); // did not respond
    expect(v[0].participating).toBe(0);
    expect(v[0].confidence).toBe(0);
    expect(v[0].decision).toBe("HOLD");
  });

  it("quorum threshold is exclusive (>0.6, exactly 0.6 → HOLD)", () => {
    // 3/5 = 0.6 exactly → not strictly greater → HOLD
    const seats = [
      ...Array(3).fill(0).map((_, i) => seat("x", `y${i}`, true, ["TASK"])),
      ...Array(2).fill(0).map((_, i) => seat("x", `n${i}`, true, ["LANG"])),
    ];
    const v = tallyVotes(seats);
    expect(v[0].confidence).toBeCloseTo(COUNCIL_QUORUM);
    expect(v[0].decision).toBe("HOLD");
  });
});

describe("summarizeCouncil — global decision", () => {
  it("EXECUTE when any lane clears quorum", () => {
    const s = summarizeCouncil([
      seat("cli", "a", true, ["TASK"]), seat("cli", "b", true, ["TASK"]),
      seat("web", "a", true, ["LANG"]),
    ]);
    expect(s.decision).toBe("EXECUTE");
    expect(s.votes.length).toBe(2);
  });
  it("HOLD when no lane clears quorum", () => {
    const s = summarizeCouncil([seat("cli", "a", true, ["LANG"])]);
    expect(s.decision).toBe("HOLD");
  });
});

describe("buildLanePrompt — strict-format analysis prompt", () => {
  const ctx = (over: Partial<LaneContext> = {}): LaneContext => ({
    lane: "cli",
    files: ["cli/main.ts", "cli/parse.ts"],
    loc: 1234,
    langs: ["TypeScript", "Bash"],
    excerpt: "export function main() {}",
    ...over,
  });

  it("embeds lane facts, files and excerpt", () => {
    const p = buildLanePrompt(ctx());
    expect(p).toContain('"cli" lane');
    expect(p).toContain("~1234 LOC");
    expect(p).toContain("TypeScript, Bash");
    expect(p).toContain("cli/main.ts");
    expect(p).toContain("Key excerpts:");
    expect(p).toContain("export function main() {}");
  });

  it("omits the excerpt block when excerpt is empty", () => {
    const p = buildLanePrompt(ctx({ excerpt: "" }));
    expect(p).not.toContain("Key excerpts:");
  });

  it("falls back to 'unknown' when no languages are given", () => {
    const p = buildLanePrompt(ctx({ langs: [] }));
    expect(p).toContain("languages: unknown");
  });

  it("caps the file list at 40 entries", () => {
    const files = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
    const p = buildLanePrompt(ctx({ files }));
    expect(p).toContain("f39.ts");
    expect(p).not.toContain("f40.ts");
  });
});

describe("parseFindings — deterministic strict-line parsing", () => {
  it("parses LANG/TASK/RISK lines, ignoring prose", () => {
    const res = [
      "Some preamble prose.",
      "LANG: TypeScript",
      "TASK: add flag parsing",
      "TASK: write tests",
      "RISK: no input validation",
      "Trailing chatter.",
    ].join("\n");
    const f = parseFindings("cli", "m1", res);
    expect(f.map((x) => x.kind)).toEqual(["LANG", "TASK", "TASK", "RISK"]);
    expect(f[0]).toMatchObject({ lane: "cli", model: "m1", text: "TypeScript" });
  });

  it("returns [] for empty response", () => {
    expect(parseFindings("cli", "m1", "")).toEqual([]);
  });

  it("strips <think> traces and code fences before parsing", () => {
    const res = "<think>TASK: ignore me</think>\n```\nRISK: also ignored\n```\nTASK: real one";
    const f = parseFindings("cli", "m1", res);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "TASK", text: "real one" });
  });

  it("strips list/markdown prefixes and collapses whitespace, truncating to 240 chars", () => {
    const long = "x".repeat(300);
    const f = parseFindings("cli", "m1", `- TASK:   a\t b  ${long}`);
    expect(f[0].kind).toBe("TASK");
    expect(f[0].text.startsWith("a b ")).toBe(true);
    expect(f[0].text.length).toBe(240);
  });

  it("drops a marker line with empty text", () => {
    expect(parseFindings("cli", "m1", "TASK:   ")).toEqual([]);
  });
});

describe("checkableClaims — oracle-adjudicable propositions only", () => {
  const mk = (text: string): Finding => ({ lane: "cli", model: "m", kind: "RISK", text });

  it("keeps arithmetic/comparison claims and de-duplicates", () => {
    const out = checkableClaims([mk("2 < 3"), mk("2 < 3"), mk("latency 5 = 5")]);
    expect(out).toContain("2 < 3");
    expect(out).toContain("latency 5 = 5");
    expect(out).toHaveLength(2);
  });

  it("keeps boolean-logic claims", () => {
    expect(checkableClaims([mk("a and b hold")])).toEqual(["a and b hold"]);
  });

  it("drops undecidable prose", () => {
    expect(checkableClaims([mk("refactor the parser for clarity")])).toEqual([]);
  });
});
