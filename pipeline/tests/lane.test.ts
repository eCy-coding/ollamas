import { describe, it, expect } from "vitest";
import {
  encodeStep, decodeStep, runnable, laneState, laneProgress, renderBoard, boardVerdict, makeLane,
  LaneError, QSEP, type Lane,
} from "../lib/lane";

const lane = (states: string[]): Lane => ({
  id: "l", title: "lane",
  steps: states.map((st, i) => ({
    id: `l-${i}`, title: `s${i}`, command: `echo ${i}`,
    state: st as never, startedMs: 1000, endedMs: 1500,
  })),
});

describe("encodeStep / decodeStep", () => {
  it("round-trips a step through one queue line", () => {
    const line = encodeStep({ id: "a-01", title: "typecheck", command: "npx tsc --noEmit" });
    expect(line.split(QSEP)).toHaveLength(3);
    expect(decodeStep(line)).toEqual({ id: "a-01", title: "typecheck", command: "npx tsc --noEmit" });
  });

  // The tab loop reads line-by-line; a value spanning lines would let one step's text become
  // the next step's command.
  it("rejects newlines rather than escaping them", () => {
    expect(() => encodeStep({ id: "a", title: "t", command: "echo 1\necho 2" })).toThrow(LaneError);
    expect(() => encodeStep({ id: "a", title: "line\r", command: "x" })).toThrow(/newline/);
  });

  it("rejects a smuggled separator", () => {
    expect(() => encodeStep({ id: "a", title: `t${QSEP}x`, command: "y" })).toThrow(/separator/);
  });

  it("survives quotes, pipes and unicode in a command", () => {
    const cmd = `bash -c 'echo "ü ok" | grep ü'`;
    expect(decodeStep(encodeStep({ id: "a", title: "tırnak", command: cmd }))!.command).toBe(cmd);
  });

  it("returns null for a malformed line", () => {
    expect(decodeStep("")).toBeNull();
    expect(decodeStep("only-one-field")).toBeNull();
    expect(decodeStep(`${QSEP}${QSEP}`)).toBeNull();   // empty id
    expect(decodeStep(undefined as never)).toBeNull();
  });
});

describe("runnable", () => {
  it("returns the pending steps in order", () => {
    expect(runnable(lane(["ok", "pending", "pending"])).map((s) => s.title)).toEqual(["s1", "s2"]);
  });

  // Steps after a required failure were written assuming it succeeded; running them produces
  // failures that hide the real cause.
  it("halts the lane at a required failure", () => {
    expect(runnable(lane(["ok", "failed", "pending"]))).toHaveLength(0);
  });

  it("continues past a non-required failure", () => {
    const l = lane(["failed", "pending"]);
    l.steps[0].required = false;
    expect(runnable(l).map((s) => s.title)).toEqual(["s1"]);
  });

  it("is empty for a finished lane", () => {
    expect(runnable(lane(["ok", "ok"]))).toHaveLength(0);
  });
});

describe("laneState", () => {
  it("is failed when any step failed, even with later successes", () => {
    expect(laneState(lane(["ok", "failed", "ok"]))).toBe("failed");
  });

  it("is running while a step runs", () => {
    expect(laneState(lane(["ok", "running", "pending"]))).toBe("running");
  });

  it("is ok when every step finished ok or was skipped", () => {
    expect(laneState(lane(["ok", "skipped"]))).toBe("ok");
  });

  it("is pending for an untouched or empty lane", () => {
    expect(laneState(lane(["pending", "pending"]))).toBe("pending");
    expect(laneState({ id: "x", title: "x", steps: [] })).toBe("pending");
  });
});

describe("laneProgress", () => {
  it("counts finished steps and sums their elapsed time", () => {
    const p = laneProgress(lane(["ok", "failed", "pending"]));
    expect(p).toMatchObject({ done: 2, total: 3, state: "failed" });
    expect(p.elapsedMs).toBe(1000);              // two finished steps × 500 ms
    expect(p.ratio).toBeCloseTo(0.6667, 3);
  });

  it("is zero-safe for an empty lane", () => {
    expect(laneProgress({ id: "x", title: "x", steps: [] })).toMatchObject({ done: 0, total: 0, ratio: 0 });
  });

  it("ignores a step that started but has not ended", () => {
    const l = lane(["running"]);
    delete l.steps[0].endedMs;
    expect(laneProgress(l).elapsedMs).toBe(0);
  });
});

describe("renderBoard", () => {
  const lanes: Lane[] = [
    { ...lane(["ok", "running", "pending"]), id: "a", title: "ollamas" },
    { ...lane(["ok", "ok"]), id: "b", title: "obsidian" },
  ];

  it("puts one row per lane with a progress bar and the current step", () => {
    const out = renderBoard(lanes, Date.UTC(2026, 6, 24, 15, 30, 0));
    expect(out[0]).toMatch(/eCym board — 2 lane · 3\/5 step ok/);
    expect(out.some((l) => l.includes("ollamas") && l.includes("█"))).toBe(true);
    expect(out.some((l) => l.includes("s1"))).toBe(true);        // running step title
    expect(out.some((l) => l.includes("obsidian") && l.includes("done"))).toBe(true);
  });

  it("aligns lane titles to a common width", () => {
    const rows = renderBoard(lanes, 0).slice(3);
    const barAt = rows.map((r) => r.indexOf("█") >= 0 ? r.indexOf("█") : r.indexOf("░"));
    expect(new Set(barAt).size).toBe(1);
  });

  it("surfaces failures in the header", () => {
    const failing = [{ ...lane(["failed"]), id: "c", title: "eCym" }];
    expect(renderBoard(failing, 0)[0]).toMatch(/1 FAILED/);
    expect(renderBoard(failing, 0).some((l) => l.includes("FAILED"))).toBe(true);
  });

  it("stamps the refresh time", () => {
    expect(renderBoard(lanes, Date.UTC(2026, 6, 24, 15, 30, 0))[1]).toContain("15:30:00Z");
  });
});

describe("boardVerdict", () => {
  // A partial green is not a green: one red lane fails the board.
  it("fails when any lane failed", () => {
    const v = boardVerdict([{ ...lane(["ok"]), id: "a", title: "a" }, { ...lane(["failed"]), id: "b", title: "b" }]);
    expect(v.ok).toBe(false);
    expect(v.failedLanes).toEqual(["b"]);
    expect(v.reason).toMatch(/failed lanes: b/);
  });

  it("is not ok while a lane is still running", () => {
    const v = boardVerdict([{ ...lane(["running"]), id: "a", title: "a" }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/still running/);
  });

  it("is ok only when every lane finished green", () => {
    expect(boardVerdict([{ ...lane(["ok", "skipped"]), id: "a", title: "a" }]).ok).toBe(true);
  });
});

describe("makeLane", () => {
  it("gives positional ids that survive a title edit", () => {
    const l = makeLane("ollamas", "ollamas", [["typecheck", "npx tsc"], ["test", "npx vitest"]]);
    expect(l.steps.map((s) => s.id)).toEqual(["ollamas-01", "ollamas-02"]);
    expect(l.steps.every((s) => s.state === "pending")).toBe(true);
  });

  it("carries the optional non-required flag", () => {
    const l = makeLane("x", "x", [["a", "cmd"], ["b", "cmd", { required: false }]]);
    expect(l.steps[0].required).toBeUndefined();
    expect(l.steps[1].required).toBe(false);
  });
});
