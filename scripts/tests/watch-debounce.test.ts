// Scripts domain v13 — watch dev-loop core. Debounce collapses bursts; isWatchable
// ignores build/dep/cache paths (no self-trigger storm, RISK-SCR-017).
import { describe, test, expect, vi } from "vitest";
import { debounce, isWatchable, IGNORE } from "../../bin/host-bridge/lib/watch.mjs";

describe("watch core", () => {
  test("isWatchable ignores build/dep/cache, allows source", () => {
    expect(isWatchable("scripts/foo.test.ts")).toBe(true);
    expect(isWatchable("bin/host-bridge/gate.mjs")).toBe(true);
    expect(isWatchable("node_modules/x/index.js")).toBe(false);
    expect(isWatchable("bin/ios-bridge/.build/debug/x")).toBe(false);
    expect(isWatchable("coverage/lcov.info")).toBe(false);
    expect(isWatchable(".git/HEAD")).toBe(false);
    expect(isWatchable("scripts/foo.ts~")).toBe(false);
    expect(isWatchable("")).toBe(false);
  });

  test("IGNORE covers the swift/coverage/vcs/deps churn dirs", () => {
    for (const d of ["node_modules", ".git", ".build", "coverage", "dist", ".swiftpm"]) {
      expect(IGNORE).toContain(d);
    }
  });

  test("debounce collapses a burst into one trailing call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a"); d("b"); d("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("c"); // last args win
    vi.useRealTimers();
  });

  test("debounce.cancel prevents the pending call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(); d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
