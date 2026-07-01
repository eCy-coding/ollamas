import { describe, it, expect } from "vitest";
import {
  classifyTheme, langsInText, synthesize, renderCodePlan,
  type Finding, type LangCount,
} from "../bin/lib/synth";

describe("classifyTheme — deterministik regex, güvenlik önce", () => {
  it("injection → security (refactor'a düşmez)", () => {
    expect(classifyTheme("Missing input validation could lead to injection attacks")).toBe("security");
  });
  it("race condition → concurrency", () => {
    expect(classifyTheme("Potential race conditions in concurrent task handling")).toBe("concurrency");
  });
  it("unit test → tests", () => {
    expect(classifyTheme("Add unit tests for cli/lib/client.ts")).toBe("tests");
  });
  it("exit code → errors", () => {
    expect(classifyTheme("Inconsistent exit codes may break orchestration")).toBe("errors");
  });
  it(".mjs→ts migration → types", () => {
    expect(classifyTheme("Add TypeScript type definitions for all handlers")).toBe("types");
  });
  it("bilinmeyen → refactor fallback", () => {
    expect(classifyTheme("rethink the overall module boundaries")).toBe("refactor");
  });
});

describe("langsInText", () => {
  it("çoklu dil çıkarır", () => {
    expect(langsInText("TypeScript, Rust, Go").sort()).toEqual(["Go", "Rust", "TypeScript"]);
  });
  it("shell tanır", () => {
    expect(langsInText("refactor cli/bin/ollamas.sh POSIX script")).toContain("Shell");
  });
});

const COUNTS: LangCount[] = [
  { lang: "TypeScript", files: 2124 }, { lang: "JavaScript", files: 476 },
  { lang: "Shell", files: 109 }, { lang: "Python", files: 38 },
  { lang: "Rust", files: 14 }, { lang: "Go", files: 7 },
];

const FINDINGS: Finding[] = [
  { lane: "backend", model: "qwen3-coder:480b-cloud", kind: "LANG", text: "TypeScript, Rust, Go" },
  { lane: "backend", model: "qwen3-coder:480b-cloud", kind: "RISK", text: "premature stream closure due to message count reliance" },
  { lane: "integrations", model: "qwen3-coder:480b-cloud", kind: "RISK", text: "Missing input validation could lead to injection attacks" },
  { lane: "cli", model: "qwen3-coder:30b", kind: "TASK", text: "Add unit tests for cli/lib/client.ts" },
  { lane: "scripts", model: "qwen3-coder:30b", kind: "TASK", text: "Add unit tests for agent-dispatch.mjs" },
  { lane: "cli", model: "qwen3-coder:30b", kind: "TASK", text: "Implement TypeScript type definitions for all CLI handlers" },
  { lane: "bench", model: "deepseek-r1:32b", kind: "RISK", text: "race conditions coordinating multiple agents" },
];

describe("synthesize — KESİN CEVAP", () => {
  const plan = synthesize(FINDINGS, COUNTS, "2026-07-01T00:00:00Z");
  it("TypeScript birincil dil", () => {
    expect(plan.languages[0].lang).toBe("TypeScript");
    expect(plan.languages[0].verdict).toBe("primary");
    expect(plan.languages[0].files).toBe(2124);
  });
  it("JavaScript migrate-source, Rust/Go specialist", () => {
    expect(plan.languages.find((l) => l.lang === "JavaScript")?.verdict).toBe("migrate-source");
    expect(plan.languages.find((l) => l.lang === "Rust")?.verdict).toBe("specialist");
  });
  it("security teması P1 (risk-önce)", () => {
    const sec = plan.themes.find((t) => t.theme === "security");
    expect(sec?.priority).toBe(1);
  });
  it("RISK-kind temalar P1", () => {
    const conc = plan.themes.find((t) => t.theme === "concurrency");
    expect(conc?.priority).toBe(1); // race = RISK
  });
  it("temalar öncelik-sıralı (P1 önce)", () => {
    expect(plan.themes[0].priority).toBe(1);
    for (let i = 1; i < plan.themes.length; i++) {
      expect(plan.themes[i].priority).toBeGreaterThanOrEqual(plan.themes[i - 1].priority);
    }
  });
  it("headline TypeScript + top-tema içerir", () => {
    expect(plan.headline).toContain("TypeScript");
    expect(plan.headline).toMatch(/güvenlik|security|concurrency|eşzaman/i);
  });
});

describe("renderCodePlan", () => {
  const md = renderCodePlan(synthesize(FINDINGS, COUNTS, "2026-07-01T00:00:00Z"));
  it("TL;DR + dil tablosu + tema başlıkları içerir", () => {
    expect(md).toContain("# CODE_PLAN.md");
    expect(md).toContain("TL;DR");
    expect(md).toContain("BİRİNCİL");
    expect(md).toMatch(/P1 ·/);
  });
});
