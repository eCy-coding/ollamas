import { describe, it, expect } from "vitest";
import { parseKillArgs } from "../bin/host-bridge/tools/lib/kill-args.mjs";

// C4: the old index-based filter excluded args[0] when --sig was ABSENT
// (sigIdx=-1 → sigIdx+1=0 → `i !== 0` dropped the real target), so the common
// `kill_process <pid>` call always threw "target required".
describe("parseKillArgs (C4 — --sig must never consume the target)", () => {
  it("no --sig: target is the PID, default signal TERM", () => {
    expect(parseKillArgs(["1234"])).toEqual({ target: "1234", sig: "TERM" });
  });
  it("no --sig: port target", () => {
    expect(parseKillArgs([":3000"])).toEqual({ target: ":3000", sig: "TERM" });
  });
  it("--sig before the target", () => {
    expect(parseKillArgs(["--sig", "KILL", "1234"])).toEqual({ target: "1234", sig: "KILL" });
  });
  it("--sig after the target", () => {
    expect(parseKillArgs(["1234", "--sig", "KILL"])).toEqual({ target: "1234", sig: "KILL" });
  });
  it("unknown signal falls back to TERM", () => {
    expect(parseKillArgs(["1234", "--sig", "BOGUS"])).toEqual({ target: "1234", sig: "TERM" });
  });
  it("missing target => undefined (caller throws)", () => {
    expect(parseKillArgs([]).target).toBeUndefined();
  });
});
