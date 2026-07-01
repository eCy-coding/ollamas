import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const GUARD = join(ROOT, "bin", "require-env.sh");

// Run `require_env <args>` in a fresh bash after sourcing the guard; return {code, stderr}.
function runGuard(args: string, env: Record<string, string> = {}): { code: number; stderr: string } {
  try {
    execFileSync("bash", ["-c", `source "${GUARD}"; require_env ${args}`], {
      encoding: "utf8", env: { ...process.env, ...env },
    });
    return { code: 0, stderr: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, stderr: String(e.stderr ?? "") };
  }
}

describe("require-env.sh — shell env-guard (shell-harden stream)", () => {
  it("passes silently when the var is set", () => {
    const r = runGuard("MY_VAR", { MY_VAR: "x" });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("fails with EX_CONFIG (78) + clear message when the var is unset", () => {
    const r = runGuard("MISSING_VAR"); // not in env
    expect(r.code).toBe(78);
    expect(r.stderr).toContain("required environment variable 'MISSING_VAR' is unset");
  });

  it("lists EVERY missing var, not just the first", () => {
    const r = runGuard("A_UNSET B_UNSET");
    expect(r.code).toBe(78);
    expect(r.stderr).toContain("'A_UNSET'");
    expect(r.stderr).toContain("'B_UNSET'");
  });

  it("empty string counts as unset", () => {
    const r = runGuard("EMPTY", { EMPTY: "" });
    expect(r.code).toBe(78);
  });
});
