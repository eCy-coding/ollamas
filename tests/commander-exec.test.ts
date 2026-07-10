// M-003 (V4) — DesktopCommander.execute regression shield. The code is already
// correct (execFile, no shell; strict allowlist; python3 .py + path-traversal
// guard) — see 17-KAYNAK-KOD §C [M-003]. These tests LOCK that behavior so a
// regression to exec(`${cmd} ${args}`) or a dropped traversal guard reddens.
// Kod DEĞİŞMEZ (test-only, ⊘).
import { describe, test, expect } from "vitest";
import { DesktopCommander } from "../server/commander";

describe("DesktopCommander.execute (M-003)", () => {
  test("allowlist-dışı komut → throw 'not permitted'", async () => {
    await expect(DesktopCommander.execute("curl", ["http://evil"])).rejects.toThrow(/not permitted/i);
    await expect(DesktopCommander.execute("bash", ["-c", "id"])).rejects.toThrow(/not permitted/i);
    await expect(DesktopCommander.execute("rm", ["-rf", "/"])).rejects.toThrow(/not permitted/i);
  });

  test("shell metachars in args do NOT reach a shell (execFile argv isolation)", async () => {
    // The metachars "; whoami" / "&& id" / "$(whoami)" are handed to execFile as
    // literal argv elements — never to /bin/sh. `git` rejects them as an unknown
    // subcommand and throws. Were the sink exec(`git ; whoami && id`), the injected
    // `id` would run and its signature output `uid=NNN` would surface. It must NOT.
    let combined = "";
    try {
      combined = await DesktopCommander.execute("git", ["; whoami", "&& id", "$(whoami)"]);
    } catch (e: any) {
      combined = String(e?.message ?? "");
    }
    expect(combined).not.toMatch(/uid=\d+/); // `id` never executed → no shell
  });

  test("python3 ../ traversal → 'Path traversal blocked'", async () => {
    await expect(DesktopCommander.execute("python3", ["../evil.py"])).rejects.toThrow(/traversal/i);
    await expect(DesktopCommander.execute("python3", ["../../etc/passwd.py"])).rejects.toThrow(/traversal/i);
  });

  test("python3 non-.py argument → 'Invalid Python script'", async () => {
    await expect(DesktopCommander.execute("python3", ["-c", "print(1)"])).rejects.toThrow(/Invalid Python script/i);
  });
});
