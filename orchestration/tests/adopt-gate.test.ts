import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditWorktree } from "../bin/adopt-gate";

// Concurrent-task co-test (dod): adopt-gate.auditWorktree — the syft-free branches
// (no package.json, or syftOk=false) that need no external tooling.
describe("auditWorktree", () => {
  let root: string;
  beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-aw-")); });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("no package.json → flagged empty, note explains", () => {
    const r = auditWorktree(root, "feat/x", true);
    expect(r.lane).toBe("feat/x");
    expect(r.flagged).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.note).toMatch(/package\.json yok/);
  });

  it("package.json present but syft unavailable → SBOM skipped, no false flags", () => {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { lodash: "^4" } }));
    const r = auditWorktree(root, "feat/y", false);
    expect(r.lane).toBe("feat/y");
    expect(r.flagged).toEqual([]); // no SBOM → cannot flag, never false-positive
    expect(r.note).toMatch(/syft yok/);
  });
});
