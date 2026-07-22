// The watchdog's self-heal decision, extracted so it can be tested without launchctl.
//
// The bug this exists to prevent, measured 2026-07-22: once a leg crossed the red
// threshold, the shell script kickstarted its service on EVERY subsequent run and the
// counter never reset until green. odysseus needs ~210s to bind :7860 (onnxruntime +
// chroma + model init) and the gate runs every 300s — so a restart landed on a service
// that was still booting, which reset the boot, which kept the leg red. That is the
// "odysseus :7860 intermittent" symptom: the healer was causing the outage it saw.
import { describe, test, expect } from "vitest";
import { parseState, serializeState, decide, type WatchdogState } from "../server/e2e-watchdog-policy";

const LABELS: Record<string, string> = {
  "odysseus-bridge": "com.odysseus.server",
  "pulse:4777": "com.ody.pulse",
};
const labelFor = (c: string) => LABELS[c] ?? "";
const T0 = 1_700_000_000_000;
const opts = { thresh: 3, graceMs: 600_000, labelFor };

describe("parseState — tolerant of the format it is replacing", () => {
  test("the old flat-int format is read, not discarded", () => {
    expect(parseState('{"odysseus-bridge":4}')).toEqual({ "odysseus-bridge": { n: 4, kickedAt: 0 } });
  });

  test("the written format round-trips", () => {
    const s: WatchdogState = { "pulse:4777": { n: 2, kickedAt: T0 } };
    expect(parseState(serializeState(s))).toEqual(s);
  });

  test("the per-leg object shape is still readable (it was written briefly)", () => {
    expect(parseState('{"pulse:4777":{"n":2,"kickedAt":123}}')).toEqual({ "pulse:4777": { n: 2, kickedAt: 123 } });
  });

  test("garbage, empty and null degrade to an empty state instead of throwing", () => {
    expect(parseState("{ not json")).toEqual({});
    expect(parseState("")).toEqual({});
    expect(parseState("null")).toEqual({});
    expect(parseState('{"x":"nonsense"}')).toEqual({});
  });
});

describe("serializeState — must not break the shell script it shares the file with", () => {
  // The launchd job may still be running the PREVIOUS watchdog while this one is merged.
  // That script does  n=$(python -c "...get(chk,0)")  then  n=$((n+1))  — so if the value
  // for a check is anything but a bare integer, zsh dies with "bad math expression" and
  // the watchdog stops working entirely. Verified by hand before this test was written.
  test("every check maps to a bare integer at the top level", () => {
    const s: WatchdogState = { "odysseus-bridge": { n: 6, kickedAt: T0 } };
    const parsed = JSON.parse(serializeState(s));
    expect(parsed["odysseus-bridge"]).toBe(6);
    expect(Number.isInteger(parsed["odysseus-bridge"])).toBe(true);
  });

  test("kick times ride in a side channel the old script never reads", () => {
    const parsed = JSON.parse(serializeState({ "odysseus-bridge": { n: 6, kickedAt: T0 } }));
    expect(parsed._kickedAt).toEqual({ "odysseus-bridge": T0 });
  });

  test("a leg that was never kicked carries no side-channel entry", () => {
    const parsed = JSON.parse(serializeState({ "hub:3000": { n: 2, kickedAt: 0 } }));
    expect(parsed._kickedAt).toBeUndefined();
  });

  test("the side channel is never mistaken for a leg when read back", () => {
    const round = parseState(serializeState({ "pulse:4777": { n: 1, kickedAt: T0 } }));
    expect(Object.keys(round)).toEqual(["pulse:4777"]);
  });

  test("empty state serializes to an empty object", () => {
    expect(JSON.parse(serializeState({}))).toEqual({});
  });
});

describe("decide — below the threshold nothing is restarted", () => {
  test("first two red runs only count", () => {
    const r1 = decide({ prev: {}, red: ["odysseus-bridge"], now: T0, ...opts });
    expect(r1.actions).toEqual([]);
    expect(r1.next["odysseus-bridge"].n).toBe(1);

    const r2 = decide({ prev: r1.next, red: ["odysseus-bridge"], now: T0 + 300_000, ...opts });
    expect(r2.actions).toEqual([]);
    expect(r2.next["odysseus-bridge"].n).toBe(2);
  });
});

