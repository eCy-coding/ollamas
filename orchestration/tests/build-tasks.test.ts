// build-tasks.test.ts — behavior of build-tasks.ts pure core (parse/dedupe/stable-id merge).
import { describe, it, expect } from "vitest";
import { slug, parseTaskLine, mergeTasks, type RawTask } from "../bin/lib/build-tasks-core";

describe("build-tasks/slug", () => {
  it("lowercases, drops ext, collapses non-alnum to single hyphen, trims edges", () => {
    expect(slug("Foo Bar.ts")).toBe("foo-bar");
    expect(slug("deps-doctor.ts")).toBe("deps-doctor");
    expect(slug("__weird__Name!!.tsx")).toBe("weird-name");
  });
});

describe("build-tasks/parseTaskLine", () => {
  it("parses a full lane|target|goal|acceptance row and trims fields", () => {
    expect(parseTaskLine("  cli | cli/lib/a.ts | do x | acc y ")).toEqual({
      lane: "cli", target: "cli/lib/a.ts", goal: "do x", acceptance: "acc y",
    });
  });
  it("defaults acceptance to empty string when absent", () => {
    expect(parseTaskLine("cli|t.ts|g")?.acceptance).toBe("");
  });
  it("returns null for blank, comment, and incomplete rows", () => {
    expect(parseTaskLine("")).toBeNull();
    expect(parseTaskLine("   ")).toBeNull();
    expect(parseTaskLine("# comment")).toBeNull();
    expect(parseTaskLine("cli|t.ts")).toBeNull();        // missing goal
    expect(parseTaskLine("|t.ts|g")).toBeNull();         // missing lane
  });
});

describe("build-tasks/mergeTasks", () => {
  const rows: RawTask[] = [
    { lane: "cli", target: "a.ts", goal: "curated", acceptance: "" },
    { lane: "cli", target: "a.ts", goal: "generated-dup", acceptance: "" }, // dup target → dropped by dedupe
    { lane: "backend", target: "b.ts", goal: "g", acceptance: "" },
    { lane: "backend", target: "missing.ts", goal: "g", acceptance: "" },   // nonexistent → dropped
  ];

  it("dedupes by target keeping first-seen (curated) and drops nonexistent targets", () => {
    const { tasks, dropped } = mergeTasks(rows, (t) => t !== "missing.ts");
    expect(tasks.map((t) => t.target)).toEqual(["a.ts", "b.ts"]);
    expect(tasks[0].goal).toBe("curated");   // first-seen wins, not the later dup
    expect(dropped).toBe(1);                 // only the nonexistent target counts (dedupe is not a drop)
  });

  it("assigns stable unique ids, disambiguating basename collisions with a numeric suffix", () => {
    const collide: RawTask[] = [
      { lane: "x", target: "one/dup.ts", goal: "g", acceptance: "" },
      { lane: "x", target: "two/dup.ts", goal: "g", acceptance: "" },
    ];
    const { tasks } = mergeTasks(collide, () => true);
    expect(tasks.map((t) => t.id)).toEqual(["x-dup", "x-dup-2"]);
  });

  it("is deterministic: same input → identical output", () => {
    const a = mergeTasks(rows, (t) => t !== "missing.ts");
    const b = mergeTasks(rows, (t) => t !== "missing.ts");
    expect(a).toEqual(b);
  });
});
