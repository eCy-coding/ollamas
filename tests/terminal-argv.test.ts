// Faz11C D-002 — TerminalManager.executeArgv: no-shell argv exec so grep_search's
// multi-word / regex-metachar query searches correctly (execute()'s quoted string +
// whitespace-split corrupted it: `grep -rnI "a b" .` → argv ['"a','b"'] → grep error).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../server/terminal";
import { db } from "../server/db";

let dir: string;
beforeAll(() => {
  db.data.permissions.commandExec = true; // gate must be open for live exec
  dir = mkdtempSync(join(tmpdir(), "grep-argv-"));
  writeFileSync(join(dir, "f.ts"), "export function foo() { return 1; }\nconst x = 2;\n");
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

describe("executeArgv — grep_search no-shell argv (Faz11C D-002)", () => {
  it("multi-word query tek argv → eşleşir (tırnak bozulması yok)", async () => {
    const r = await TerminalManager.executeArgv(true, dir, "grep", ["-rnI", "export function", "."]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("export function");
  });

  it("eşleşme yoksa exit 1, crash yok", async () => {
    const r = await TerminalManager.executeArgv(true, dir, "grep", ["-rnI", "no_such_pattern_xyz", "."]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("allowlist-dışı binary reddedilir (126)", async () => {
    const r = await TerminalManager.executeArgv(true, dir, "rm", ["-rf", "."]);
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("Security block");
  });
});
