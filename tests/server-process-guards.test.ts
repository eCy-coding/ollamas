import { describe, it, expect, vi } from "vitest";
import { makeProcessGuards } from "../server/process-guards";

describe("process-guards — survive background rejections, exit on uncaught exception", () => {
  function deps() {
    return {
      shutdown: vi.fn(),
      logError: vi.fn(),
      onRejectionSurvived: vi.fn(),
    };
  }

  it("unhandledRejection: logs + counts + does NOT shut down (gateway survives)", () => {
    const d = deps();
    const g = makeProcessGuards(d);
    g.onUnhandledRejection(new Error("stray background promise"));
    expect(d.onRejectionSurvived).toHaveBeenCalledTimes(1);
    expect(d.logError).toHaveBeenCalledTimes(1);
    expect(d.shutdown).not.toHaveBeenCalled(); // survive — never fatal
  });

  it("uncaughtException: logs + graceful shutdown once (state undefined → exit)", () => {
    const d = deps();
    const g = makeProcessGuards(d);
    g.onUncaughtException(new Error("boom"));
    expect(d.logError).toHaveBeenCalledTimes(1);
    expect(d.shutdown).toHaveBeenCalledTimes(1);
    expect(d.shutdown).toHaveBeenCalledWith("uncaughtException");
    expect(d.onRejectionSurvived).not.toHaveBeenCalled(); // not a rejection path
  });

  it("repeated rejections each count (a rising metric surfaces the bug)", () => {
    const d = deps();
    const g = makeProcessGuards(d);
    g.onUnhandledRejection("a");
    g.onUnhandledRejection("b");
    g.onUnhandledRejection("c");
    expect(d.onRejectionSurvived).toHaveBeenCalledTimes(3);
    expect(d.shutdown).not.toHaveBeenCalled();
  });
});
