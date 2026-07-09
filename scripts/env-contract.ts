// µ3 (v1.25.5 hygiene) — env-contract: grep `process.env.X` across server (server.ts +
// server/**), cli/** and scripts/*.ts, then reconcile against `.env.example` to print a
// contract table. Undocumented env usage is surfaced so `.env.example` stays the single
// source of truth for configuration.
//
// The repo currently uses far more env vars than `.env.example` documents, so the DEFAULT
// mode prints the full table and exits 0 (report mode — the accept path). `--strict` exits 1
// when a non-runtime env var is read but not documented (wire into a tightening gate later).
//
// Pure logic (parse/scan/reconcile) is exported for unit tests; I/O + exit live in main().
// Run: npx tsx scripts/env-contract.ts        (report, exit 0)
//      npx tsx scripts/env-contract.ts --strict  (exit 1 if undocumented non-runtime vars)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Ambient runtime/platform vars that are legitimately read without being part of the
// app's `.env.example` config contract (set by the OS, CI, Node, or the shell).
export const SAFE_RUNTIME_ENV: ReadonlySet<string> = new Set([
  'NODE_ENV', 'CI', 'PATH', 'HOME', 'PWD', 'TMPDIR', 'TERM', 'SHELL', 'USER',
  'PERF', 'DEBUG', 'FORCE_COLOR', 'NO_COLOR', 'npm_config_user_agent',
  'npm_package_version', 'npm_lifecycle_event', 'GITHUB_ACTIONS', 'RUNNER_OS',
]);

// Keys documented in .env.example (LHS of `KEY=` lines, ignoring comments/blanks).
export function parseEnvExample(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)\s*=/.exec(t);
    if (m) keys.add(m[1]);
  }
  return keys;
}

export interface EnvUsage {
  key: string;
  files: string[]; // relative file paths where read
}

// Find `process.env.X` and `process.env["X"]` reads in the given sources.
export function scanEnvUsage(files: { path: string; text: string }[]): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  const re = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g;
  for (const { path, text } of files) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const key = m[1] ?? m[2];
      if (!key) continue;
      if (!usage.has(key)) usage.set(key, new Set());
      usage.get(key)!.add(path);
    }
  }
  return usage;
}

export type EnvStatus = 'documented' | 'runtime' | 'UNDOCUMENTED';

export interface EnvRow {
  key: string;
  status: EnvStatus;
  files: string[];
}

export function reconcile(
  documented: Set<string>,
  usage: Map<string, Set<string>>,
  safe: ReadonlySet<string> = SAFE_RUNTIME_ENV,
): EnvRow[] {
  const rows: EnvRow[] = [];
  for (const [key, fileSet] of usage) {
    const status: EnvStatus = documented.has(key)
      ? 'documented'
      : safe.has(key)
        ? 'runtime'
        : 'UNDOCUMENTED';
    rows.push({ key, status, files: [...fileSet].sort() });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export function undocumented(rows: EnvRow[]): EnvRow[] {
  return rows.filter((r) => r.status === 'UNDOCUMENTED');
}

// ---- I/O layer ----

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const full = join(dir, e);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, exts, acc);
    else if (exts.some((x) => e.endsWith(x))) acc.push(full);
  }
  return acc;
}

function loadFiles(paths: string[]): { path: string; text: string }[] {
  return paths.map((p) => {
    let text = '';
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      /* unreadable → empty */
    }
    return { path: relative(ROOT, p), text };
  });
}

export function main(argv: string[]): number {
  const strict = argv.includes('--strict');

  const envExamplePath = join(ROOT, '.env.example');
  const hasExample = existsSync(envExamplePath);
  const documented = hasExample ? parseEnvExample(readFileSync(envExamplePath, 'utf8')) : new Set<string>();

  const sourcePaths = [
    join(ROOT, 'server.ts'),
    ...walk(join(ROOT, 'server'), ['.ts']),
    ...walk(join(ROOT, 'cli'), ['.ts', '.tsx', '.mjs']),
    ...walk(join(ROOT, 'scripts'), ['.ts']),
  ].filter((p) => existsSync(p));

  const usage = scanEnvUsage(loadFiles(sourcePaths));
  const rows = reconcile(documented, usage);
  const undoc = undocumented(rows);
  const counts = {
    documented: rows.filter((r) => r.status === 'documented').length,
    runtime: rows.filter((r) => r.status === 'runtime').length,
    undocumented: undoc.length,
  };

  console.log('env-contract (v1.25.5 hygiene)');
  if (!hasExample) {
    console.log('  ⚠ .env.example NOT FOUND — reporting all usage as undocumented (report mode).');
  }
  console.log(`  .env.example keys : ${documented.size}`);
  console.log(`  env reads scanned : ${rows.length} distinct vars across server/**, cli/**, scripts/*.ts`);
  console.log(`  documented ${counts.documented} · runtime ${counts.runtime} · UNDOCUMENTED ${counts.undocumented}\n`);

  const label: Record<EnvStatus, string> = { documented: 'ok  ', runtime: 'rt  ', UNDOCUMENTED: 'MISS' };
  for (const r of rows) {
    const where = r.files.length <= 2 ? r.files.join(', ') : `${r.files.slice(0, 2).join(', ')} +${r.files.length - 2}`;
    console.log(`  [${label[r.status]}] ${r.key.padEnd(30)} ${where}`);
  }

  if (undoc.length) {
    console.log(`\n  ${undoc.length} undocumented env var(s) — add to .env.example (or SAFE_RUNTIME_ENV if ambient):`);
    console.log(`    ${undoc.map((r) => r.key).join(', ')}`);
  }

  if (strict && undoc.length) {
    console.error('\nenv-contract: FAIL (--strict) — undocumented non-runtime env usage.');
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
