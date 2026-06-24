#!/usr/bin/env tsx
/**
 * orchestration/bin/status.ts — ollamas lane'lerinin READ-ONLY birleşik durum matrisi.
 *
 * ORCHESTRATION_AGENTS.md §3 Scope Law: bu araç HİÇBİR şey mutate etmez. Yalnız git/lsof/
 * ps/osascript okur. Worktree listesini dinamik keşfeder (hardcoded lane yok).
 *
 * vO2: dev-server tespiti port-tahmini DEĞİL, lsof→pid→cwd→worktree eşlemesiyle (6 lane de
 * port 3000'e bind — ERR-ORCH-001). Terminal.app sekmeleri + idle-lane sinyali eklendi.
 *
 * Çıktı: stdout markdown matrisi + orchestration/STATUS.md.
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/status.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listenersLive, pidCwdLive, mapServersToWorktrees, discoverTabs, tabWorktree,
  type Worktree as DWorktree, type ServerLane, type TabInfo,
} from "./discover";
import { nudge, notify } from "./lib/signal.ts";
import { defaultStore, readClaims, activeClaims, claimKey } from "./lib/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, ".."); // orchestration/
const ANCHOR = "/Users/emrecnyngmail.com/Desktop/ollamas"; // ana repo (worktree kaynağı)
const EXPECTED_TABS = Number(process.env.ORCH_EXPECTED_TABS || 8);
const IDLE_HOURS = Number(process.env.ORCH_IDLE_HOURS || 3);
// §3.1 Koordinasyon İstisnası flag'leri. Default: hiçbir yan-etki yok (yalnız gözlem).
const ARGV = new Set(process.argv.slice(2));
const DO_NUDGE = ARGV.has("--nudge");     // idle/stuck lane sekmesine 'git status' dürtmesi
const DO_NOTIFY = ARGV.has("--notify");   // idle/stuck lane için macOS bildirimi
const DRY_RUN = ARGV.has("--dry-run");    // --nudge ile birlikte: gerçek gönderme, planı göster

/** Read-only git komutu; hata olursa boş string döner (asla throw → matris kırılmaz). */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // stderr sustur: "no upstream" vb. zararsız
    }).trim();
  } catch {
    return "";
  }
}

interface Worktree { path: string; branch: string; head: string; }

