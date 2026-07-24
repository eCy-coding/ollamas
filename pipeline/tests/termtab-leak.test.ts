// Leak-measurement tests for the tab runtime.
//
// These pass an explicit ROOT rather than pointing HOME at a scratch dir: TAB_ROOT is
// resolved from homedir() at import time, so a HOME override after import changes nothing —
// a test that relied on it would be testing a fiction, which is exactly the class of bug
// (`openTabDirs` reading a file nobody wrote) this file exists to prevent. `openTabDirs` and
// `sweepTabs` therefore take an optional root, defaulting to TAB_ROOT in production.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTabDirs, sweepTabs, isOpenTab, MARK_DONE } from "../runtime/termtab";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ecym-tab-"));
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const lane = (id: string, opts: { queue?: boolean; done?: boolean } = {}) => {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  if (opts.queue !== false) writeFileSync(join(dir, "queue"), "", "utf8");
  writeFileSync(join(dir, "log"), opts.done ? `${MARK_DONE}\n` : "@@TAB-READY@@\n", "utf8");
  return dir;
};
const names = (dirs: string[]) => dirs.map((d) => d.split("/").pop()).sort();

describe("openTabDirs — real disk, not a phantom .index", () => {
  it("is empty for a root that does not exist", () => {
    expect(openTabDirs(join(root, "nope"))).toEqual([]);
  });

  it("is empty for a fresh, empty root", () => {
    expect(openTabDirs(root)).toEqual([]);
  });

  it("counts a lane that has a queue and no DONE marker as open", () => {
    lane("ollamas");
    expect(names(openTabDirs(root))).toEqual(["ollamas"]);
  });

  // The exact bug's opposite: a closed tab must NOT be reported as a leak.
  it("does not count a tab whose log carries the DONE marker", () => {
    lane("ecym", { done: true });
    expect(openTabDirs(root)).toEqual([]);
  });

  // Infra dirs (_conductor, _watch, …) have no queue and must be excluded.
  it("ignores infra directories that have no queue", () => {
    mkdirSync(join(root, "_conductor"), { recursive: true });
    writeFileSync(join(root, "_conductor", "conductor.sh"), "x", "utf8");
    lane("obsidian");
    expect(names(openTabDirs(root))).toEqual(["obsidian"]);
  });

  it("reports several open lanes and skips the finished one", () => {
    lane("a");
    lane("b");
    lane("c", { done: true });
    expect(names(openTabDirs(root))).toEqual(["a", "b"]);
  });

  it("treats an unreadable log conservatively (still open)", () => {
    const d = join(root, "x");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "queue"), "", "utf8");   // queue but NO log file
    expect(isOpenTab(d)).toBe(true);
  });
});

describe("sweepTabs — reports what actually happened", () => {
  it("closes exactly the open tabs and none of the finished ones", () => {
    lane("a");
    lane("b");
    lane("done", { done: true });
    expect(sweepTabs(root)).toEqual({ closed: 2, failed: 0 });
  });

  it("is a no-op on an empty root", () => {
    expect(sweepTabs(root)).toEqual({ closed: 0, failed: 0 });
  });

  it("actually appends the __END__ sentinel to each swept queue", () => {
    lane("a");
    sweepTabs(root);
    expect(readFileSync(join(root, "a", "queue"), "utf8")).toContain("__END__");
  });

  // After a sweep, a swept tab is still "open" on disk: the loop confirms DONE
  // asynchronously, so the sweep signalled it rather than faking its closure.
  it("does not pretend a signalled tab is already done", () => {
    lane("a");
    sweepTabs(root);
    expect(names(openTabDirs(root))).toEqual(["a"]);
  });
});
