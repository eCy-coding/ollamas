import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFile } from "../bin/status";

// Concurrent-task co-test (dod): status.ts findFile — recursive, depth-bounded,
// skips node_modules/.git/dist, regex match on the file name.
describe("findFile", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-ff-"));
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "ROADMAP.md"), "# r");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "ROADMAP.md"), "# ignored");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("finds a nested file by regex", () => {
    const hit = findFile(root, /roadmap\.md$/i);
    expect(hit).not.toBeNull();
    expect(hit!.endsWith(path.join("a", "b", "ROADMAP.md"))).toBe(true);
  });

  it("returns null when nothing matches", () => {
    expect(findFile(root, /nonexistent-xyz\.md$/)).toBeNull();
  });

  it("skips node_modules", () => {
    const hit = findFile(root, /roadmap\.md$/i);
    expect(hit!.includes("node_modules")).toBe(false);
  });

  it("respects depth bound (0 = root only)", () => {
    expect(findFile(root, /roadmap\.md$/i, 0)).toBeNull(); // file is 2 levels deep
  });
});
