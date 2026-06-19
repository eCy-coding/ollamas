// `ollamas plugin` — manage checksum-gated external subcommands (v10). Installing
// a plugin is the explicit trust gate (trust-on-first-use): the file is copied
// into ~/.ollamas/plugins/ and its sha256 recorded. Thereafter `ollamas <name>`
// runs it ONLY if the file still hashes to the recorded value (see index.ts
// fallback). A plugin is arbitrary code — we never auto-install or scan $PATH.
import { parseArgs } from "node:util";
import { readFileSync, copyFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { resolveOutputCtx, c, formatTable } from "../lib/output";
import {
  loadRegistry,
  saveRegistry,
  verifyPluginFile,
  isValidPluginName,
  pluginsDir,
  pluginsPath,
  findPlugin,
  type PluginEntry,
} from "../lib/plugins";
import { sha256Hex } from "../lib/manifest";

const HELP = `ollamas plugin — manage external subcommands (checksum-gated)

  plugin list                     installed plugins + verify status
  plugin install <path> [--name n]  register an executable (trust-on-first-use)
  plugin remove <name>            unregister + delete

A plugin runs as 'ollamas <name>' only while its sha256 matches what was recorded
at install time. Plugins are arbitrary code — install only what you trust.`;

export async function runPlugin(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { name: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } },
  });
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + "\n");
    return values.help ? 0 : 2;
  }

  const [action, arg1] = positionals;
  switch (action) {
    case "list":
      return listPlugins(ctx);
    case "install":
      return installPlugin(arg1, values.name as string | undefined, ctx);
    case "remove":
    case "rm":
      return removePlugin(arg1, ctx);
  }
  process.stderr.write(`plugin: unknown action '${action}' (list|install|remove)\n`);
  return 2;
}

function listPlugins(ctx: { color: boolean; json: boolean }): number {
  const entries = loadRegistry();
  if (ctx.json) {
    process.stdout.write(JSON.stringify(entries.map((e) => ({ ...e, verified: verifyPluginFile(e.path, e.sha256) })), null, 2) + "\n");
    return 0;
  }
  if (!entries.length) {
    process.stdout.write(c("dim", `no plugins (registry: ${pluginsPath()})`, ctx.color) + "\n");
    return 0;
  }
  process.stdout.write(
    formatTable(
      ["name", "status", "path"],
      entries.map((e) => [e.name, verifyPluginFile(e.path, e.sha256) ? c("green", "✓ ok", ctx.color) : c("red", "✗ tampered", ctx.color), e.path]),
      ctx,
    ) + "\n",
  );
  return 0;
}

function installPlugin(srcPath: string | undefined, nameFlag: string | undefined, ctx: { color: boolean; json: boolean }): number {
  if (!srcPath) {
    process.stderr.write("plugin install: missing <path>\n");
    return 2;
  }
  // Default name = basename minus an optional ollamas- prefix.
  const name = (nameFlag || basename(srcPath).replace(/^ollamas-/, "")).trim();
  if (!isValidPluginName(name)) {
    process.stderr.write(`plugin install: invalid name '${name}' (allowed: a-z 0-9 -)\n`);
    return 2;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(srcPath);
  } catch (e: any) {
    process.stderr.write(`plugin install: cannot read '${srcPath}': ${String(e?.message || e)}\n`);
    return 1;
  }
  mkdirSync(pluginsDir(), { recursive: true, mode: 0o700 });
  const dest = join(pluginsDir(), name);
  copyFileSync(srcPath, dest);
  chmodSync(dest, 0o755);
  const sha256 = sha256Hex(bytes);

  const entries = loadRegistry().filter((e) => e.name !== name);
  const entry: PluginEntry = { name, path: dest, sha256, installed: new Date().toISOString() };
  entries.push(entry);
  saveRegistry(entries);
  process.stdout.write(c("green", `installed '${name}'`, ctx.color) + c("dim", `  → ${dest}  (run: ollamas ${name})`, ctx.color) + "\n");
  return 0;
}

function removePlugin(name: string | undefined, ctx: { color: boolean; json: boolean }): number {
  if (!name) {
    process.stderr.write("plugin remove: missing <name>\n");
    return 2;
  }
  const entries = loadRegistry();
  const entry = findPlugin(entries, name);
  if (!entry) {
    process.stderr.write(`plugin remove: '${name}' not installed\n`);
    return 1;
  }
  try {
    rmSync(entry.path, { force: true });
  } catch {
    /* file already gone */
  }
  saveRegistry(entries.filter((e) => e.name !== name));
  process.stdout.write(c("green", `removed '${name}'`, ctx.color) + "\n");
  return 0;
}