describe("decide — the grace window (this is the regression)", () => {
  test("the third red run restarts the service once", () => {
    const prev: WatchdogState = { "odysseus-bridge": { n: 2, kickedAt: 0 } };
    const r = decide({ prev, red: ["odysseus-bridge"], now: T0, ...opts });
    expect(r.actions).toEqual([{ kind: "kick", chk: "odysseus-bridge", label: "com.odysseus.server", n: 3 }]);
    expect(r.next["odysseus-bridge"].kickedAt).toBe(T0);
  });

  test("a still-booting service is NOT restarted again inside the grace window", () => {
    const prev: WatchdogState = { "odysseus-bridge": { n: 3, kickedAt: T0 } };
    // One gate interval later (300s) the service is still binding; graceMs is 600s.
    const r = decide({ prev, red: ["odysseus-bridge"], now: T0 + 300_000, ...opts });
    expect(r.actions).toEqual([]);                          // <- the fix
    expect(r.next["odysseus-bridge"].n).toBe(4);            // still counted
    expect(r.next["odysseus-bridge"].kickedAt).toBe(T0);    // the kick time is not moved
  });

  test("once the grace window expires a genuinely dead service is restarted again", () => {
    const prev: WatchdogState = { "odysseus-bridge": { n: 4, kickedAt: T0 } };
    const r = decide({ prev, red: ["odysseus-bridge"], now: T0 + 600_001, ...opts });
    expect(r.actions[0]).toMatchObject({ kind: "kick", label: "com.odysseus.server" });
    expect(r.next["odysseus-bridge"].kickedAt).toBe(T0 + 600_001);
  });

  test("the grace window must exceed the measured odysseus boot time", () => {
    // Guard against someone tuning graceMs below what the service actually needs.
    const MEASURED_ODYSSEUS_BOOT_MS = 210_000; // 15:03:50 -> 15:07:21, measured
    expect(opts.graceMs).toBeGreaterThan(MEASURED_ODYSSEUS_BOOT_MS);
  });
});

describe("decide — legs with no safe label are notify-only", () => {
  test("the hub is never restarted, only reported", () => {
    const prev: WatchdogState = { "hub:3000": { n: 2, kickedAt: 0 } };
    const r = decide({ prev, red: ["hub:3000"], now: T0, ...opts });
    expect(r.actions).toEqual([{ kind: "notify", chk: "hub:3000", n: 3 }]);
    expect(r.next["hub:3000"].kickedAt).toBe(0); // nothing was restarted
  });

  test("notify-only legs are not rate-limited by the grace window", () => {
    const prev: WatchdogState = { "hub:3000": { n: 5, kickedAt: 0 } };
    const r = decide({ prev, red: ["hub:3000"], now: T0, ...opts });
    expect(r.actions).toEqual([{ kind: "notify", chk: "hub:3000", n: 6 }]);
  });
});

describe("decide — bookkeeping", () => {
  test("a green leg drops out of the state entirely", () => {
    const prev: WatchdogState = { "odysseus-bridge": { n: 3, kickedAt: T0 }, "pulse:4777": { n: 1, kickedAt: 0 } };
    const r = decide({ prev, red: ["pulse:4777"], now: T0 + 10, ...opts });
    expect(r.next["odysseus-bridge"]).toBeUndefined();
    expect(r.next["pulse:4777"].n).toBe(2);
  });

  test("no red legs yields an empty state and no actions", () => {
    const r = decide({ prev: { "pulse:4777": { n: 9, kickedAt: T0 } }, red: [], now: T0, ...opts });
    expect(r.actions).toEqual([]);
    expect(r.next).toEqual({});
  });

  test("several red legs are decided independently", () => {
    const prev: WatchdogState = {
      "odysseus-bridge": { n: 2, kickedAt: 0 },
      "pulse:4777": { n: 2, kickedAt: T0 },        // inside grace
    };
    const r = decide({ prev, red: ["odysseus-bridge", "pulse:4777"], now: T0 + 1000, ...opts });
    expect(r.actions).toEqual([
      { kind: "kick", chk: "odysseus-bridge", label: "com.odysseus.server", n: 3 },
    ]);
  });
});
