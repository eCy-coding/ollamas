import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilesystemManager } from "../server/files";

// C3: /api/workspace/download did fs.createReadStream(safePath).pipe(res) with no
// 'error' handler and no directory check. A directory path → async EISDIR → uncaught
// → whole-gateway crash. resolveReadableFile rejects directories/missing files first.
describe("FilesystemManager.resolveReadableFile (C3 download crash guard)", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-dl-"));
    fs.writeFileSync(path.join(root, "file.txt"), "hi");
    fs.mkdirSync(path.join(root, "subdir"));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("returns the confined safe path for a real file", () => {
    expect(FilesystemManager.resolveReadableFile(root, "file.txt")).toBe(path.join(root, "file.txt"));
  });

  it("rejects a directory (the EISDIR crash trigger)", () => {
    expect(() => FilesystemManager.resolveReadableFile(root, "subdir")).toThrow(/directory/i);
    try { FilesystemManager.resolveReadableFile(root, "subdir"); } catch (e: any) { expect(e.code).toBe("EISDIR_DOWNLOAD"); }
  });

  it("rejects a missing file", () => {
    expect(() => FilesystemManager.resolveReadableFile(root, "nope.txt")).toThrow(/does not exist/i);
    try { FilesystemManager.resolveReadableFile(root, "nope.txt"); } catch (e: any) { expect(e.code).toBe("ENOENT_DOWNLOAD"); }
  });

  it("still blocks path traversal", () => {
    expect(() => FilesystemManager.resolveReadableFile(root, "../../etc/passwd")).toThrow(/traversal/i);
  });
});
