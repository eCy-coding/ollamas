/**
 * Persistent rotating log file helpers (pure-core + tmp-dir IO).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateIfNeeded, appendLogLine, fmtLogLine, maskSecrets } from "../server/logfile";

describe("fmtLogLine / maskSecrets (pure)", () => {
  it("formats [ts] [level] msg", () => {
    expect(fmtLogLine("2026-07-01T00:00:00Z", "info", "hello")).toBe("[2026-07-01T00:00:00Z] [info] hello");
  });
  it("masks GitHub PAT / Google key tokens", () => {
    expect(maskSecrets("tok ghp_ABCDEFGHIJKLMNOPQRST end")).toContain("[REDACTED]");
    expect(maskSecrets("tok ghp_ABCDEFGHIJKLMNOPQRST end")).not.toContain("ghp_ABCDEFGHIJKLMNOPQRST");
    expect(fmtLogLine("t", "out", "key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toContain("[REDACTED]");
  });
});

describe("rotateIfNeeded / appendLogLine (tmp dir)", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("no-op when the file is missing or under cap", () => {
    dir = mkdtempSync(join(tmpdir(), "ecy-log-"));
    const p = join(dir, "x.log");
    expect(rotateIfNeeded(p).rotated).toBe(false); // missing
    writeFileSync(p, "small");
    expect(rotateIfNeeded(p, { maxBytes: 1000 }).rotated).toBe(false); // under cap
  });

  it("rotates over cap and keeps a bounded ring (FIFO)", () => {
    dir = mkdtempSync(join(tmpdir(), "ecy-log-"));
    const p = join(dir, "x.log");
    writeFileSync(p, "A".repeat(50));
    const r = rotateIfNeeded(p, { maxBytes: 10, keep: 2 });
    expect(r.rotated).toBe(true);
    expect(existsSync(`${p}.1`)).toBe(true); // current → .1
    expect(existsSync(p)).toBe(false);       // caller's next write recreates it
    expect(readFileSync(`${p}.1`, "utf-8")).toBe("A".repeat(50));
  });

  it("appendLogLine writes a newline-terminated line and rotates when needed", () => {
    dir = mkdtempSync(join(tmpdir(), "ecy-log-"));
    const p = join(dir, "x.log");
    appendLogLine(p, "first");
    appendLogLine(p, "second");
    expect(readFileSync(p, "utf-8")).toBe("first\nsecond\n");
    // force rotation on the next append
    writeFileSync(p, "B".repeat(40));
    appendLogLine(p, "post-rotate", { maxBytes: 10, keep: 1 });
    expect(existsSync(`${p}.1`)).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("post-rotate\n"); // fresh file after rotation
    expect(statSync(`${p}.1`).size).toBe(40);
  });
});
