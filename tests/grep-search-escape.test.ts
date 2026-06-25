import { describe, test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalManager } from "../server/terminal";
import { db } from "../server/db";

// H5 (and its broken first fix): grep_search must search literal text in LIVE mode.
// The first fix shell-quoted the query (shArg) into a command STRING, but TerminalManager
// runs execFile(shell:false) after splitting on whitespace — so the quotes reached grep
// LITERALLY and it matched nothing (re-introducing the original bug). The real fix passes
// the query as a discrete argv token via executeArgv. These tests drive the REAL executor
// (the prior test used a string-capturing stub, so it could not catch this).
describe("grep_search real-executor behavior (H5)", () => {
  let ws: string;
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "grep-ws-"));
    fs.writeFileSync(path.join(ws, "a.txt"), "hello foo world\nsecond line\n");
    db.data.permissions.commandExec = true; // executeArgv requires the exec permission
  });

  test("executeArgv passes the query as one argv token and finds the literal", async () => {
    const r = await TerminalManager.executeArgv(true, ws, "grep", ["-rnIF", "--", "foo", "."]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello foo world");
  });

  test("multi-word queries match (whitespace no longer splits the pattern)", async () => {
    const r = await TerminalManager.executeArgv(true, ws, "grep", ["-rnIF", "--", "foo world", "."]);
    expect(r.stdout).toContain("hello foo world");
  });

  test("the OLD shell-quoted string form does NOT match — proves the fix was needed", async () => {
    const bad = await TerminalManager.execute(true, ws, `grep -rnIF -- 'foo' .`);
    expect(bad.stdout).not.toContain("hello foo world"); // quotes are passed to grep literally
  });
});
