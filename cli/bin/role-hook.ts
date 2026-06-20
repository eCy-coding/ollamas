#!/usr/bin/env tsx
/**
 * cli/bin/role-hook.ts — UserPromptSubmit hook for the ollamas CLI tab (READ-ONLY).
 *
 * Reads the hook JSON from stdin → if the prompt is an identity/role question, runs
 * cli/lib/role.ts and injects its live output as `additionalContext`. Otherwise exits
 * 0 silently (zero token waste). Registered by the project-local .claude/settings.json
 * (loads only in this worktree → single-tab scope). Zero-dep (node built-ins only).
 *
 * Pattern adopted verbatim from orchestration/bin/role-hook.ts (in-repo MIT).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // cli/bin

// Identity/role question patterns (TR variants).
export const ROLE_QUESTION_RE =
  /görev(in|im)?\s*(nedir|ne)|ne\s*yapars[ıi]n|bu\s*(terminal\s*)?sekme.*görev|sekmede\s*görev|rol(ün|un)\s*nedir/i;

export function isRoleQuestion(prompt: string): boolean {
  return ROLE_QUESTION_RE.test(prompt || "");
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const raw = readStdin();
  let prompt = "";
  try {
    prompt = JSON.parse(raw).prompt || "";
  } catch {
    prompt = raw;
  }

  if (!isRoleQuestion(prompt)) process.exit(0); // unrelated → silent, no injection

  // role.ts is TS → run via the worktree-local tsx. role.ts lives in cli/lib.
  const tsx = join(HERE, "..", "..", "node_modules", ".bin", "tsx");
  const roleTs = join(HERE, "..", "lib", "role.ts");
  let ctx = "";
  try {
    ctx = execFileSync(tsx, [roleTs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    });
  } catch {
    process.exit(0); // role.ts failure → silent degrade, never block the prompt
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: ctx.trim(),
      },
    }),
  );
  process.exit(0);
}

if (process.argv[1] && /role-hook\.ts$/.test(process.argv[1])) main();
