// Thin IO around server/e2e-watchdog-policy.ts: read the state file, decide, write it back,
// and print the actions for the shell to execute. Kept separate so the policy itself stays
// pure and testable (see tests/e2e-watchdog-policy.test.ts).
//
// Usage:  tsx scripts/e2e-watchdog-decide.ts <stateFile> [redCheck ...]
// Prints: one action per line — "kick <label> <chk> <n>" or "notify <chk> <n>"
import { readFileSync, writeFileSync } from "node:fs";
import { parseState, serializeState, decide } from "../server/e2e-watchdog-policy";

// Red check -> launchd label that is SAFE to restart. The :3000 hub, ollama and chroma are
// deliberately absent: hard-kicking the hub was the original churn bug, so they are
// notify-only. Keep this in sync with the watchdog's documentation.
const LABELS: Record<string, string> = {
  "odysseus-bridge": "com.odysseus.server",
  "pulse:4777": "com.ody.pulse",
  brain: "com.ollamas.brain-loop",
  "brain-loop-fresh": "com.ollamas.brain-loop",
  obsidian: "com.ollamas.brain-obsidian-sync",
};

const THRESH = Number(process.env.E2E_WATCHDOG_THRESH || 3);
// Must exceed the slowest service's boot. Measured 2026-07-22: odysseus binds :7860 about
// 210s after a restart. 600s leaves headroom on a loaded machine without letting a truly
// dead service sit unhealed for long.
const GRACE_MS = Number(process.env.E2E_WATCHDOG_GRACE_MS || 600_000);

const [stateFile, ...red] = process.argv.slice(2);
if (!stateFile) {
  console.error("usage: e2e-watchdog-decide.ts <stateFile> [redCheck ...]");
  process.exit(2);
}

let raw = "{}";
try { raw = readFileSync(stateFile, "utf8"); } catch { /* first run */ }

const { actions, next } = decide({
  prev: parseState(raw),
  red: red.filter(Boolean),
  now: Date.now(),
  thresh: THRESH,
  graceMs: GRACE_MS,
  labelFor: (c) => LABELS[c] ?? "",
});

try { writeFileSync(stateFile, serializeState(next) + "\n"); } catch { /* best-effort */ }

for (const a of actions) {
  if (a.kind === "kick") console.log(`kick ${a.label} ${a.chk} ${a.n}`);
  else console.log(`notify ${a.chk} ${a.n}`);
}
