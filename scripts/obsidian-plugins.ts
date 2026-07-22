// Obsidian community-plugin runtime installer (L25).
//
// WHY this exists: the vault is generated with Dataview queries (312 notes), a Kanban
// board, Templater templates and Periodic-Notes-shaped journals — but `.obsidian/plugins/`
// was empty and `community-plugins.json` was `[]`, so every one of those rendered as a raw
// code fence. The mirror was perfect and unusable. Obsidian has no CLI, so the plugin
// runtime has to be materialised on disk the same way the app would do it.
//
// Supply-chain discipline: versions are PINNED here, and every downloaded byte is checked
// against a committed lockfile (scripts/obsidian-plugins.lock.json). A hash mismatch is
// fail-closed — nothing is written. `--update` is the only mode that mints hashes (TOFU),
// and it is a deliberate, reviewable diff.
//
// Modes:
//   (default)     install from lock, verifying sha256. Idempotent: same version+hash → skip.
//   --update      re-download pinned versions, recompute hashes, rewrite the lock.
//   --verify      compare what is installed on disk against the lock. No writes. exit 1 on drift.
//   --no-enable   write plugin files but leave community-plugins.json untouched.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PinnedPlugin {
  id: string;
  repo: string;
  version: string;
  /** styles.css is optional upstream (calendar ships none); main.js + manifest.json never are. */
  files: string[];
  /**
   * Expected manifest.json `version` when upstream tagged a release without bumping the
   * manifest. Defaults to `version`. Recording the discrepancy keeps the guard strict
   * instead of deleting it the first time a maintainer is sloppy.
   */
  manifestVersion?: string;
  why: string;
}

// Curation: every entry earns its place by making already-generated vault content work, or
// by opening a surface the orchestra needs. Smart Connections is deliberately EXCLUDED —
// the brain already computes sqlite-vec KNN neighbours (MRR 0.877) and re-embedding 2004
// notes a second time would burn disk/CPU to produce a competing "related" answer.
export const PLUGINS: PinnedPlugin[] = [
  // Upstream tagged 0.5.70 but shipped a manifest still reading 0.5.68 (verified against the
  // release asset). Take the newer code, and state the expected manifest rather than relaxing the check.
  { id: "dataview", repo: "blacksmithgu/obsidian-dataview", version: "0.5.70", manifestVersion: "0.5.68",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "312 generated notes embed ```dataview blocks (Home, tier hubs, entity backlinks)" },
  { id: "templater-obsidian", repo: "silentvoid13/Templater", version: "2.24.0",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "templates/ ships Templater syntax; capture template depends on it" },
  { id: "obsidian-kanban", repo: "obsidian-community/obsidian-kanban", version: "2.0.51",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "orchestra/sprint.md carries kanban-plugin frontmatter" },
  // liamcain's plugins mark betas as GitHub 'latest'; pin the stable line the community
  // registry actually ships instead of tracking a beta tag.
  { id: "calendar", repo: "liamcain/obsidian-calendar-plugin", version: "1.5.10",
    files: ["main.js", "manifest.json"], // ships no styles.css — verified against the 1.5.10 assets
    why: "journal/YYYY-MM-DD episodic dailies need a calendar surface" },
  { id: "periodic-notes", repo: "liamcain/obsidian-periodic-notes", version: "0.0.17",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "daily + weekly rollups (L31) live under journal/" },
  { id: "obsidian-tasks-plugin", repo: "obsidian-tasks-group/obsidian-tasks", version: "8.2.2",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "the ask/search/learning queues are all '- [ ]' checkboxes; Tasks makes them queryable" },
  { id: "obsidian-local-rest-api", repo: "coddingtonbear/obsidian-local-rest-api", version: "4.1.7",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "L26: ships a REST + MCP server so all 4 experts can READ the vault, not just write it" },
  { id: "omnisearch", repo: "scambier/obsidian-omnisearch", version: "1.29.3",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "lexical full-text search complements the brain's semantic recall" },
  { id: "obsidian-excalidraw-plugin", repo: "zsviczian/obsidian-excalidraw-plugin", version: "2.25.3",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "hand-drawn diagrams alongside the generated JSON Canvas maps" },
  { id: "obsidian-git", repo: "vinzent03/obsidian-git", version: "2.38.6",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "L32: vault history/rollback for human edits" },
  { id: "obsidian-spaced-repetition", repo: "st3v3nmw/obsidian-spaced-repetition", version: "1.15.4",
    files: ["main.js", "manifest.json", "styles.css"],
    why: "L31 review queue over low-confidence / stale-core memories" },
];

