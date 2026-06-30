import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { atomicWriteFileSync } from "../server/db";

describe("atomicWriteFileSync — no truncation, temp+rename durability", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-atomic-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes the file and leaves NO temp orphan", () => {
    const fp = path.join(dir, "config.json");
    atomicWriteFileSync(fp, JSON.stringify({ a: 1 }));
    expect(JSON.parse(fs.readFileSync(fp, "utf-8"))).toEqual({ a: 1 });
    // no .tmp.* sibling left behind
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("fully REPLACES a pre-existing file (never leaves a prefix of the old content)", () => {
    const fp = path.join(dir, "config.json");
    atomicWriteFileSync(fp, "OLD-LONGER-CONTENT-AAAAAAAAAAAAAAAA");
    atomicWriteFileSync(fp, "NEW");
    expect(fs.readFileSync(fp, "utf-8")).toBe("NEW"); // not "NEWLONGER..." — rename replaces wholesale
  });

  it("honors the file mode (0o600 for the master key)", () => {
    const fp = path.join(dir, ".master_key");
    atomicWriteFileSync(fp, Buffer.from([1, 2, 3]), { mode: 0o600 });
    expect(fs.statSync(fp).mode & 0o777).toBe(0o600);
  });

  it("round-trips a Buffer payload unchanged", () => {
    const fp = path.join(dir, "key.bin");
    const buf = Buffer.from([0, 255, 128, 7]);
    atomicWriteFileSync(fp, buf);
    expect(fs.readFileSync(fp).equals(buf)).toBe(true);
  });

  it("cleans up the temp file when the rename target dir is gone (error path)", () => {
    const fp = path.join(dir, "missing", "config.json"); // parent does not exist → write fails
    expect(() => atomicWriteFileSync(fp, "x")).toThrow();
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });
});
