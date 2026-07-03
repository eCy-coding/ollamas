// import-guard (pure) — detect the runtime-import failure class that the tsc+vitest gate CANNOT catch. IO-free.
//
// Why: vO54's batch auto-shipped an mjs edit that added `import "./agent-dispatch.d.ts"` to a `#!/usr/bin/env
// node` entry-point. The gate passed GREEN (tsc treats a `.d.ts` import as a type-only reference; vitest never
// EXECUTES an entry-point .mjs), yet `node agent-dispatch.mjs` crashes with ERR_MODULE_NOT_FOUND. Only the
// conductor's manual review caught it. This module extracts the imports an edit ADDS so the CLI can statically
// resolve them (missing target / .d.ts-at-runtime) and BLOCK the proposal before any auto-ship — safety that
// no longer depends on a human noticing. Pure string analysis; the filesystem resolution lives in the CLI.

/** Every module specifier imported/required in `text`: `import … from "x"`, `import "x"`, `require("x")`,
 *  and dynamic `import("x")`. Single or double quotes. Deterministic — one pass over the text. */
export function importSpecifiers(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  // `import ... from "spec"` and side-effect `import "spec"` (no `from`)
  const re = /\bimport\b[^;\n]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** The specifiers that `after` imports but `before` did not — i.e. the imports this edit ADDS. Duplicates in
 *  `after` collapse; anything already present in `before` is not "added". */
export function addedImportSpecifiers(before: string, after: string): string[] {
  const had = new Set(importSpecifiers(before));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of importSpecifiers(after)) {
    if (had.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** A `.d.ts` specifier imported as a RUNTIME module is always wrong (declaration files carry no runtime code
 *  and Node cannot load them) — detectable with zero filesystem access. */
export function isTypeOnlyRuntimeImport(spec: string): boolean {
  return /\.d\.ts$/.test(spec);
}

/** Relative specifier (`./` or `../`) — resolvable against the importing file's directory (the CLI does the IO).
 *  Bare specifiers (packages) are left to tsc, which type-checks them. */
export function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}
