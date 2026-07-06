import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// "fable-5 skills e2e" — freeze the skill/command SURFACE: every slash command has valid frontmatter and its
// referenced orchestration script actually exists on disk, and every SKILL.md carries a name+description.
// The underlying libs are unit-tested elsewhere; this guards the wiring that ties them into Claude Code.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS_DIR = join(REPO, ".claude", "commands");
const SKILLS_DIR = join(REPO, ".claude", "skills");

const cmdFiles = existsSync(COMMANDS_DIR) ? readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".md")) : [];
const skillDirs = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

function frontmatter(text: string): string {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

describe("slash commands — frontmatter + script-path resolution", () => {
  it("has a non-trivial command set", () => {
    expect(cmdFiles.length).toBeGreaterThan(5);
  });

  for (const f of cmdFiles) {
    it(`${f}: valid frontmatter + every referenced orchestration script exists`, () => {
      const text = readFileSync(join(COMMANDS_DIR, f), "utf8");
      const fm = frontmatter(text);
      expect(fm, `${f} missing frontmatter`).not.toBe("");
      expect(/description:/.test(fm), `${f} missing description`).toBe(true);
      // Extract only ACTUAL invocation targets — a path run via tsx/bash/npx (in allowed-tools or the body),
      // not prose path mentions. Each such script must exist on disk (the real command→script wiring).
      const refs = [...text.matchAll(/(?:tsx|bash|npx tsx|\.bin\/tsx)\s+((?:orchestration\/bin|scripts|cli|bin)\/[\w./-]+\.(?:ts|sh|mjs|js))/g)].map((m) => m[1]);
      for (const rel of new Set(refs)) {
        expect(existsSync(join(REPO, rel)), `${f} runs missing script ${rel}`).toBe(true);
      }
    });
  }
});

describe("SKILL.md — name + description present", () => {
  it("has at least the two ollamas skills", () => {
    expect(skillDirs).toEqual(expect.arrayContaining(["orchestra-conductor", "fleet-orchestrator"]));
  });

  for (const s of skillDirs) {
    it(`${s}/SKILL.md carries name + description`, () => {
      const p = join(SKILLS_DIR, s, "SKILL.md");
      expect(existsSync(p), `${s} missing SKILL.md`).toBe(true);
      const fm = frontmatter(readFileSync(p, "utf8"));
      expect(/name:\s*\S/.test(fm), `${s} missing name`).toBe(true);
      expect(/description:\s*\S/.test(fm), `${s} missing description`).toBe(true);
    });
  }
});
