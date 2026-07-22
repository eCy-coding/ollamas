import { execFile } from "child_process";
import { db } from "./db";
import { GatewayClient, buildDoctorReport } from "../cli/lib/client";
import { loadConfig } from "../cli/lib/config";
import { resolveOutputCtx, formatDoctor } from "../cli/lib/output";
import { buildSnapshot, renderDashboard } from "../cli/commands/top";

// Allowed structural commands
export const ALLOWED_BINARIES = [
  "git", "pytest", "python", "python3", "pip", "pip3", "ls", "pwd", "echo",
  "cat", "head", "tail", "wc", "grep", "find", "which", "node", "npm",
  "npx", "tsc", "ruff", "black", "mkdir", "date", "whoami", "uname",
  // expanded safe text/dev utilities (read/transform only; blocklist still applies)
  "sed", "awk", "sort", "uniq", "cut", "tr", "diff", "env", "make",
  "realpath", "basename", "dirname", "test", "jq", "vitest", "printf", "sleep", "true", "false",
  // L37: read-only DIAGNOSTICS. eCym's machine role answers "how is this machine doing?" from a
  // 220-command catalog, and none of it could run — `df -h` was refused with exit 126, so the
  // member existed on paper only. Every binary here inspects and reports; none writes, deletes,
  // installs, or opens a network connection. The denylist still applies on top, and gated
  // catalog entries still require approval, so this widens WHAT can be observed, not what can
  // be changed.
  "df", "du", "ps", "top", "uptime", "lsof", "netstat", "vm_stat",
  "sw_vers", "id", "hostname", "stat", "file", "sysctl"
];

/** Does the shell allowlist permit this command's binary?
 *  Exported so a CALLER can find out BEFORE running — eCym's 220-command catalog is far wider
 *  than this ~40-binary developer panel, and discovering the mismatch via a 126 exit code
 *  produces a misleading "the command ran" record. */
export function isAllowedBinary(command: string): boolean {
  const first = String(command ?? "").trim().split(/\s+/)[0] ?? "";
  return ALLOWED_BINARIES.includes(first);
}

/**
 * Will this command survive execute()'s structural checks at all?
 *
 * The allowlist is only half of it: execute() also refuses every shell operator, so a catalog
 * entry like `ps -A -o pid,%cpu,comm -r | head -n 11` passes the binary check and is then
 * rejected for the pipe. Measured — the orchestra's first real follow-up chose exactly that
 * command and earned a 126. A caller that can ask BEFORE running should not have to reproduce
 * both rules to find out.
 */
export function isShellRunnable(command: string): boolean {
  const c = String(command ?? "").trim();
  if (!c || !isAllowedBinary(c)) return false;
  return !BLOCKED_METACHARACTERS.some((ch) => c.includes(ch))
    && !BLOCKED_TOKENS.some((t) => c.split(/\s+/).includes(t));
}


// Structural dangerous tokens or shell bindings
const BLOCKED_METACHARACTERS = [";", "&", "|", "`", "$", ">", "<"];
const BLOCKED_TOKENS = ["rm", "sudo", "mv", "dd", "kill", "chmod", "chown", "curl", "wget"];

