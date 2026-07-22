// Zero-touch community-plugin trust (L32.1).
//
// WHY: installing plugin files is only half of it. Obsidian refuses to LOAD a community
// plugin until the vault owner trusts them, and it records that consent outside the vault, in
// the app's own LevelDB under `enable-plugin-<vaultId>`. With the flag false, all eleven
// plugins sat on disk correct and completely inert: no port bound, no plugin data.json, every
// Dataview block still a raw fence. The failure is silent and baffling.
//
// This script exists because Emre — the vault owner — explicitly asked for that consent to be
// recorded on his behalf rather than clicking it again on every fresh vault or reset machine.
// It is his machine, his vault, and plugins he approved, pinned and checksum-locked in
// scripts/obsidian-plugins.ts. It is NOT a way around someone else's security decision, and
// it deliberately refuses to run against a vault it cannot find in Obsidian's own registry.
//
// Safety, in order:
//   1. no-op when already trusted — never touch the DB for nothing
//   2. Obsidian must be closed: it holds an exclusive LOCK, and a half-open DB is corruption
//   3. full directory backup before the first byte is written
//   4. write via a real LevelDB implementation (classic-level, installed to a temp prefix so
//      the repo gains no dependency) — never hand-rolled log framing
//   5. verify by relaunching and checking the plugins actually came up
//   6. restore the backup if verification fails, and say so plainly
import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginsTrusted, vaultPath, obsidianRunning } from "./obsidian-plugins";

const support = (): string => `${process.env.HOME}/Library/Application Support/obsidian`;
export const leveldbDir = (): string => process.env.OBSIDIAN_LEVELDB || join(support(), "Local Storage", "leveldb");

/** Obsidian's own id for this vault. Absent → the app has never opened it, and we must not guess. */
export function vaultId(vault = vaultPath()): string | null {
  try {
    const reg = JSON.parse(readFileSync(join(support(), "obsidian.json"), "utf8"));
    return Object.entries(reg.vaults ?? {}).find(([, v]: any) => v?.path === vault)?.[0] ?? null;
  } catch { return null; }
}

/**
 * Chromium's LocalStorage key layout, decoded from the live log rather than assumed:
 *   key   = "_" + origin + 0x00 0x01 + script key
 *   value = 0x01 + latin1 text        (0x00 would mean UTF-16LE)
 * The observed record was `…_app://obsidian.md\x00\x01enable-plugin-<id>` with value
 * `\x01false`, and the length prefixes matched exactly.
 */
export function trustKey(id: string): Buffer {
  return Buffer.concat([Buffer.from("_app://obsidian.md", "latin1"), Buffer.from([0x00, 0x01]), Buffer.from(`enable-plugin-${id}`, "latin1")]);
}
export const TRUE_VALUE = Buffer.concat([Buffer.from([0x01]), Buffer.from("true", "latin1")]);

/** Install classic-level into a throwaway prefix — the repo must not gain a dependency for a one-off. */
function ensureClassicLevel(): string {
  const dir = mkdtempSync(join(tmpdir(), "ollamas-lvl-"));
  execSync(`npm install --prefix ${JSON.stringify(dir)} --no-save --no-audit --no-fund classic-level`, { stdio: "pipe" });
  return join(dir, "node_modules");
}

async function writeTrue(dbDir: string, key: Buffer, nodePath: string): Promise<void> {
  const { ClassicLevel } = await import(join(nodePath, "classic-level", "index.js")) as any;
  const db = new ClassicLevel(dbDir, { keyEncoding: "buffer", valueEncoding: "buffer" });
  await db.open();
  try { await db.put(key, TRUE_VALUE); } finally { await db.close(); }
}

const quitObsidian = (): void => {
  try { execFileSync("osascript", ["-e", 'quit app "Obsidian"'], { stdio: "pipe" }); }
  catch { try { execFileSync("pkill", ["-TERM", "-x", "Obsidian"], { stdio: "pipe" }); } catch { /* not running */ } }
};
const launchObsidian = (): void => { try { execFileSync("open", ["-g", "-a", "Obsidian"], { stdio: "pipe" }); } catch { /* best-effort */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (pred()) return true; await sleep(500); }
  return pred();
}

/** Proof the flag took effect: the REST plugin binds its port only when plugins actually load. */
async function pluginsActuallyLoaded(timeoutMs = 60_000): Promise<boolean> {
  const { readObsidianCreds, obsidianHealth } = await import("../server/obsidian-rest");
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (readObsidianCreds() && (await obsidianHealth({ timeoutMs: 3000 })).ok) return true;
    await sleep(2000);
  }
  return false;
}

export interface TrustResult { changed: boolean; trusted: boolean; detail: string; backup?: string }

export async function ensureTrusted(): Promise<TrustResult> {
  const vault = vaultPath();
  if (pluginsTrusted(vault) === true) return { changed: false, trusted: true, detail: "already trusted — no-op" };

  const id = vaultId(vault);
  if (!id) return { changed: false, trusted: false, detail: `vault not in Obsidian's registry (${vault}) — open it once in the app first` };
  const dbDir = leveldbDir();
  if (!existsSync(dbDir)) return { changed: false, trusted: false, detail: `no LevelDB at ${dbDir}` };

  const wasRunning = obsidianRunning();
  if (wasRunning) {
    console.log("· quitting Obsidian (it holds an exclusive lock on the store)");
    quitObsidian();
    if (!await waitFor(() => !obsidianRunning(), 30_000)) {
      return { changed: false, trusted: false, detail: "Obsidian would not quit — refusing to touch a locked store" };
    }
    await sleep(1500); // let it finish flushing
  }

  const backup = `${dbDir}.bak-${Date.now()}`;
  cpSync(dbDir, backup, { recursive: true });
  console.log(`· backup → ${backup}`);

  try {
    await writeTrue(dbDir, trustKey(id), ensureClassicLevel());
  } catch (e: any) {
    cpSync(backup, dbDir, { recursive: true, force: true });
    if (wasRunning) launchObsidian();
    return { changed: false, trusted: false, backup, detail: `write failed, backup restored: ${e?.message ?? e}` };
  }

  launchObsidian();
  const ok = await pluginsActuallyLoaded();
  if (!ok) {
    // The flag alone is not the goal — plugins loading is. Undo rather than claim success.
    quitObsidian();
    await waitFor(() => !obsidianRunning(), 20_000);
    cpSync(backup, dbDir, { recursive: true, force: true });
    launchObsidian();
    return { changed: false, trusted: false, backup, detail: "flag written but plugins did not come up — backup restored" };
  }
  rmSync(backup, { recursive: true, force: true });
  return { changed: true, trusted: true, detail: "community plugins trusted; runtime verified live on :27124" };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  ensureTrusted()
    .then((r) => {
      console.log(JSON.stringify({ event: "obsidian.trust", changed: r.changed, trusted: r.trusted, detail: r.detail }));
      process.exit(r.trusted ? 0 : 1);
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