function discoverWorktrees(): Worktree[] {
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

/** maxdepth 3, node_modules/.git atla; ad regex eşleşen ilk dosya yolu. */
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

/** ROADMAP'ten kaba versiyon sinyali: son DONE/✅ satırı + ilk NEXT/planned satırı. */
function roadmapSignal(wtPath: string): string {
  const f = findFile(wtPath, /roadmap.*\.md$/i) || findFile(wtPath, /^(FRONTEND_)?AGENTS\.md$/);
  if (!f) return "—";
  const lines = readFileSync(f, "utf8").split("\n");
  const done = lines.filter(l => /✅|done/i.test(l) && /v[O]?\d/i.test(l)).pop();
  const next = lines.find(l => /next|sıradaki|planned|🔨|active/i.test(l) && /v[O]?\d/i.test(l));
  const pick = (s?: string) => (s ? s.replace(/[|*#>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 36) : "");
  const parts = [pick(done), pick(next)].filter(Boolean);
  return parts.length ? parts.join(" → ") : "—";
}

/** errors_registry.json: hata sayısı + son id. */
function errorSignal(wtPath: string): string {
  const f = findFile(wtPath, /errors_registry\.json$/);
  if (!f) return "—";
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    const errs = Array.isArray(j.errors) ? j.errors : [];
    const last = errs.length ? errs[errs.length - 1].id : "none";
    return `${errs.length} (${last})`;
  } catch { return "parse-fail"; }
}

/** Son commit yaşı saat cinsinden; commit yoksa Infinity. */
function ageHours(wtPath: string): number {
  const ct = parseInt(git(wtPath, ["log", "-1", "--format=%ct"]), 10);
  if (!Number.isFinite(ct)) return Infinity;
  return (Date.now() / 1000 - ct) / 3600;
}

function main(): void {
  const wts = discoverWorktrees();
  const dwts: DWorktree[] = wts.map(w => ({ path: w.path, branch: w.branch }));

  // Dev-server keşfi: lsof LISTEN → cwd → lane (port-3000 collision cwd ile çözülür).
  const servers: ServerLane[] = mapServersToWorktrees(listenersLive(), dwts, pidCwdLive);
  const serverByPath = new Map<string, ServerLane>();
  for (const s of servers) if (!serverByPath.has(s.path)) serverByPath.set(s.path, s);

  // Sekme keşfi (tmux-first → iTerm2 + Terminal.app fallback; izin yoksa zarafetle atlar).
  const tabRes = discoverTabs();
  const tabCountByPath = new Map<string, number>();
  const tabByPath = new Map<string, TabInfo>(); // lane → temsilci sekme (koordinasyon hedefi)
  let mappedTabs = 0;
  if (tabRes.available) {
    for (const t of tabRes.tabs) {
      // tmux pane'inin cwd'si var → doğrudan eşle; AppleScript sekmesi → tty→pid→cwd.
      const wt = t.cwd ? (dwts.find(w => t.cwd === w.path || t.cwd!.startsWith(w.path + "/")) ?? null) : tabWorktree(t.tty, dwts);
      if (wt) {
        tabCountByPath.set(wt.path, (tabCountByPath.get(wt.path) || 0) + 1);
        if (!tabByPath.has(wt.path)) tabByPath.set(wt.path, t);
        mappedTabs++;
      }
    }
  }

  const rows: string[] = [];
  const idleLanes: { branch: string; path: string }[] = []; // koordinasyon adayları
  for (const wt of wts) {
    const age = git(wt.path, ["log", "-1", "--format=%cr"]) || "—";
    const dirty = git(wt.path, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
    const ab = git(wt.path, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]).replace("\t", "/") || "n/a";
    const rm = roadmapSignal(wt.path);
    const err = errorSignal(wt.path);
    const srv = serverByPath.get(wt.path);
    const dev = srv ? `:${srv.port}(${srv.pid})` : "—";
    const tabs = tabRes.available ? (tabCountByPath.get(wt.path) || 0) : -1;
    const tabCol = tabs < 0 ? "?" : String(tabs);
    const isIdle = ageHours(wt.path) > IDLE_HOURS;
    if (isIdle && tabByPath.has(wt.path)) idleLanes.push({ branch: wt.branch, path: wt.path });
    rows.push(`| ${wt.branch} | ${wt.head} | ${age} | ${dirty} | ${ab} | ${dev} | ${tabCol} | ${isIdle ? "💤" : "✓"} | ${rm} | ${err} |`);
  }

  const now = git(ANCHOR, ["log", "-1", "--format=%cd", "--date=iso"]) || "";
  const tabLine = tabRes.available
    ? `Sekmeler: beklenen ${EXPECTED_TABS} vs canlı ${tabRes.tabs.length} (lane'e eşlenen ${mappedTabs}).`
    : `Sekme keşfi: ${tabRes.note}.`;
  // vO7 Work-Claim: aktif claim'ler (additive — claim yoksa satır eklenmez, STATUS.md regresyon yok).
  const claims = activeClaims(readClaims(defaultStore(join(ORCH_DIR, "seyir"))), Date.now());
  const claimLine = `> 🔒 Aktif claim (${claims.length}): ${claims.map((c) => `${claimKey(c.lane, c.version)}→${c.tab}`).join(", ")}`;
  const md = [
    `# ollamas — Lane Durum Matrisi`,
    ``,
    `> READ-ONLY. \`tsx orchestration/bin/status.ts\` ile üretilir. ${wts.length} worktree, ${servers.length} canlı dev-server.`,
    `> ${tabLine}`,
    `> Ana-repo son commit: ${now}`,
    ...(claims.length ? [claimLine] : []),
    ``,
    `| Lane (branch) | HEAD | Yaş | Dirty | ↑/↓ | DevSrv | Tab | Idle | Roadmap sinyali | Hatalar |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...rows,
    ``,
    `**Lejant:** DevSrv \`:port(pid)\`=cwd ile lane'e atanmış çalışan server, \`—\`=yok (port-tahmini değil, ERR-ORCH-001). Tab=bu lane'e eşlenen Terminal sekmesi (\`?\`=keşif atlandı). Idle=💤 (>${IDLE_HOURS} saat commit yok) / ✓. ↑/↓=upstream ahead/behind.`,
  ].join("\n");
  console.log(md);
  writeFileSync(join(ORCH_DIR, "STATUS.md"), md + "\n");
  console.error(`\n[status.ts] STATUS.md yazıldı — ${wts.length} lane, ${servers.length} dev-server, sekme=${tabRes.available ? tabRes.tabs.length : "skip"}.`);

  // ── §3.1 Koordinasyon İstisnası: idle/stuck lane'lere TEŞHİS dürtmesi ──────
  // Default kapalı (yalnız gözlem). --nudge/--notify ile açılır. nudge dry-run varsayar;
  // gerçek gönderim için `--nudge` (dry-run değil) → allowlist'li 'git status' send-keys.
  if (DO_NUDGE || DO_NOTIFY) {
    if (!idleLanes.length) {
      console.error(`[koordinasyon] idle/stuck lane yok — dürtme gereksiz.`);
    }
    for (const lane of idleLanes) {
      const tab = tabByPath.get(lane.path)!;
      if (DO_NUDGE) {
        const target = { app: tab.app ?? "terminal", tty: tab.tty, session: tab.session };
        const r = nudge(target, "git status", { dryRun: DRY_RUN });
        console.error(`[nudge] ${lane.branch}: ${r.sent ? "GÖNDERİLDİ" : r.rejected ? "REDDEDİLDİ (" + r.reason + ")" : r.plan}`);
      }
      if (DO_NOTIFY) {
        const n = notify(`idle lane: ${lane.branch} (>${IDLE_HOURS}h commit yok)`);
        console.error(`[notify] ${lane.branch}: ${n.via}`);
      }
    }
  }
}

// Run main() only as a CLI (not when imported by tests — import would call process.exit).
if (process.argv[1] && /status\.ts$/.test(process.argv[1])) main();