// `ollamas <sub>` is a pseudo-binary: on the host it's a shell ALIAS (not a PATH executable),
// so execFile can never resolve it directly regardless of allowlist membership — it must be
// special-cased before the raw-binary allowlist check. Only these read-mostly introspection
// subcommands are wired; `ollamas do/up/conductor/...` (autonomous task dispatch, fleet boot)
// stay out of the sandbox on purpose — those are not "run a diagnostic", they're "start work".
const OLLAMAS_SUBCOMMANDS = ["doctor", "top", "ecysearcher"] as const;
const ECYSEARCHER_ACTIONS = ["up", "down", "status", "health"];
const ECYSEARCHER_FLAGS = ["--json", "--dry"];

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TerminalManager {
  /**
   * Run command with strict structural security checks
   */
  public static async execute(
    isLive: boolean,
    workspaceRoot: string,
    rawCommand: string
  ): Promise<ExecResult> {
    const trimmed = rawCommand.trim();
    if (!trimmed) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (!isLive) {
      // Simulate typical commands beautiful and clean
      return this.simulateDemoCommand(trimmed);
    }

    // 1. Check server-level toggle
    if (!db.data.permissions.commandExec) {
      db.logSecurity(
        "command_exec",
        trimmed,
        "Command refused: local console execution is globally deactivated in settings.",
        "deny"
      );
      return {
        stdout: "",
        stderr: "Security block: Terminal execution is deactivated in security panels.",
        exitCode: 126,
      };
    }

    // 2. Scan for shell metacharacters
    for (const char of BLOCKED_METACHARACTERS) {
      if (trimmed.includes(char)) {
        db.logSecurity(
          "command_exec",
          trimmed,
          `Command refused: contains forbidden metacharacter '${char}'.`,
          "deny"
        );
        return {
          stdout: "",
          stderr: `Security block: Forbidden shell character '${char}' detected. Execution flagged and refused.`,
          exitCode: 126,
        };
      }
    }

    // 3. Scan for blocked security tokens in individual parts
    const words = trimmed.split(/\s+/);
    const firstWord = words[0];

    for (const tok of BLOCKED_TOKENS) {
      if (words.includes(tok)) {
        db.logSecurity(
          "command_exec",
          trimmed,
          `Command refused: contains restricted binary/operation '${tok}'.`,
          "deny"
        );
        return {
          stdout: "",
          stderr: `Security block: Restricted system operation '${tok}' detected. Command canceled.`,
          exitCode: 126,
        };
      }
    }

    // 3.5. `ollamas <sub>` pseudo-binary — dispatched before the raw allowlist check below,
    // since "ollamas" is a shell alias on the host and would otherwise 126 as an unknown binary.
    if (firstWord === "ollamas") {
      return this.executeOllamas(words.slice(1));
    }

    // 4. Validate first binary token against strict allowlist
    if (!ALLOWED_BINARIES.includes(firstWord)) {
      db.logSecurity(
        "command_exec",
        trimmed,
        `Command refused: binary '${firstWord}' is not in the allowed console suite.`,
        "deny"
      );
      return {
        stdout: "",
        stderr: `Security block: Command '${firstWord}' is outside the permissible developer panel tools.\nAllowed toolsuite: ${ALLOWED_BINARIES.join(", ")}`,
        exitCode: 126,
      };
    }

    // 5. Run command in child_process
    db.logSecurity(
      "command_exec",
      trimmed,
      `Executing command in safe cwd: ${workspaceRoot}`,
      "allow"
    );

    // Tokenize on whitespace and run WITHOUT a shell. Because BLOCKED_METACHARACTERS
    // already forbids every shell operator (; & | ` $ > <), a permitted command is a
    // plain `binary arg arg` form — no quoting/expansion is needed. execFile passes
    // these tokens straight to execve as an argv array, so quote-breakout and
    // argument/command injection (e.g. a tool that interpolates user text into the
    // command string) are structurally impossible, not merely blocklisted.
    const [binary, ...commandArgs] = words;

    return new Promise((resolve) => {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      // Justified: execFile (no shell) + strict binary allowlist + shell-metachar block
      // + permission gate + audit log above; argv array, not raw user shell.
      execFile(
        binary,
        commandArgs,
        {
          cwd: workspaceRoot || process.cwd(),
          timeout: 45000, // Safe 45s hard timeout for local test suites
          shell: false,
        },
        (error, stdout, stderr) => {
          const exitCode = error ? ((error as NodeJS.ErrnoException & { code?: number }).code as number || 1) : 0;
          resolve({
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode,
          });
        }
      );
    });
  }

  /**
   * `ollamas <sub>` pseudo-binary dispatch. Same audit/permission posture as execute() (caller
   * already checked db.data.permissions.commandExec before reaching here) but each subcommand is
   * its own hand-picked allowlist rather than a raw-binary check, because "ollamas" resolves to a
   * host shell alias — there is no PATH executable to execFile in the first place.
   *
   * doctor/top run the SAME pure report builders the real `ollamas doctor`/`ollamas top --json`
   * CLI commands use (cli/lib/client.ts, cli/commands/top.ts) — in-process, not spawned — so
   * there's no second cold `tsx` start per click and no risk of `top --watch`'s alt-screen loop
   * ever touching this (server) process's real stdout/TTY.
   */
  private static async executeOllamas(args: string[]): Promise<ExecResult> {
    const [sub, ...rest] = args;
    const display = `ollamas ${args.join(" ")}`.trim();

    if (!sub || !(OLLAMAS_SUBCOMMANDS as readonly string[]).includes(sub)) {
      const msg = `'ollamas ${sub ?? ""}' is not an allowed subcommand.`;
      db.logSecurity("command_exec", display, `Command refused: ${msg}`, "deny");
      return {
        stdout: "",
        stderr: `Security block: ${msg}\nAllowed: ollamas doctor [--json], ollamas top [--json], ollamas ecysearcher <${ECYSEARCHER_ACTIONS.join("|")}> [--dry] [--json]`,
        exitCode: 126,
      };
    }

    if (sub === "doctor" || sub === "top") {
      const json = rest.includes("--json");
      const unknown = rest.filter((a) => a !== "--json");
      if (unknown.length) {
        const msg = `'ollamas ${sub}' does not accept '${unknown.join(" ")}' here (snapshot-only; --watch/--interval are not supported through the sandbox).`;
        db.logSecurity("command_exec", display, `Command refused: ${msg}`, "deny");
        return { stdout: "", stderr: `Security block: ${msg}`, exitCode: 126 };
      }

      db.logSecurity("command_exec", display, "Executing ollamas subcommand in-process (no subprocess)", "allow");
      try {
        const cfg = loadConfig();
        if (sub === "doctor") {
          const client = new GatewayClient(cfg.gateway, cfg.apiKey, cfg.saasAdminToken);
          const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
          const report = await buildDoctorReport(client, ollamaHost, new Date().toISOString());
          const ctx = resolveOutputCtx(process.env, false, json);
          const stdout = json ? JSON.stringify(report, null, 2) : formatDoctor(report, ctx);
          return { stdout, stderr: "", exitCode: report.healthy ? 0 : 1 };
        }

        // sub === "top" — snapshot only, no --watch: a single /metrics read + render.
        const client = new GatewayClient(cfg.gateway, cfg.apiKey);
        const metricsText = await client.getMetrics();
        let usageSeries: { day: string; calls: number; tokens: number }[] | undefined;
        let usageError: string | undefined;
        try {
          usageSeries = (await client.getUsageTimeseries()).series;
        } catch (e: any) {
          usageError = String(e?.message || e);
        }
        let sessions;
        try {
          sessions = await client.listSessions();
        } catch {
          /* omit the sessions pane — best-effort like the real CLI */
        }
        const snap = buildSnapshot(metricsText, {
          gateway: cfg.gateway,
          ts: new Date().toISOString(),
          usageSeries,
          usageError,
          sessions,
        });
        const ctx = resolveOutputCtx(process.env, false, json);
        const stdout = json ? JSON.stringify(snap, null, 2) : renderDashboard(snap, ctx, 100);
        return { stdout, stderr: "", exitCode: 0 };
      } catch (e: any) {
        return { stdout: "", stderr: `ollamas ${sub} failed: ${e?.message || e}`, exitCode: 1 };
      }
    }

    // sub === "ecysearcher" — the one pseudo-subcommand that is a real subprocess: it drives
    // `docker compose` for the eCySearcher subsystem, scoped to its own compose project and
    // never touching the main :3000 stack (scripts/ecysearcher-lane.mjs). `up`/`down` mutate
    // container state, but the action itself is a fixed word, not user-composed shell text.
    const action = rest[0];
    if (!ECYSEARCHER_ACTIONS.includes(action)) {
      const msg = `'ollamas ecysearcher ${action ?? ""}' unknown. Allowed actions: ${ECYSEARCHER_ACTIONS.join(", ")}.`;
      db.logSecurity("command_exec", display, `Command refused: ${msg}`, "deny");
      return { stdout: "", stderr: `Security block: ${msg}`, exitCode: 126 };
    }
    const flags = rest.slice(1);
    const badFlag = flags.find((f) => !ECYSEARCHER_FLAGS.includes(f));
    if (badFlag) {
      const msg = `unsupported flag '${badFlag}' for 'ollamas ecysearcher'. Allowed: ${ECYSEARCHER_FLAGS.join(", ")}.`;
      db.logSecurity("command_exec", display, `Command refused: ${msg}`, "deny");
      return { stdout: "", stderr: `Security block: ${msg}`, exitCode: 126 };
    }

    db.logSecurity("command_exec", display, "Executing ecysearcher-lane.mjs (docker compose lane, scoped subsystem)", "allow");
    return new Promise((resolve) => {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      // Justified: execFile (no shell), action is a fixed allowlisted word (not interpolated
      // user text), flags are allowlisted individually; same posture as execute() above.
      execFile(
        process.execPath,
        ["scripts/ecysearcher-lane.mjs", action, ...flags],
        {
          cwd: process.cwd(), // the ollamas repo root — scripts/ is relative to it, not the sandbox workspaceRoot
          timeout: 120000, // `up --build` can exceed the 45s used for the plain sandbox — this is a known-slow, known-safe lane
          shell: false,
        },
        (error, stdout, stderr) => {
          // execFile's error.code can be a numeric exit code OR an errno string (e.g. "ENOENT")
          // depending on failure kind — Number(...) collapses both cases correctly instead of a
          // compile-time-only `as number` cast that would leave a string masquerading as number.
          const exitCode = error ? Number((error as NodeJS.ErrnoException).code) || 1 : 0;
          resolve({ stdout: stdout || "", stderr: stderr || "", exitCode });
        }
      );
    });
  }

  /**
   * Run an allowlisted binary with a PRE-SPLIT argv (no shell, no whitespace tokenization).
   * For tools that must pass a single argument containing spaces or regex metachars (e.g.
   * grep_search's query) — execute()'s split(/\s+/) + metachar-block would corrupt or reject
   * those (a quoted `"a b"` became literal argv tokens incl. the quotes). Same gates as
   * execute(): commandExec permission + binary allowlist + audit; execFile (shell:false) makes
   * quote-breakout / injection structurally impossible, so the metachar blocklist isn't needed.
   */
  public static async executeArgv(
    isLive: boolean,
    workspaceRoot: string,
    binary: string,
    args: string[]
  ): Promise<ExecResult> {
    const display = `${binary} ${args.join(" ")}`;
    if (!isLive) return this.simulateDemoCommand(display);

    if (!db.data.permissions.commandExec) {
      db.logSecurity("command_exec", display, "Command refused: local console execution is globally deactivated in settings.", "deny");
      return { stdout: "", stderr: "Security block: Terminal execution is deactivated in security panels.", exitCode: 126 };
    }
    if (!ALLOWED_BINARIES.includes(binary)) {
      db.logSecurity("command_exec", display, `Command refused: binary '${binary}' is not in the allowed console suite.`, "deny");
      return { stdout: "", stderr: `Security block: Command '${binary}' is outside the permissible developer panel tools.\nAllowed toolsuite: ${ALLOWED_BINARIES.join(", ")}`, exitCode: 126 };
    }
    db.logSecurity("command_exec", display, `Executing (argv) in safe cwd: ${workspaceRoot}`, "allow");

    return new Promise((resolve) => {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      // Justified: execFile (no shell) + strict binary allowlist + permission gate + audit;
      // argv array straight to execve — not a shell string, so injection is impossible.
      execFile(
        binary,
        args,
        { cwd: workspaceRoot || process.cwd(), timeout: 45000, shell: false },
        (error, stdout, stderr) => {
          const exitCode = error ? ((error as NodeJS.ErrnoException & { code?: number }).code as number || 1) : 0;
          resolve({ stdout: stdout || "", stderr: stderr || "", exitCode });
        }
      );
    });
  }

  /**
   * Dummy high-fidelity shell response for cloud run demo targets
   */
  private static simulateDemoCommand(command: string): ExecResult {
    const parts = command.split(/\s+/);
    const cmd = parts[0];

    // Check allowlist in demo too to show consistent security
    if (!ALLOWED_BINARIES.includes(cmd)) {
      return {
        stdout: "",
        stderr: `[DEMO MODEL SECURITY CHECK] Command '${cmd}' is outside permissible boundaries.`,
        exitCode: 126,
      };
    }

    if (command === "git status") {
      return {
        stdout: `On branch main\nYour branch is up to date with 'origin/main'.\n\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n\tmodified:   tests/test_basic.py\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\trequirements.txt\n\nno changes added to commit (use "git add" and/or "git commit -a")`,
        stderr: "",
        exitCode: 0,
      };
    }

    if (command.startsWith("pytest") || command.startsWith("python -m pytest")) {
      return {
        stdout: `============================= test session starts =============================\nplatform linux -- Python 3.10.12, pytest-7.1.3\nrootdir: /demo/workspace\ncollected 1 item\n\ntests/test_basic.py .                                                    [100%]\n\n============================== 1 passed in 0.08s ==============================`,
        stderr: "",
        exitCode: 0,
      };
    }

    if (command === "pwd") {
      return {
        stdout: `/demo/workspace`,
        stderr: "",
        exitCode: 0,
      };
    }

    if (command.startsWith("ls")) {
      return {
        stdout: `total 16\ndrwxr-xr-x 2 root root 4096 Jun 12 08:53 tests\n-rw-r--r-- 1 root root  112 Jun 12 08:53 index.py\n-rw-r--r-- 1 root root  245 Jun 12 08:53 README.md\n-rw-r--r-- 1 root root   32 Jun 12 08:53 requirements.txt`,
        stderr: "",
        exitCode: 0,
      };
    }

    // Default simulation response
    return {
      stdout: `[DEMO Mode - Simulated shell output] Successful execution of: "${command}"\n(No actual operation took place on sandbox container host)`,
      stderr: "",
      exitCode: 0,
    };
  }
}
