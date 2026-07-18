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

import { buildNodeRecords, buildGitRecords, buildSqliteRecords, buildShellRecords, buildHttpRecords, buildLaunchdRecords } from "../brain-teach-datasets";

describe("brain-teach v2 — critical-priority sets", () => {
  it("node/ts: builtin modules described + TS concepts, fact-tagged", () => {
    const recs = buildNodeRecords(["fs", "http", "_private"]);
    expect(recs.find((r) => r.id === "teach:node:mod-fs")?.content).toContain("dosya sistemi");
    expect(recs.find((r) => r.id === "teach:node:mod-_private")).toBeUndefined();
    expect(recs.find((r) => r.id === "teach:ts:generics")).toBeTruthy();
    expect(recs.find((r) => r.id === "teach:node:mod-http")?.fact?.object).toBe("http");
  });
  it("git: help -a commands intersected with curated descriptions", () => {
    const recs = buildGitRecords("  add       Add file contents\n  frobnicate  unknown\n");
    expect(recs.find((r) => r.id === "teach:git:add")?.content).toContain("stage");
    expect(recs.find((r) => r.id === "teach:git:frobnicate")).toBeUndefined();
    expect(recs.find((r) => r.id === "teach:git:rebase")).toBeTruthy(); // curated floor
  });
  it("static sets: sqlite/shell/http/launchd stable ids; http status facts", () => {
    expect(buildSqliteRecords().find((r) => r.id === "teach:sql:wal")?.content).toContain("WAL");
    expect(buildShellRecords().find((r) => r.id === "teach:shell:pipe")).toBeTruthy();
    const h429 = buildHttpRecords().find((r) => r.id === "teach:http:429")!;
    expect(h429.fact?.object).toContain("429");
    expect(buildLaunchdRecords().find((r) => r.id === "teach:launchd:kickstart")?.content).toContain("kickstart");
  });
});

import { buildOllamasRecords, buildLlmOpsRecords, buildDockerRecords, buildGlossaryRecords } from "../brain-teach-datasets";

describe("brain-teach v3 — dalga-3 sets", () => {
  it("ollamas-internal: Makefile '##' targets + BRAIN-INTEGRATION flag rows parse", () => {
    const mk = "brain-teach: ## Python + macOS ogret\n\t@npx tsx x.ts\nplain:\n\techo no-desc\n";
    const md = "| Belief revision | **ON** | `BRAIN_REVISION=0` | Negation yazımı süperseed eder |\n| junk | x |\n";
    const recs = buildOllamasRecords(mk, md);
    expect(recs.find((r) => r.id === "teach:ollamas:make-brain-teach")?.fact?.object).toBe("brain-teach");
    expect(recs.find((r) => r.id === "teach:ollamas:make-plain")).toBeUndefined(); // only ## documented
    const flag = recs.find((r) => r.id === "teach:ollamas:flag-BRAIN_REVISION");
    expect(flag?.content).toContain("süperseed");
    expect(flag?.fact).toEqual({ subject: "brain", predicate: "has_flag", object: "BRAIN_REVISION" });
  });
  it("curated dalga-3 sets carry lived gotchas", () => {
    expect(buildLlmOpsRecords().find((r) => r.id === "teach:llm:num-ctx")?.content).toContain("44GB");
    expect(buildDockerRecords().find((r) => r.id === "teach:docker:arm64")?.content).toContain("platform");
    expect(buildGlossaryRecords().find((r) => r.id === "teach:term:idempotent")).toBeTruthy();
  });
});
