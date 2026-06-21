// Self-healing core (scripts lane, v7) — PURE, no exec/fs/network. Maps a health
// snapshot to an ordered, idempotent remediation plan, plus a zero-dep backoff
// re-check. The executor (tools/self_heal.mjs) runs the plan; keeping the logic
// pure makes every failure→action decision unit-testable without killing anything.
//
// Adopts the sindresorhus/p-retry (MIT) backoff shape (inline, zero-dep) and the
// MathieuTurcotte/node-pid (MIT) stale-pid idea (kill -0 → dead → clean).

// health snapshot shape:
//   { bridge:{ok}, app:{ok}, pidFile:{exists,alive}, port7345:{occupied,byNode}, launchdManaged }
// Returns ordered actions: [{ id, reason, cmd, sideEffect }]. healthy -> [].
export function planRemediation(health = {}) {
  const actions = [];
  const pidFile = health.pidFile || {};
  const port = health.port7345 || {};
  const app = health.app || {};

  // Bridge healthy → nothing to repair (idempotent no-op), regardless of noise.
  if (!health.bridge?.ok) {
    // Stale pidfile (process recorded but dead) — clean before restart.
    if (pidFile.exists && pidFile.alive === false) {
      actions.push({ id: "clean_pid", reason: "bridge.pid present but process dead", cmd: "rm -f ~/.llm-mission-control/bridge.pid", sideEffect: true });
    }
    // Port 7345 held by a hung node bridge → safe to kill (node only).
    if (port.occupied && port.byNode) {
      actions.push({ id: "kill_7345_node", reason: "port 7345 held by an unresponsive node process", cmd: "lsof -ti tcp:7345 -sTCP:LISTEN | (node only) | xargs kill -TERM", sideEffect: true });
    }
    // Port held by a NON-node process → never kill; escalate instead.
    if (port.occupied && port.byNode === false) {
      actions.push({ id: "port_blocked", reason: "port 7345 held by a non-node process — manual intervention", cmd: "(report only — no kill)", sideEffect: false });
      return actions; // can't safely restart onto an occupied port
    }
    // Bring the bridge back: prefer launchd kickstart when managed, else script.
    actions.push(health.launchdManaged
      ? { id: "plist_kickstart", reason: "reload the LaunchAgent", cmd: "launchctl kickstart -k gui/$(id -u)/com.missioncontrol.terminalbridge", sideEffect: true }
      : { id: "restart_bridge", reason: "(re)start the bridge daemon", cmd: "bin/host-bridge/start-bridge.sh", sideEffect: true });
  }

  // App (docker, out of scripts scope) — report only, never auto-acted.
  if (app.ok === false) {
    actions.push({ id: "app_report", reason: "app (3000) down — docker stack, outside scripts scope", cmd: "(report only — see install.sh / docker compose)", sideEffect: false });
  }
  return actions;
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// p-retry shape (MIT): run fn, retry on throw with exponential backoff. `sleep`
// is injectable so tests run instantly. Returns fn result or throws last error.
export async function retryWithBackoff(fn, opts = {}) {
  const { retries = 5, minTimeout = 1000, factor = 2, maxTimeout = 30000, sleep = sleepReal } = opts;
  let attempt = 0;
  let lastErr;
  // total tries = retries + 1 (initial attempt)
  while (attempt <= retries) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      const delay = Math.min(minTimeout * factor ** attempt, maxTimeout);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}

// Backoff delays a run WOULD use (for logging / tests).
export function backoffDelays({ retries = 5, minTimeout = 1000, factor = 2, maxTimeout = 30000 } = {}) {
  return Array.from({ length: retries }, (_, i) => Math.min(minTimeout * factor ** i, maxTimeout));
}
