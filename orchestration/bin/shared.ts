/**
 * orchestration/bin/shared.ts — READ-ONLY ortak yardımcılar (DRY; status.ts + plan-next.ts).
 *
 * git komutu, worktree keşfi, dosya bulma, lane-adı→worktree çözümü. Hiçbiri mutate etmez.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const ANCHOR = "/Users/emrecnyngmail.com/Desktop/ollamas"; // ana repo (worktree kaynağı)

export interface Worktree { path: string; branch: string; head: string; }

/** Read-only git komutu; hata → "" (asla throw, akış kırılmaz). stderr susturulur. */
export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** `git worktree list --porcelain` → Worktree[]. Dinamik; hardcoded lane yok. */
export function discoverWorktrees(): Worktree[] {
  const out = git(ANCHOR, ["worktree", "list", "--porcelain"]);
  const wts: Worktree[] = [];
  let cur: Partial<Worktree> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) cur = { path: line.slice(9) };
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5, 12);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace("refs/heads/", "");
    else if (line.startsWith("detached")) cur.branch = "(detached)";
    else if (line === "" && cur.path) { wts.push(cur as Worktree); cur = {}; }
  }
  if (cur.path) wts.push(cur as Worktree);
  return wts;
}

/** maxdepth ile ad-regex eşleşen ilk dosya; node_modules/.git/dist atlanır. */
export function findFile(root: string, re: RegExp, depth = 3): string | null {
  if (depth < 0 || !existsSync(root)) return null;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return null; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(root, name);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isFile() && re.test(name)) return full;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(root, name);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) { const hit = findFile(full, re, depth - 1); if (hit) return hit; }
  }
  return null;
}

/** Lane takma-adı → branch-anahtar regex. backend = ana repo (path === ANCHOR). */
const LANE_KEYS: Record<string, RegExp> = {
  scripts: /scripts/i,
  cli: /\bcli\b|cli-/i,
  frontend: /front/i,
  integrations: /gateway|integration/i,
  bench: /bench/i,
  orchestration: /orchestration/i,
};

/** Lane adını worktree'ye çöz. Eşleşmezse null. */
export function resolveLane(name: string, worktrees: Worktree[]): Worktree | null {
  const key = name.trim().toLowerCase();
  if (key === "backend" || key === "main" || key === "gateway-core") {
    return worktrees.find((w) => w.path === ANCHOR) ?? null;
  }
  const re = LANE_KEYS[key];
  if (re) return worktrees.find((w) => re.test(w.branch) || re.test(w.path)) ?? null;
  // Serbest eşleşme: branch/path içinde geçiyorsa.
  return worktrees.find((w) => w.branch.toLowerCase().includes(key) || w.path.toLowerCase().includes(key)) ?? null;
}

/** Bilinen lane takma-adları (usage çıktısı için). */
export const KNOWN_LANES = ["backend", "frontend", "cli", "scripts", "integrations", "bench", "orchestration"];
