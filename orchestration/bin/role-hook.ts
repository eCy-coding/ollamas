#!/usr/bin/env tsx
/**
 * orchestration/bin/role-hook.ts — UserPromptSubmit hook wrapper (READ-ONLY).
 *
 * stdin'den hook JSON oku → prompt kimlik/görev sorusuysa → role.ts canlı çıktısını
 * additionalContext olarak enjekte et. Değilse sessiz exit 0 (token israfı yok).
 * Proje-local .claude/settings.json'dan çağrılır (yalnız bu worktree'de yüklenir).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Kimlik/görev sorusu deseni (TR + EN varyantları).
export const ROLE_QUESTION_RE =
  /görev(in|im)?\s*(nedir|ne)|ne\s*yapars[ıi]n|bu\s*(terminal\s*)?sekme.*görev|sekmede\s*görev|rol(ün|un)\s*nedir|what('?s| is| do)\s+(your|you|this)\s+(role|task|do|tab)|what\s+(do|can)\s+you\s+do|who\s+are\s+you|what('?s| is)\s+this\s+(tab|session)/i;

export function isRoleQuestion(prompt: string): boolean {
  return ROLE_QUESTION_RE.test(prompt || "");
}

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function main(): void {
  const raw = readStdin();
  let prompt = "";
  try { prompt = JSON.parse(raw).prompt || ""; } catch { prompt = raw; }

  if (!isRoleQuestion(prompt)) process.exit(0); // alakasız → sessiz, enjeksiyon yok

  // role.ts'i tsx ile koş (.ts node ile doğrudan çalışmaz). tsx = ana repo node_modules.
  const tsx = join(HERE, "..", "..", "..", "ollamas", "node_modules", ".bin", "tsx");
  let ctx = "";
  try {
    ctx = execFileSync(tsx, [join(HERE, "role.ts")], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000,
    });
  } catch { process.exit(0); } // role.ts patlarsa sessiz degrade — prompt'u engelleme

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ctx.trim(),
    },
  }));
  process.exit(0);
}

if (process.argv[1] && /role-hook\.ts$/.test(process.argv[1])) main();
