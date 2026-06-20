// Preflight readiness core (scripts lane, v18) — PURE, no fs/network/spawn here.
// One-command "is my M4 ollamas e2e ready?" — aggregates install invariants
// (node, registry drift) + runtime/service checks (ollama, bridge, LaunchAgent,
// token, benchmark). The doctor.mjs CLI gathers the live checks; this module is
// the pure logic (version parse, launchctl parse, verdict) so it is unit-tested.
//
// Adopts the brew/flutter `doctor` pattern: each check carries an actionable hint.
// Verdict.ok = no CRITICAL failure; runtime gaps are WARN (env-dependent, must not
// false-alarm a healthy-but-not-running setup) — RISK-SCR-025.

// Parse a Node version string ("v24.3.1") and compare its major to a minimum.
export function nodeVersionOk(verStr, min = 24) {
  const m = String(verStr || "").match(/v?(\d+)/);
  return m ? Number(m[1]) >= min : false;
}

// Is the LaunchAgent loaded? `launchctl print gui/$UID/<label>` exits 0 and prints
// the label when bootstrapped; non-zero / empty when not. Accepts the exit code
// (preferred) and/or stdout for robustness.
/**
 * @param {{exitCode?:number|null, stdout?:string}} [res]
 * @param {string} [label]
 * @returns {boolean}
 */
export function parseLaunchctlLoaded({ exitCode, stdout = "" } = {}, label = "com.missioncontrol.terminalbridge") {
  if (exitCode === 0) return true;
  if (exitCode != null && exitCode !== 0) return false;
  return stdout.includes(label); // fallback when only stdout is available
}

// Aggregate checks → verdict. ok = every CRITICAL check passed (warns never fail).
// check: { name, level:"critical"|"warn", ok, detail?, hint? }
export function evaluate(checks = []) {
  const critical = checks.filter((c) => c.level === "critical");
  const warn = checks.filter((c) => c.level !== "critical");
  const criticalFailed = critical.filter((c) => !c.ok);
  const warnFailed = warn.filter((c) => !c.ok);
  return {
    ok: criticalFailed.length === 0,
    ready: criticalFailed.length === 0 && warnFailed.length === 0, // fully set up + running
    total: checks.length,
    passed: checks.filter((c) => c.ok).length,
    criticalFailed: criticalFailed.map((c) => c.name),
    warnFailed: warnFailed.map((c) => c.name),
    checks,
  };
}
