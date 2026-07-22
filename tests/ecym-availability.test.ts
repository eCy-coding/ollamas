// L35 — eCym under GPU contention.
//
// The seat used to be `ecym: llmActive() ? undefined : gen(...)`: a local model sharing the
// GPU with chat generation, so whenever anything else was generating, eCym vanished from the
// panel entirely — silently, with no entry in `degraded`. Exactly backwards for an orchestra
// meant to run real tasks: the member most likely to be dropped was dropped precisely when
// the machine was busy, i.e. when tasks were actually running.
import { describe, test, expect } from "vitest";
import { resolveEcym, ecymModel, ecymFallbackModel, ecymWaitMs } from "../server/ecym-availability";

const makeGenerator = (model: string) => async () => `answered by ${model}`;
/** Virtual clock: the ladder is exercised without any real waiting. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("configuration", () => {
  test("defaults are the documented ladder", () => {
    expect(ecymModel({} as any)).toBe("ecy");
    expect(ecymFallbackModel({} as any)).toBe("qwen3-4b-ca");
    expect(ecymWaitMs({} as any)).toBe(8000);
  });

  test("garbage config falls back to the default rather than to zero", () => {
    expect(ecymWaitMs({ ECYM_WAIT_MS: "abc" } as any)).toBe(8000);
    expect(ecymWaitMs({ ECYM_WAIT_MS: "-5" } as any)).toBe(8000);
    expect(ecymWaitMs({ ECYM_WAIT_MS: "0" } as any)).toBe(0); // an explicit 0 is a real choice
  });
});

describe("the ladder", () => {
  test("GPU quiet → the full model, no waiting", async () => {
    const r = await resolveEcym({ busy: () => false, makeGenerator, ...fakeClock() });
    expect(r.model).toBe("ecy");
    expect(r.waitedMs).toBe(0);
    expect(r.reason).toBeUndefined();
    expect(await r.generate!([])).toBe("answered by ecy");
  });

  test("busy then free → waits, then still gets the FULL model", async () => {
    const clock = fakeClock();
    let calls = 0;
    // Contention is usually one in-flight generation, over in a moment.
    const busy = () => ++calls <= 2;
    const r = await resolveEcym({ busy, makeGenerator, ...clock });
    expect(r.model).toBe("ecy");
    expect(r.waitedMs).toBeGreaterThan(0);
  });

  test("busy throughout → the lighter model, and the substitution is REPORTED", async () => {
    const r = await resolveEcym({ busy: () => true, makeGenerator, ...fakeClock() });
    expect(r.model).toBe("qwen3-4b-ca");
    expect(r.generate).not.toBeNull();
    // A fallback answer must never be mistaken for the real model's answer.
    expect(r.reason).toContain("qwen3-4b-ca");
    expect(r.reason).toContain("GPU meşgul");
  });

  test("busy with no fallback declared → honest absence with a reason, never a silent drop", async () => {
    const r = await resolveEcym({
      busy: () => true, makeGenerator, ...fakeClock(),
      env: { ECYM_FALLBACK_MODEL: "" } as any,
    });
    expect(r.generate).toBeNull();
    expect(r.reason).toContain("fallback model tanımlı değil");
  });

  test("the wait is bounded — a stuck generation cannot stall a turn", async () => {
    const clock = fakeClock();
    const r = await resolveEcym({
      busy: () => true, makeGenerator, ...clock,
      env: { ECYM_WAIT_MS: "1000" } as any,
    });
    expect(r.waitedMs).toBeLessThanOrEqual(1500); // budget + at most one poll step
    expect(clock.now()).toBeLessThanOrEqual(1500);
  });

  test("zero wait budget goes straight to the fallback — no pointless polling", async () => {
    const clock = fakeClock();
    const r = await resolveEcym({
      busy: () => true, makeGenerator, ...clock,
      env: { ECYM_WAIT_MS: "0" } as any,
    });
    expect(r.model).toBe("qwen3-4b-ca");
    expect(clock.now()).toBe(0);
  });

  test("a custom primary model is honoured", async () => {
    const r = await resolveEcym({
      busy: () => false, makeGenerator, ...fakeClock(),
      env: { ECY_MODEL: "ecy:candidate" } as any,
    });
    expect(r.model).toBe("ecy:candidate");
  });
});
