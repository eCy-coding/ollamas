// `ollamas <sub>` pseudo-binary dispatch inside TerminalManager.execute — "ollamas" resolves to a
// host shell ALIAS (not a PATH executable), so it must be special-cased before the raw-binary
// allowlist check rather than added to ALLOWED_BINARIES (which would try to execFile it and 126
// with ENOENT). Covers: unknown subcommand rejection, doctor/top argument rejection (no
// --watch/--interval — those need a real TTY loop this sandbox never provides), ecysearcher action
// + flag allowlisting, and that the global commandExec permission gate still applies.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { TerminalManager } from "../server/terminal";
import { db } from "../server/db";

beforeAll(() => {
  db.data.permissions.commandExec = true; // gate must be open for live exec
});
afterEach(() => {
  db.data.permissions.commandExec = true; // restore after the permission-gate test below
});

describe("ollamas pseudo-binary dispatch", () => {
  it("unknown subcommand is rejected with 126, not treated as a raw binary", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas up");
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("Security block");
    expect(r.stderr).toContain("not an allowed subcommand");
  });

  it("'ollamas do <task>' (autonomous dispatch) is refused — sandbox is read-mostly introspection only", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas do something");
    expect(r.exitCode).toBe(126);
  });

  it("doctor rejects unsupported flags", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas doctor --watch");
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("does not accept");
  });

  it("doctor runs in-process and returns a report without throwing (gateway may be down in test env)", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas doctor --json");
    expect([0, 1]).toContain(r.exitCode);
    expect(r.stderr).toBe("");
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty("healthy");
  }, 15000);

  it("top rejects --watch (would hang a request-response cycle forever)", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas top --watch");
    expect(r.exitCode).toBe(126);
  });

  it("top runs in-process snapshot-only and returns JSON without throwing", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas top --json");
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }, 15000);

  it("ecysearcher rejects an unknown action", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas ecysearcher nuke");
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("unknown");
  });

  it("ecysearcher rejects an unsupported flag", async () => {
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas ecysearcher status --force");
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("unsupported flag");
  });

  it("global commandExec permission gate still blocks ollamas subcommands", async () => {
    db.data.permissions.commandExec = false;
    const r = await TerminalManager.execute(true, process.cwd(), "ollamas doctor");
    expect(r.exitCode).toBe(126);
    expect(r.stderr).toContain("deactivated");
  });
});
