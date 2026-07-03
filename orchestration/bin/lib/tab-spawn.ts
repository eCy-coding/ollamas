/**
 * orchestration/bin/lib/tab-spawn.ts — open a NEW Terminal.app/iTerm2 tab and run a command.
 *
 * Extracted from fleet-launch.ts (vO40) so claude-dispatch.ts can reuse the exact same
 * spawn mechanics. Pure script-builder + injectable runner (signal.ts Runner pattern) →
 * testable without osascript. iTerm2: create a window if none is open (root-fix for
 * silent skip when no window existed). The command itself keeps the tab alive.
 */
import { execFileSync } from "node:child_process";

export type SpawnApp = "Terminal.app" | "iTerm2";
export type SpawnRunner = (file: string, args: string[]) => void;

export const realSpawnRunner: SpawnRunner = (file, args) => {
  // RISK-ORCH-008: osascript can freeze on dialogs → hard timeout, caller handles throw.
  execFileSync(file, args, { timeout: 15000 });
};

/** Pure: AppleScript text that opens a new tab in `app` and runs `cmd`. */
export function buildSpawnScript(app: SpawnApp, cmd: string): string {
  const inner = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return app === "Terminal.app"
    ? `tell application "Terminal"\n  activate\n  do script "${inner}"\nend tell`
    : `tell application "iTerm"\n  activate\n  if (count of windows) = 0 then\n    create window with default profile\n    tell current session of current window to write text "${inner}"\n  else\n    tell current window\n      create tab with default profile\n      tell current session to write text "${inner}"\n    end tell\n  end if\nend tell`;
}

/** AppleScript to open a NEW tab and run a command (behavior identical to fleet-launch's original). */
export function openTab(app: SpawnApp, cmd: string, run: SpawnRunner = realSpawnRunner): void {
  run("osascript", ["-e", buildSpawnScript(app, cmd)]);
}
