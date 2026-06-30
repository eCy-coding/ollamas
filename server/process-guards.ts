// server/process-guards.ts — last-resort process-level error guards so a long-running gateway
// SURVIVES stray background errors instead of dying silently. On Node ≥15 an unhandled promise
// rejection terminates the process by DEFAULT, so a single `.catch`-less background promise
// (fire-and-forget notify / webhook / OAuth cleanup) would otherwise take down the whole server.
//
// Policy (researched consensus):
//  - unhandledRejection → log loudly + bump a metric + SURVIVE (a dropped background promise must
//    not kill the gateway; a rising counter surfaces the bug to fix).
//  - uncaughtException → the process state is undefined → log + graceful shutdown + exit (never
//    resume on a corrupt state).
//
// Pure factory (no direct process.on / console coupling) so it is unit-testable with injected deps.

export interface ProcessGuardDeps {
  /** Graceful shutdown closure (drains + exits). Reuses server.ts `shutdown(signal)`. */
  shutdown: (signal: string) => void;
  /** Structured logger; defaults to console at the call site. */
  logError: (msg: string, err: unknown) => void;
  /** Metric bump for a survived rejection. */
  onRejectionSurvived: () => void;
}

export interface ProcessGuards {
  onUnhandledRejection: (reason: unknown) => void;
  onUncaughtException: (err: unknown) => void;
}

/** Build the two handlers from injected deps. Pure — no global registration. */
export function makeProcessGuards(deps: ProcessGuardDeps): ProcessGuards {
  return {
    onUnhandledRejection(reason: unknown) {
      // SURVIVE: log + count, do NOT shut down. A background promise dropping must not be fatal.
      deps.onRejectionSurvived();
      deps.logError("[ProcessGuard] unhandledRejection survived (background promise had no .catch)", reason);
    },
    onUncaughtException(err: unknown) {
      // FATAL: state is undefined → log + graceful drain + exit. Do not resume.
      deps.logError("[ProcessGuard] uncaughtException — draining + exiting (state undefined)", err);
      deps.shutdown("uncaughtException");
    },
  };
}

/** Register the guards on the live process. Idempotent-friendly (caller registers once at boot). */
export function installProcessGuards(deps: ProcessGuardDeps): ProcessGuards {
  const guards = makeProcessGuards(deps);
  process.on("unhandledRejection", guards.onUnhandledRejection);
  process.on("uncaughtException", guards.onUncaughtException);
  return guards;
}
