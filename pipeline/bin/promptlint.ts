#!/usr/bin/env -S npx tsx
// promptlint (bin) — run the fiction check on the project's prompts. A prompt that names a repo or
// home path that does not exist fails the gate. This is the automated form of the rule that the
// original eCym.md draft violated (gpt-4o/orchestrator.py/Redis/k6 named but absent).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractRefs, lintPrompt, isGrounded, renderLint, type PromptRef } from "../lib/promptlint";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");

/** A path/home ref is real if it resolves on disk (repo-relative for paths, ~ for home). */
function isReal(ref: PromptRef): boolean {
  if (ref.kind === "home") return existsSync(ref.value.replace(/^~/, HOME));
  if (ref.kind === "path") return existsSync(join(REPO, ref.value));
  return true;
}

const PROMPTS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = PROMPTS.length ? PROMPTS : [join(HOME, "Desktop", "eCym.md"), join(HOME, "Desktop", "eCym2.md")];

let bad = 0;
for (const f of files) {
  const name = f.replace(HOME, "~");
  if (!existsSync(f)) { console.log(`${name}: DOSYA YOK`); bad++; continue; }
  const issues = lintPrompt(readFileSync(f, "utf8"), isReal);
  for (const l of renderLint(name, issues)) console.log(l);
  if (!isGrounded(issues)) bad++;
}
console.log(bad === 0 ? "promptlint: PASS — prompt'lar gerçek yola bağlı" : `promptlint: FAIL — ${bad} prompt fiction içeriyor`);
process.exit(bad === 0 ? 0 : 1);
