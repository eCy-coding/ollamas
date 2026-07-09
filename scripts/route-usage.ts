// µ1 (v1.25.5 hygiene) — route-usage: cross-check server route registrations
// against real callers (frontend src/**, cli/**, src/lib/apiClient.ts) and print
// a dead-route table. Bound to the ACTUAL repo shape:
//   • server routes  → server.ts  `app.get/post/put/delete/patch("/api/…")`
//                       + `app.use("/prefix", …)` router mounts
//   • callers        → any `/api/…` string literal in src/** and cli/**
//                       (components pass endpoints into src/lib/apiClient.ts's api.get/post/…)
//
// Pure logic (parse/normalize/diff) is exported for unit tests; the file I/O and
// process.exit live only in main(). A route being DEAD here means "no caller
// references it" — NOT dead code by itself (privileged/entrypoint routes are
// allowlisted so live-but-server-driven paths like /api/macos-terminal never flag).
//
// Run: npx tsx scripts/route-usage.ts   (exit 0; --strict → exit 1 if unexpected dead routes)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'USE';

export interface ServerRoute {
  method: Method;
  raw: string; // path as written (may be a constant name if unresolved)
  path: string; // resolved literal path or the raw token
  normalized: string; // dynamic segments → '*'
  isMount: boolean; // app.use("/prefix", …) → prefix match semantics
}

// Routes that are legitimately server-driven / infra and must NEVER be flagged
// dead just because no browser/CLI caller string references them: privileged host
// bridges, webhooks (called by 3rd parties), metrics/observability scrapers,
// OAuth/well-known discovery, and the SPA catch-all.
export const PRIVILEGED_ALLOWLIST: readonly string[] = [
  '/api/macos-terminal', // privileged host bridge (invoked via Shortcuts/host, not fetch)
  '/api/terminal',
  '/metrics',
  '/token',
  '/api/github/webhook', // inbound 3rd-party webhook
  '/api/billing/webhook',
  '/api/ingest/stage-events',
  '/*', // SPA catch-all (app.get("*"))
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/mcp',
  '/register',
];

// Best-effort resolution of route path CONSTANTS used in server.ts
// (e.g. app.get(PROTECTED_RESOURCE_PATH, …)). We scan the server/mcp/*.ts
// sources for `export const NAME = "…"`.
export function buildConstantMap(sources: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*["'`]([^"'`]+)["'`]/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) map[m[1]] = m[2];
  }
  return map;
}

// Collapse dynamic segments to '*' so a server ":param" and a caller "${id}"
// or concrete value compare equal. Also strips query/hash and trailing junk that
// leaks out of template-literal grabs (`${`, backtick, `<`, trailing dot).
export function normalizePath(p: string): string {
  let s = p.trim();
  s = s.replace(/\$\{[^}]*\}/g, '*'); // complete `${expr}` segment → *
  // cut any REMAINING unclosed template/expression/markup boundary (`${period`, backtick, `<code>`)
  const cut = s.search(/[`$<]/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/[?#].*$/, ''); // query/hash
  s = s.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '*'); // :param → *
  s = s.replace(/\/+$/, ''); // trailing slash
  s = s.replace(/[.,;)'"]+$/, ''); // trailing punctuation from prose/code
  s = s.replace(/(\/\*)+$/, ''); // trailing dynamic-only tail (prefix already covers it)
  return s || '/';
}

export function parseServerRoutes(source: string, constants: Record<string, string>): ServerRoute[] {
  const out: ServerRoute[] = [];
  // app.get("/x", …) | app.use("/x", …) | app.use(CONST, …)
  const re = /app\.(get|post|put|delete|patch|use)\(\s*(["'`]([^"'`]+)["'`]|([A-Z][A-Z0-9_]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const verb = m[1].toUpperCase() as Method;
    const literal = m[3];
    const constName = m[4];
    let path = literal ?? (constName ? constants[constName] : undefined);
    if (!path) {
      // unresolved constant — keep the token so the report is honest, but it
      // won't participate in dead-detection (skipped below).
      path = constName ?? '';
    }
    // app.use with json/raw/middleware only (no path) is filtered: those match
    // the identifier branch with no leading slash and no resolved const.
    if (!path.startsWith('/')) continue;
    // ignore non-/api infra mounts that aren't routes we report on, EXCEPT
    // well-known/token/register which the allowlist recognizes.
    out.push({
      method: verb,
      raw: literal ?? constName ?? path,
      path,
      normalized: normalizePath(path),
      isMount: verb === 'USE',
    });
  }
  return out;
}

export function parseCallerEndpoints(sources: string[]): Set<string> {
  const set = new Set<string>();
  const re = /\/api\/[a-zA-Z0-9/_:.${}<>*-]+/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) set.add(normalizePath(m[0]));
  }
  return set;
}

export interface RouteReport {
  method: Method;
  path: string;
  normalized: string;
  isMount: boolean;
  used: boolean;
  allowlisted: boolean;
}

export function computeRouteReports(
  routes: ServerRoute[],
  callers: Set<string>,
): RouteReport[] {
  const callerArr = [...callers];
  return routes.map((r) => {
    const allowlisted = PRIVILEGED_ALLOWLIST.includes(r.path) || PRIVILEGED_ALLOWLIST.includes(r.normalized);
    let used = false;
    if (r.isMount) {
      // a mount is "used" if any caller path is under its prefix
      used = callerArr.some((c) => c === r.normalized || c.startsWith(r.normalized + '/'));
    } else {
      // exact normalized match, OR a caller nested deeper (route is a prefix the
      // caller extends — happens when server registers "/api/models/:p" and a
      // caller also hits sub-resources)
      used = callers.has(r.normalized) || callerArr.some((c) => c.startsWith(r.normalized + '/'));
    }
    return { method: r.method, path: r.path, normalized: r.normalized, isMount: r.isMount, used, allowlisted };
  });
}

// Dead = not used AND not allowlisted AND not a bare mount (mounts covered above).
export function deadRoutes(reports: RouteReport[]): RouteReport[] {
  return reports.filter((r) => !r.used && !r.allowlisted);
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

function readAll(files: string[]): string[] {
  return files.map((f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  });
}

export function main(argv: string[]): number {
  const strict = argv.includes('--strict');
  const serverSrc = readFileSync(join(ROOT, 'server.ts'), 'utf8');
  const mcpSources = readAll(walk(join(ROOT, 'server'), ['.ts']));
  const constants = buildConstantMap(mcpSources);
  const routes = parseServerRoutes(serverSrc, constants);

  const callerFiles = [
    ...walk(join(ROOT, 'src'), ['.ts', '.tsx']),
    ...walk(join(ROOT, 'cli'), ['.ts', '.tsx', '.mjs']),
  ];
  const callers = parseCallerEndpoints(readAll(callerFiles));

  const reports = computeRouteReports(routes, callers);
  const dead = deadRoutes(reports);

  const used = reports.filter((r) => r.used).length;
  console.log('route-usage (v1.25.5 hygiene)');
  console.log(`  server routes : ${reports.length}  (used ${used}, allowlisted ${reports.filter((r) => r.allowlisted).length}, dead ${dead.length})`);
  console.log(`  caller paths  : ${callers.size} distinct /api/* references (src/** + cli/**)`);
  if (dead.length) {
    console.log('\n  DEAD (no caller references — review; may be API-only/external):');
    for (const r of dead.sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`    ${r.method.padEnd(6)} ${r.path}`);
    }
  } else {
    console.log('\n  no unexpected dead routes.');
  }
  return strict && dead.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
