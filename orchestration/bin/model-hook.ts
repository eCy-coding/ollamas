#!/usr/bin/env tsx
/**
 * orchestration/bin/model-hook.ts — UserPromptSubmit hook wrapper (READ-ONLY, vO-AUTO).
 *
 * stdin'den hook JSON oku → prompt model-seçim sorusuysa → MODEL_PROMPT.md (benchmark-kanıtlı
 * optimal model + çalışma prensibi) additionalContext olarak enjekte. 0-manuel-SEÇİM: operatör
 * "hangi model?" sorduğunda elle çalıştırmadan benchmark-kanıtlı cevap gelir. Değilse sessiz exit 0.
 * Proje-local .claude/settings.json'dan çağrılır (role-hook.ts yanında additive 2. hook).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");

// Model-seçim sorusu deseni (TR + EN).
export const MODEL_QUESTION_RE =
  /hangi\s*model|en\s*verimli\s*model|optimal\s*model|model\s*seç|en\s*iyi\s*model|which\s*model|best\s*model|fastest\s*model|tok\/?s/i;

export function isModelQuestion(prompt: string): boolean {
  return MODEL_QUESTION_RE.test(prompt || "");
}

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** MODEL_PROMPT.md'yi oku; yoksa benchprompt.ts'i koş (never-throw). */
function modelPrompt(): string {
  const f = join(ORCH_DIR, "MODEL_PROMPT.md");
  if (existsSync(f)) { try { return readFileSync(f, "utf8"); } catch { /* devam */ } }
  const tsx = join(HERE, "..", "..", "..", "ollamas", "node_modules", ".bin", "tsx");
  try {
    return execFileSync(tsx, [join(HERE, "benchprompt.ts")], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000,
    });
  } catch { return ""; }
}

function main(): void {
  const raw = readStdin();
  let prompt = "";
  try { prompt = JSON.parse(raw).prompt || ""; } catch { prompt = raw; }

  if (!isModelQuestion(prompt)) process.exit(0); // alakasız → sessiz

  const ctx = modelPrompt().trim();
  if (!ctx) process.exit(0); // veri yok → sessiz degrade

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ctx,
    },
  }));
  process.exit(0);
}

if (process.argv[1] && /model-hook\.ts$/.test(process.argv[1])) main();
