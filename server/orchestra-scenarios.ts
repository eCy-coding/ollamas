// L46 — the resilience the system was never actually tested for.
//
// Measured: the outcome ledger held only TWO distinct tasks (disk, system load), both of them
// test tasks I wrote. "It works on real tasks" was an assertion, not a measurement. A task can
// fail in more ways than it can succeed — no catalog match, a gated command, an empty result,
// a multi-part question needing a follow-up — and none of those paths had ever been exercised.
//
// This module is the SPECIFICATION: each scenario states a task and the STRUCTURAL behaviour it
// must produce, phrased in terms an observer can check from the evidence note and the run
// result rather than the model's exact words. The e2e gate runs them live against the real
// stack. Keeping the spec pure and separate means the expectations can be reviewed on their own.
import { planTask, isRiskyCommand } from "./orchestra-tasks";
import { ecymPropose } from "./orchestra-roles";

/** What an observer can verify about a task run WITHOUT depending on the model's wording. */
export interface ScenarioExpect {
  /** A command step is planned (eCym's catalog matched the title). */
  hasCommand: boolean;
  /** The planned command is gated (needs approval) rather than auto-run. */
  gated: boolean;
  /** Structural family, for the report — not asserted directly. */
  kind: "single" | "multi-part" | "no-command" | "gated" | "recall-only";
}

export interface Scenario {
  title: string;
  why: string;
  expect: ScenarioExpect;
}

/**
 * The scenarios. Every `expect` is DERIVED from the same pure planning the runtime uses
 * (planTask / ecymPropose), so the spec can never drift from what the system will actually do:
 * a test asserts the derivation, and the e2e gate asserts the live behaviour matches it.
 */
export const SCENARIOS: Scenario[] = [
  {
    title: "disk doluluk durumu nedir",
    why: "tek komutla tam cevaplanır — zincir gerekmez",
    expect: { hasCommand: true, gated: false, kind: "single" },
  },
  {
    title: "hangi dizindeyim",
    why: "en basit safe komut (pwd) — bir tur, cevap",
    expect: { hasCommand: true, gated: false, kind: "single" },
  },
  {
    title: "makine adı ne",
    why: "hostname — tek isim cevabı, sayı yok (grounding isim üzerinden)",
    expect: { hasCommand: true, gated: false, kind: "single" },
  },
  {
    title: "sistem yükü nedir ve hangi işlem sorumlu",
    why: "iki parçalı → uptime bir kısmı verir, ikinci parça takip ister",
    expect: { hasCommand: true, gated: false, kind: "multi-part" },
  },
  {
    title: "bellek durumu ne",
    why: "vm_stat/top — makine durumu, tek tur",
    expect: { hasCommand: true, gated: false, kind: "single" },
  },
  {
    title: "işlemi sonlandır",
    why: "kill → GATED: onay bekler, otomatik çalışmaz",
    expect: { hasCommand: true, gated: true, kind: "gated" },
  },
  {
    title: "felsefede özgür irade var mı",
    why: "katalog eşleşmez → komut adımı YOK, yalnız vault+recall",
    expect: { hasCommand: false, gated: false, kind: "no-command" },
  },
  {
    title: "orkestra nasıl çalışıyor",
    why: "geçmiş görevler brain'de → recall baskın, katalog eşleşmez",
    expect: { hasCommand: false, gated: false, kind: "recall-only" },
  },
];

/**
 * Derive the observable expectation for a title from the SAME planner the runtime uses. PURE.
 * This is what keeps a scenario's stated `expect` honest — a test asserts derive() equals it.
 */
export function deriveExpect(title: string): { hasCommand: boolean; gated: boolean } {
  const steps = planTask(title);
  const cmd = steps.find((s) => s.role === "command");
  return { hasCommand: !!cmd, gated: !!cmd && !cmd.auto };
}

/** A gated title's command must actually be one the safety table would gate (denylist/gated). */
export function isGatedTitle(title: string): boolean {
  const p = ecymPropose(title);
  if (!p) return false;
  return !p.safe || isRiskyCommand(p.cmd);
}
