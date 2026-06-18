// Scripts domain v2 — golden-output tests for deterministic, bridge-free tools.
// Only class-A tools (pure/local, no live bridge/network/system-state) get
// golden coverage. Class-C tools are DEFERRED ON PURPOSE (not silently): they
// depend on a live bridge, network, git/docker, or process state and belong in
// a smoke/integration harness (ROADMAP v7/v8). Deferred set:
//   health_probe, run_tests, build_app, lint_format, tools_doctor, log_stream,
//   web_search, process_port, kill_process, pkg_install, git_ops, git_commit,
//   apply_patch, shell_check (docker).
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOGBOOK = path.resolve(__dirname, "../../bin/host-bridge/tools/logbook.mjs");
let dataDir = "";

function runLogbook(args: string[], dir = dataDir): { code: number; out: string } {
  try {
    const out = execFileSync("node", [LOGBOOK, ...args], {
      env: { ...process.env, MISSION_CONTROL_DATA_DIR: dir },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}

describe("logbook.mjs golden output", () => {
  beforeEach(() => { dataDir = mkdtempSync(path.join(os.tmpdir(), "scr-golden-")); });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  test("tail on empty store → total 0, no entries", () => {
    const { code, out } = runLogbook(["tail"]);
    expect(code).toBe(0);
    const j = JSON.parse(out);
    expect(j).toMatchObject({ ok: true, total: 0, shown: 0, entries: [] });
  });

  test("add then tail returns the note (deterministic shape)", () => {
    const add = runLogbook(["add", "hello world"]);
    expect(add.code).toBe(0);
    expect(JSON.parse(add.out)).toMatchObject({ ok: true, added: "hello world" });

    const { out } = runLogbook(["tail"]);
    const j = JSON.parse(out);
    expect(j.ok).toBe(true);
    expect(j.total).toBe(1);
    expect(j.entries[0]).toMatchObject({ kind: "note", entry: "hello world" });
    expect(typeof j.entries[0].ts).toBe("string"); // ISO ts present (value non-deterministic)
  });

  test("tail respects the n limit", () => {
    for (let i = 0; i < 5; i++) runLogbook(["add", `note-${i}`]);
    const j = JSON.parse(runLogbook(["tail", "2"]).out);
    expect(j.total).toBe(5);
    expect(j.shown).toBe(2);
    expect(j.entries.map((e: any) => e.entry)).toEqual(["note-3", "note-4"]);
  });

  test("unknown subcommand → exit 1 + error JSON (main() wrapper)", () => {
    const { code, out } = runLogbook(["bogus"]);
    expect(code).toBe(1);
    expect(out).toContain("unknown subcommand");
  });
});
