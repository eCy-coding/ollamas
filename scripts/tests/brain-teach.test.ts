// T1 — teach dataset builders are pure and deterministic.
import { describe, it, expect } from "vitest";
import { buildPythonRecords, buildMacosRecords, MACOS_ALLOWLIST } from "../brain-teach-datasets";

describe("brain-teach datasets", () => {
  it("python: keywords + builtins + modules become stable procedural records", () => {
    const recs = buildPythonRecords({
      keywords: ["if", "for"],
      builtins: [["len", "Return the number of items in a container."], ["print", "Prints values."]],
      modules: [["json", "JSON encoder/decoder."], ["os", "OS routines."]],
    });
    expect(recs.find((r) => r.id === "teach:python:kw-if")).toBeTruthy();
    expect(recs.find((r) => r.id === "teach:python:fn-len")?.content).toContain("number of items");
    const j = recs.find((r) => r.id === "teach:python:mod-json")!;
    expect(j.content).toContain("import json");
    expect(j.fact).toEqual({ subject: "python", predicate: "provides", object: "json" });
  });

  it("macos: whatis lines filtered by allowlist, deduped, fact-tagged", () => {
    const txt = "eza(1)                   - a modern replacement for ls\nls(1)                    - list directory contents\nls(1) - dup line\nevil(8) - not allowed\ngdf(1), df(1)            - display free disk space";
    const recs = buildMacosRecords(txt, MACOS_ALLOWLIST);
    expect(recs.map((r) => r.id)).toEqual(["teach:macos:ls", "teach:macos:df"]);
    expect(recs[1].content).toContain("free disk space");
    expect(recs[1].fact?.object).toBe("df");
  });
});
