import { exec } from "child_process";
import { db } from "./db";

// Allowed structural commands
const ALLOWED_BINARIES = [
  "git", "pytest", "python", "python3", "pip", "pip3", "ls", "pwd", "echo",
  "cat", "head", "tail", "wc", "grep", "find", "which", "node", "npm",
  "npx", "tsc", "ruff", "black", "mkdir", "date", "whoami", "uname",
  // expanded safe text/dev utilities (read/transform only; blocklist still applies)
  "sed", "awk", "sort", "uniq", "cut", "tr", "diff", "env", "make",
  "realpath", "basename", "dirname", "test", "jq", "vitest", "printf", "sleep", "true", "false"
];

// Structural dangerous tokens or shell bindings
const BLOCKED_METACHARACTERS = [";", "&", "|", "`", "$", ">", "<"];
const BLOCKED_TOKENS = ["rm", "sudo", "mv", "dd", "kill", "chmod", "chown", "curl", "wget"];

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

    return new Promise((resolve) => {
      exec(
        trimmed,
        {
          cwd: workspaceRoot || process.cwd(),
          timeout: 45000, // Safe 45s hard timeout for local test suites
        },
        (error, stdout, stderr) => {
          const exitCode = error ? (error.code || 1) : 0;
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
