import { describe, test, expect } from "vitest";
import { DesktopCommander } from "../server/commander";

// T1: server/commander.ts is a security-sensitive shell-exec boundary (allowlist +
// python3 path-traversal guard) that had ZERO tests. No code bug was found — these
// tests LOCK the invariants so a refactor can't silently weaken them. Every case below
// throws BEFORE execFileP runs, so the suite spawns nothing.
describe("DesktopCommander security invariants (T1)", () => {
  test("rejects a non-allowlisted command", async () => {
    await expect(DesktopCommander.execute("rm", ["-rf", "/"])).rejects.toThrow(/not permitted/i);
    await expect(DesktopCommander.execute("bash", ["-c", "evil"])).rejects.toThrow(/not permitted/i);
    await expect(DesktopCommander.execute("curl", ["http://x"])).rejects.toThrow(/not permitted/i);
  });

  test("rejects a python3 target that is not a .py file", async () => {
    await expect(DesktopCommander.execute("python3", ["notpy.txt"])).rejects.toThrow(/Invalid Python script/i);
  });

  test("blocks python3 path traversal outside the scripts dir", async () => {
    await expect(DesktopCommander.execute("python3", ["../../etc/evil.py"])).rejects.toThrow(/traversal/i);
  });

  test("rejects a python3 script that does not exist", async () => {
    await expect(DesktopCommander.execute("python3", ["definitely-not-here.py"])).rejects.toThrow(/not found/i);
  });
});
