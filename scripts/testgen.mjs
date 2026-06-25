#!/usr/bin/env node
// testgen — $0 test-generation (the ollama-FIT, verifiable, sustainable product).
//
// Evidence (this session): ollama models are ~100% at code-to-spec but LOW-yield at
// open-ended bug audit. So sell what the $0 model does reliably: generate a unit test,
// RUN it, ship ONLY if it passes (auto-verification = near-100% quality, 0-manual).
//
// Usage: node scripts/testgen.mjs --file <path> --fn <exportName> [--model qwen3:8b]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const A = process.argv.slice(2);
const opt = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const FILE = opt("--file"); const FN = opt("--fn"); const MODEL = opt("--model", "qwen3:8b");
const OLLAMA = process.env.OLLAMA_HOST_LOCAL || "http://127.0.0.1:11434";
if (!FILE || !FN || !fs.existsSync(FILE)) { console.error("usage: --file <path> --fn <export>"); process.exit(2); }

const src = fs.readFileSync(FILE, "utf8");
const importPath = path.resolve(FILE).replace(/\.ts$/, "");
const prompt = [
  `Here is a TypeScript module. Write a vitest test for the exported function \`${FN}\`.`,
  `Import it as: import { ${FN} } from ${JSON.stringify(importPath)};`,
  "Cover normal cases + edge cases (empty, boundary). Use only the function's observable behavior.",
  "Output ONLY the test file code in a single \`\`\`ts code block — no prose.",
  "", "MODULE:", "```ts", src.slice(0, 8000), "```",
].join("\n");

console.error(`testgen: ${FN} from ${path.basename(FILE)} via ${MODEL} ($0 local)`);
const res = await fetch(`${OLLAMA}/api/chat`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: "user", content: prompt }], options: { temperature: 0.2 } }),
});
if (!res.ok) { console.error(`ollama HTTP ${res.status}`); process.exit(1); }
const j = await res.json();
const reply = j.message?.content || "";
const m = reply.match(/```(?:ts|typescript|js)?\s*([\s\S]*?)```/);
let code = m ? m[1].trim() : reply.trim();
if (!code.includes(FN)) { console.error("model did not produce usable test"); process.exit(1); }
// deterministic post-process: ensure the vitest import (models often omit it) — harness
// guarantees the scaffold, model supplies the test logic.
if (!/from\s+['"]vitest['"]/.test(code)) code = `import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";\n${code}`;

// write INSIDE the vitest include glob (tests/**/*.test.ts) — a file outside it is "not found"
const outDir = path.resolve("tests");
fs.mkdirSync(outDir, { recursive: true });
const testFile = path.join(outDir, `_testgen-${FN}.test.ts`);
const rel = path.relative(process.cwd(), testFile);
fs.writeFileSync(testFile, code);
console.error(`generated → ${rel}\n--- running vitest (auto-verify) ---`);
try {
  const out = execFileSync("node_modules/.bin/vitest", ["run", rel], { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  const pass = /Tests\s+\d+ passed/.test(out) && !/failed/.test(out);
  console.log(out.split("\n").filter((l) => /Test Files|Tests /.test(l)).join("\n"));
  console.log(pass ? `\n✅ PASS — shippable verified test (qwen3:8b, $0). Deliverable: ${testFile}` : "\n✗ generated test failed — regenerate (not shipped)");
  process.exit(pass ? 0 : 1);
} catch (e) {
  const out = (e.stdout || "") + (e.stderr || "");
  console.log(out.split("\n").filter((l) => /Test Files|Tests |Error|FAIL/.test(l)).slice(0, 8).join("\n"));
  console.log("\n✗ generated test failed/errored — regenerate (auto-verify gate caught it → never ships broken)");
  process.exit(1);
}
