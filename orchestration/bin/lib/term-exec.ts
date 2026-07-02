// term-exec (pure) — build/parse the host-bridge /run request that executes a bash command in a REAL,
// visible Terminal.app / iTerm2 window and captures its output + exit code. IO-free → unit-tested.
//
// The capability itself already lives in the host bridge (bin/host-bridge/terminal-bridge.mjs /run):
// osascript drives the terminal, a script file + watchdog run the command, output + exit are read back.
// This module is the pure request/response + capability-verdict layer so the orchestration CLI can give
// the operator a first-class "run this in a visible terminal" entry with an honest capability check.
//
// Auth is the bridge's own token (x-bridge-token header, from ~/.llm-mission-control/bridge.token); the
// bridge binds loopback only. This is the operator running commands on their OWN Mac — the exact purpose
// of the privileged macos_terminal capability — not a new attack surface.

export type TermTarget = "iterm2" | "terminal";

export interface BridgeRequest {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
}

/** Build the POST /run request: run `command` in `target` (visible terminal), capped at `timeoutMs`. */
export function buildRunRequest(base: string, token: string, command: string, target: TermTarget = "iterm2", timeoutMs = 60000): BridgeRequest {
  const b = base.replace(/\/+$/, "");
  return {
    url: `${b}/run`,
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-token": token },
    body: JSON.stringify({ command, target, timeoutMs }),
  };
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
  automationBlocked: boolean; // osascript -1743 = TCC Automation permission missing
  hint: string;
  error: string;
}

/** osascript error -1743 (or a bridge hint) = macOS Automation permission not granted for the terminal. */
export function isAutomationBlocked(text: string): boolean {
  return /-1743|not authori[sz]ed|Automation/i.test(text);
}

/** Parse the /run (or an error) response body into a normalized result. */
export function parseRunResult(text: string): RunResult {
  let j: any;
  try { j = JSON.parse(text); } catch {
    return { ok: false, exitCode: null, output: "", timedOut: false, durationMs: 0, automationBlocked: isAutomationBlocked(text), hint: "", error: `unparseable: ${text.slice(0, 80)}` };
  }
  const err = j.ok === false ? String(j.error ?? "") : "";
  return {
    ok: j.ok === true,
    exitCode: typeof j.exitCode === "number" ? j.exitCode : null,
    output: typeof j.output === "string" ? j.output : "",
    timedOut: j.timedOut === true,
    durationMs: typeof j.durationMs === "number" ? j.durationMs : 0,
    automationBlocked: isAutomationBlocked(`${err} ${j.hint ?? ""}`),
    hint: typeof j.hint === "string" ? j.hint : "",
    error: err,
  };
}

export interface Capability {
  granted: boolean;
  iterm2: boolean;
  terminal: boolean;
  ran: boolean;
  exitOk: boolean;
  automationBlocked: boolean;
  detail: string;
}

/** Verdict on the terminal-exec capability: health has a terminal AND the probe ran with exit 0. */
export function classifyCapability(health: any, probe: RunResult | null): Capability {
  const iterm2 = !!(health && health.terminals && health.terminals.iterm2);
  const terminal = !!(health && health.terminals && health.terminals.terminal);
  const ran = !!(probe && probe.ok && !probe.timedOut);
  const exitOk = !!(probe && probe.exitCode === 0);
  const automationBlocked = !!(probe && probe.automationBlocked);
  const granted = (iterm2 || terminal) && ran && exitOk && !automationBlocked;
  const detail = granted
    ? `terminals=${[iterm2 && "iterm2", terminal && "terminal"].filter(Boolean).join("+")} · probe ran, exit 0`
    : automationBlocked
      ? "Automation permission missing (osascript -1743): System Settings → Privacy & Security → Automation → allow the bridge's terminal"
      : !(iterm2 || terminal) ? "no terminal app detected by the bridge"
        : !ran ? "probe did not run (bridge unreachable or timed out)"
          : "probe ran but exit code ≠ 0";
  return { granted, iterm2, terminal, ran, exitOk, automationBlocked, detail };
}