export type Lock = Record<string, { version: string; sha256: Record<string, string> }>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const lockPath = (): string => join(HERE, "obsidian-plugins.lock.json");

export function vaultPath(): string {
  return process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;
}

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export const assetUrl = (p: PinnedPlugin, file: string): string =>
  `https://github.com/${p.repo}/releases/download/${p.version}/${file}`;

export function loadLock(path = lockPath()): Lock {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

/** True when a mismatch means "someone changed the bytes upstream" rather than "not installed yet". */
export function lockEntryFor(lock: Lock, p: PinnedPlugin): Lock[string] | null {
  const e = lock[p.id];
  return e && e.version === p.version ? e : null;
}

async function download(url: string, ms = 60_000): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Obsidian rewrites .obsidian/*.json on quit, so an install under a live app can be silently reverted. */
export function obsidianRunning(): boolean {
  try { return execFileSync("pgrep", ["-x", "Obsidian"], { encoding: "utf8" }).trim().length > 0; }
  catch { return false; }
}

/**
 * Restricted Mode check. Installing plugin files is NOT enough: Obsidian refuses to load
 * community plugins until the vault owner trusts them, and it records that consent outside
 * the vault, in the app's LevelDB under `enable-plugin-<vaultId>`. Without this probe the
 * failure is silent and baffling — every plugin present, correct and inert.
 *
 * Read-only on purpose. Flipping the flag ourselves would forge the user's consent to run
 * third-party code, so it stays a one-click human action.
 * Returns null when the state can't be determined (non-macOS, app never launched).
 */
export function pluginsTrusted(vault = vaultPath()): boolean | null {
  try {
    const support = `${process.env.HOME}/Library/Application Support/obsidian`;
    const reg = JSON.parse(readFileSync(join(support, "obsidian.json"), "utf8"));
    const id = Object.entries(reg.vaults ?? {}).find(([, v]: any) => v?.path === vault)?.[0];
    if (!id) return null;
    const ldb = join(support, "Local Storage", "leveldb");
    // The log is append-only, so the LAST write of the key is the current value.
    let last: boolean | null = null;
    for (const f of readdirSync(ldb).filter((f) => f.endsWith(".log"))) {
      const buf = readFileSync(join(ldb, f));
      const needle = Buffer.from(`enable-plugin-${id}`);
      for (let i = buf.indexOf(needle); i !== -1; i = buf.indexOf(needle, i + 1)) {
        const tail = buf.subarray(i + needle.length, i + needle.length + 16).toString("latin1");
        if (tail.includes("true")) last = true;
        else if (tail.includes("false")) last = false;
      }
    }
    return last;
  } catch { return null; }
}

export interface InstallReport {
  written: string[];
  skipped: string[];
  failed: { id: string; reason: string }[];
  enabled: string[];
}

async function install(opts: { update: boolean; enable: boolean }): Promise<InstallReport> {
  const vault = vaultPath();
  const lock = loadLock();
  const report: InstallReport = { written: [], skipped: [], failed: [], enabled: [] };

  for (const p of PLUGINS) {
    const dir = join(vault, ".obsidian", "plugins", p.id);
    const locked = lockEntryFor(lock, p);

    if (!opts.update && !locked) {
      report.failed.push({ id: p.id, reason: `no lock entry for ${p.version} — run with --update` });
      continue;
    }

    // Already on disk at the pinned version with matching bytes → nothing to do.
    if (locked && p.files.every((f) => {
      const dst = join(dir, f);
      return existsSync(dst) && sha256(readFileSync(dst)) === locked.sha256[f];
    })) { report.skipped.push(p.id); continue; }

    try {
      // Download EVERYTHING and verify before touching disk, so a mid-way failure can never
      // leave a half-written plugin that Obsidian would try to load.
      const blobs: Record<string, Buffer> = {};
      for (const f of p.files) {
        const buf = await download(assetUrl(p, f));
        const got = sha256(buf);
        if (locked) {
          const want = locked.sha256[f];
          if (!want) throw new Error(`lock has no hash for ${f}`);
          if (got !== want) throw new Error(`sha256 mismatch on ${f}: expected ${want.slice(0, 12)}… got ${got.slice(0, 12)}…`);
        }
        blobs[f] = buf;
      }
      // manifest.json must actually describe the plugin we pinned — catches a retagged release.
      const mf = JSON.parse(blobs["manifest.json"].toString("utf8"));
      if (mf.id !== p.id) throw new Error(`manifest id "${mf.id}" ≠ pinned id "${p.id}"`);
      const wantMf = p.manifestVersion ?? p.version;
      if (mf.version !== wantMf) throw new Error(`manifest version "${mf.version}" ≠ expected "${wantMf}"`);

      mkdirSync(dir, { recursive: true });
      for (const [f, buf] of Object.entries(blobs)) writeFileSync(join(dir, f), buf);
      if (opts.update) lock[p.id] = { version: p.version, sha256: Object.fromEntries(Object.entries(blobs).map(([f, b]) => [f, sha256(b)])) };
      report.written.push(p.id);
    } catch (e: any) {
      report.failed.push({ id: p.id, reason: e?.message || String(e) });
    }
  }

  if (opts.update) writeFileSync(lockPath(), JSON.stringify(lock, null, 2) + "\n");

  if (opts.enable) {
    const cpPath = join(vault, ".obsidian", "community-plugins.json");
    let current: string[] = [];
    try { current = JSON.parse(readFileSync(cpPath, "utf8")); } catch { current = []; }
    const ok = new Set([...report.written, ...report.skipped]);
    // Union, never a replace: a plugin Emre enabled by hand must survive our run.
    const next = [...new Set([...current, ...PLUGINS.filter((p) => ok.has(p.id)).map((p) => p.id)])];
    if (JSON.stringify(next) !== JSON.stringify(current)) writeFileSync(cpPath, JSON.stringify(next, null, 2) + "\n");
    report.enabled = next;
  }

  return report;
}

function verify(): number {
  const vault = vaultPath();
  const lock = loadLock();
  let bad = 0;
  for (const p of PLUGINS) {
    const locked = lockEntryFor(lock, p);
    if (!locked) { console.log(`✗ ${p.id}: no lock entry for ${p.version}`); bad++; continue; }
    const dir = join(vault, ".obsidian", "plugins", p.id);
    const drift = p.files.filter((f) => {
      const dst = join(dir, f);
      return !existsSync(dst) || sha256(readFileSync(dst)) !== locked.sha256[f];
    });
    if (drift.length) { console.log(`✗ ${p.id}@${p.version}: ${drift.join(", ")}`); bad++; }
    else console.log(`✓ ${p.id}@${p.version}`);
  }
  reportTrust();
  return bad;
}

/** Files-on-disk is only half the story; say so loudly when Obsidian is refusing to load them. */
function reportTrust(): void {
  const trusted = pluginsTrusted();
  if (trusted === true) { console.log("✓ community plugins trusted for this vault"); return; }
  if (trusted === null) { console.log("· plugin trust state unknown (app never launched?)"); return; }
  console.log("");
  console.log("⚠️  RESTRICTED MODE: Obsidian will NOT load these plugins until you trust them.");
  console.log("   Obsidian → Settings → Community plugins → 'Turn on community plugins'.");
  console.log("   One click, by design: it is your consent to run third-party code.");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--verify")) { process.exit(verify() === 0 ? 0 : 1); }

  if (obsidianRunning()) {
    console.log("⚠️  Obsidian is running. It rewrites .obsidian/*.json on quit, which can revert");
    console.log("   the enable step. Quit Obsidian, re-run, then reopen it to load the plugins.");
  }

  const report = await install({ update: argv.includes("--update"), enable: !argv.includes("--no-enable") });
  console.log(JSON.stringify({
    event: "obsidian.plugins",
    vault: vaultPath(),
    written: report.written.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
    enabled: report.enabled.length,
  }));
  for (const f of report.failed) console.log(`  ✗ ${f.id}: ${f.reason}`);
  if (report.written.length) console.log(`  ✓ written: ${report.written.join(", ")}`);
  if (report.skipped.length) console.log(`  · skipped (up to date): ${report.skipped.join(", ")}`);
  reportTrust();
  if (report.failed.length) process.exit(1);
}

// Only run when invoked directly — the exports above are unit-tested.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
