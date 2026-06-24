import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilesystemManager } from "../server/files";

// Upload/download P1 core: the binary-safe buffer path + the path-traversal guard
// that every upload/download surface (HTTP routes, upload_file/download_file tools,
// MCP) funnels through. Tests the security-critical core, not the HTTP wiring.
describe("FilesystemManager binary transfer + path safety", () => {
  let root: string;
  beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-ft-")); });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("round-trips arbitrary binary bytes uncorrupted (PNG header + non-utf8 bytes)", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
    FilesystemManager.writeFileBuffer(true, root, "assets/logo.png", bytes);
    const back = FilesystemManager.readFileBuffer(true, root, "assets/logo.png");
    expect(Buffer.compare(back, bytes)).toBe(0);
  });

  it("utf-8 readFile WOULD corrupt the same bytes — proves the buffer path is required", () => {
    const bytes = Buffer.from([0x89, 0xff, 0xfe, 0x00]);
    FilesystemManager.writeFileBuffer(true, root, "bin.dat", bytes);
    const reEncoded = Buffer.from(FilesystemManager.readFile(true, root, "bin.dat"), "utf-8");
    expect(Buffer.compare(reEncoded, bytes)).not.toBe(0);
  });

  it("base64 wire round-trip (the tool/HTTP contract) preserves bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
    const wire = bytes.toString("base64");
    FilesystemManager.writeFileBuffer(true, root, "wire.bin", Buffer.from(wire, "base64"));
    const back = FilesystemManager.readFileBuffer(true, root, "wire.bin");
    expect(back.toString("base64")).toBe(wire);
  });

  it("writeFileBuffer rejects path traversal escaping the workspace root", () => {
    expect(() => FilesystemManager.writeFileBuffer(true, root, "../../etc/evil", Buffer.from("x")))
      .toThrow(/traversal/i);
  });

  it("readFileBuffer rejects path traversal", () => {
    expect(() => FilesystemManager.readFileBuffer(true, root, "../../../etc/passwd"))
      .toThrow(/traversal/i);
  });

  it("returns a resolved path confined to the workspace root", () => {
    const p = FilesystemManager.writeFileBuffer(true, root, "nested/dir/file.bin", Buffer.from([1, 2, 3]));
    expect(p.startsWith(path.resolve(root))).toBe(true);
  });
});
