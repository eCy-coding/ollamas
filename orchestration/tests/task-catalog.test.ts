import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTask, catalogRowErrors, duplicateIds, type Task } from "../bin/lib/task-catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CATALOG: Task[] = JSON.parse(readFileSync(join(REPO, "orchestration", "TASKS_100.json"), "utf8"));

describe("resolveTask — precedence", () => {
  const cat: Task[] = [
    { id: "backend-tokens", lane: "backend", target: "server/tokens.ts", goal: "guard empty countTokens" },
    { id: "cli-output", lane: "cli", target: "cli/lib/output.ts", goal: "jsdoc shouldColor precedence" },
  ];
  it("exact id wins", () => { expect(resolveTask("cli-output", cat)?.id).toBe("cli-output"); });
  it("id substring (either direction)", () => {
    expect(resolveTask("please do backend-tokens now", cat)?.id).toBe("backend-tokens");
  });
  it("token-overlap on goal/target when no id match", () => {
    expect(resolveTask("fix the shouldColor thing in output", cat)?.id).toBe("cli-output");
  });
  it("returns null when nothing plausibly matches", () => {
    expect(resolveTask("completely unrelated zzz", cat)).toBeNull();
    expect(resolveTask("", cat)).toBeNull();
    expect(resolveTask("x", [])).toBeNull();
  });
});

describe("TASKS_100 catalog integrity (eksiksiz guarantee)", () => {
  it("has exactly 100 tasks", () => { expect(CATALOG.length).toBe(100); });
  it("every row is structurally valid", () => {
    const bad = CATALOG.flatMap((t) => catalogRowErrors(t).map((e) => `${(t as Task).id}: ${e}`));
    expect(bad).toEqual([]);
  });
  it("all ids are unique", () => { expect(duplicateIds(CATALOG)).toEqual([]); });
  it("EVERY target file exists in the repo", () => {
    const missing = CATALOG.filter((t) => !existsSync(join(REPO, t.target))).map((t) => `${t.id} → ${t.target}`);
    expect(missing).toEqual([]);
  });
  it("every task resolves to itself by id", () => {
    const unresolvable = CATALOG.filter((t) => resolveTask(t.id, CATALOG)?.id !== t.id).map((t) => t.id);
    expect(unresolvable).toEqual([]);
  });
});
