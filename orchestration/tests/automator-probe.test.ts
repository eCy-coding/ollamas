import { describe, it, expect } from "vitest";
import {
  sanitizeModelDir, artifactKind, toArtifacts, classifyAutomatorRun, renderAutomatorProbe,
} from "../bin/lib/automator-probe";
import type { DispatchReport } from "../bin/lib/chrome-probe";

describe("sanitizeModelDir — filesystem-safe per-model dir", () => {
  it("replaces ':' and unsafe separators with '_'", () => {
    expect(sanitizeModelDir("qwen3-coder:480b-cloud")).toBe("qwen3-coder_480b-cloud");
    expect(sanitizeModelDir("gpt-oss:20b")).toBe("gpt-oss_20b");
    expect(sanitizeModelDir("phi4:latest")).toBe("phi4_latest");
  });
  it("collapses repeats and trims edge underscores", () => {
    expect(sanitizeModelDir("a::b//c")).toBe("a_b_c");
    expect(sanitizeModelDir(":weird:")).toBe("weird");
  });
});

describe("artifactKind — classify by extension", () => {
  it("maps known Automator artifact extensions", () => {
    expect(artifactKind("Start ollamas.workflow")).toBe("workflow");
    expect(artifactKind("launch.applescript")).toBe("applescript");
    expect(artifactKind("open-cockpit.scpt")).toBe("applescript");
    expect(artifactKind("run.sh")).toBe("shell");
    expect(artifactKind("action.command")).toBe("shell");
    expect(artifactKind("document.plist")).toBe("plist");
    expect(artifactKind("README.md")).toBe("readme");
    expect(artifactKind("readme")).toBe("readme");
    expect(artifactKind("notes.txt")).toBe("other");
  });
});

describe("toArtifacts — sorted name+kind list", () => {
  it("filters empties, sorts, tags kind", () => {
    const a = toArtifacts(["run.sh", "", "A.workflow"]);
    expect(a).toEqual([
      { name: "A.workflow", kind: "workflow" },
      { name: "run.sh", kind: "shell" },
    ]);
  });
});

describe("classifyAutomatorRun — produced is verdict-independent", () => {
  it("produced=true when files exist even without a DONE verdict", () => {
    const r: DispatchReport = { messages: ["stopped early"], verdict: "INCOMPLETE" };
    const row = classifyAutomatorRun("qwen3:8b", r, ["start.sh", "README.md"]);
    expect(row.produced).toBe(true);
    expect(row.fileCount).toBe(2);
    expect(row.kinds).toEqual(["readme", "shell"]);
    expect(row.provider).toBe("ollama-local");
    expect(row.verdict).toBe("INCOMPLETE");
  });

  it("produced=false when the subdir is empty (even if verdict says DONE)", () => {
    const r: DispatchReport = { messages: ["VERDICT: DONE done"], verdict: "DONE" };
    const row = classifyAutomatorRun("gpt-oss:20b-cloud", r, []);
    expect(row.produced).toBe(false);
    expect(row.fileCount).toBe(0);
    expect(row.provider).toBe("ollama-cloud");
    expect(row.note).toContain("DONE");
  });

  it("note falls back to a files-written marker when no message", () => {
    const row = classifyAutomatorRun("m", { verdict: "OK" }, ["x.workflow"]);
    expect(row.note).toContain("files written");
  });
});

describe("renderAutomatorProbe", () => {
  const rows = [
    classifyAutomatorRun("qwen3:8b", { messages: ["VERDICT: DONE"], verdict: "DONE" }, ["start-server.sh", "open-cockpit.applescript"]),
    classifyAutomatorRun("phi4:latest", { messages: ["chatty"], verdict: "INCOMPLETE" }, []),
  ];
  const md = renderAutomatorProbe(rows, "2026-07-02T00:00:00Z");

  it("shows the count, matrix, per-model detail and ethics", () => {
    expect(md).toContain("# AUTOMATOR_PROBE.md");
    expect(md).toContain("Result: 1/2 models produced artifacts");
    expect(md).toContain("`qwen3:8b`");
    expect(md).toContain("`start-server.sh` [shell]");
    expect(md).toContain("`open-cockpit.applescript` [applescript]");
    expect(md).toContain("(nothing)");
    expect(md).toContain("Ethics");
  });

  it("escapes pipes in the note so the table stays valid", () => {
    const r = [classifyAutomatorRun("m", { messages: ["a | b done"], verdict: "OK" }, ["f.sh"])];
    expect(renderAutomatorProbe(r, "t")).toContain("a \\| b done");
  });
});
