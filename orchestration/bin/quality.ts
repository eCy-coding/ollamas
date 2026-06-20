#!/usr/bin/env tsx
/**
 * orchestration/bin/quality.ts — vO9 Quality-Gate Roll-Up: 0-manuel tüm-lane sağlık matrisi.
 *
 * READ-ONLY conductor: her lane'de `tsc --noEmit` (stateless, ucuz ~2s, dosya YAZMAZ) CANLI koşar +
 * vitest `.last-run.json` cache TÜKET (canlı vitest YASAK — pahalı+flaky, UK-08) → rollup → QUALITY.md +
 * QUALITY.json (conduct ClassifyInput.redLanes uyumlu). Tek komut, insan-seçimi yok.
 *
 * Çalıştır: tsx orchestration/bin/quality.ts [--no-tsc]   (--no-tsc → yalnız cache, tsc atla)
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, git, ANCHOR } from "./shared";
import { isStale } from "./lib/bench";
import { parseTscResult, parseLastRun, rollup, toQualityTable, type LaneQuality } from "./lib/quality";

const ORCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const NO_TSC = process.argv.includes("--no-tsc");
const TSC_TIMEOUT = Number(process.env.QUALITY_TSC_TIMEOUT_MS || 45_000);

/** Branch→kısa lane adı (collect.ts laneName ile aynı kural). */
function laneName(branch: string, path: string): string {
  if (path === ANCHOR) return "backend";
  const m = branch.match(/feat\/([a-z]+)/i);
  return m ? m[1] : branch.replace(/^feat\//, "");
}

/** tsc --noEmit lane'de koş (kendi node_modules .bin/tsc). tsconfig/tsc yoksa skip. */
function runTsc(wtPath: string): { tsc: LaneQuality["tsc"]; errors: number } {
  const tscBin = join(wtPath, "node_modules", ".bin", "tsc");
  if (!existsSync(join(wtPath, "tsconfig.json")) || !existsSync(tscBin)) return { tsc: "skip", errors: 0 };
  try {
    execFileSync(tscBin, ["--noEmit"], { cwd: wtPath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: TSC_TIMEOUT });
    return { tsc: "pass", errors: 0 };
  } catch (e: any) {
    if (e?.code === "ETIMEDOUT") return { tsc: "skip", errors: 0 };
    const out = `${e?.stdout ?? ""}\n${e?.stderr ?? ""}`;
    const r = parseTscResult(typeof e?.status === "number" ? e.status : 1, out);
    return { tsc: r.ok ? "pass" : "fail", errors: r.errorCount };
  }
}

/** vitest .last-run.json oku → {testLast, testTs(mtime), testStale}. */
function readLastRun(wtPath: string): { testLast: LaneQuality["testLast"]; testTs: string; testStale: boolean } {
  const f = join(wtPath, "test-results", ".last-run.json");
  if (!existsSync(f)) return { testLast: "unknown", testTs: "", testStale: false };
  try {
    const status = parseLastRun(readFileSync(f, "utf8")).status;
    const ts = statSync(f).mtime.toISOString();
    return { testLast: status, testTs: ts, testStale: isStale(ts, 2) };
  } catch {
    return { testLast: "unknown", testTs: "", testStale: false };
  }
}

function main(): void {
  const wts = discoverWorktrees();
  const qs: LaneQuality[] = wts.map((wt) => {
    const lane = laneName(wt.branch, wt.path);
    const dirty = git(wt.path, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
    const { tsc, errors } = NO_TSC ? { tsc: "skip" as const, errors: 0 } : runTsc(wt.path);
    const lr = readLastRun(wt.path);
    return { lane, branch: wt.branch, tsc, tscErrors: errors, ...lr, dirty };
  });

  const r = rollup(qs);
  const ts = new Date().toISOString();
  const md = [
    `# QUALITY — Tüm-Lane Sağlık Matrisi (vO9, 0-manuel)`,
    ``,
    `> READ-ONLY \`quality.ts\` üretti · ${ts} · tsc CANLI${NO_TSC ? " (atlandı --no-tsc)" : ""} + vitest .last-run cache.`,
    `> **🟢 ${r.greens.length} green · 🔴 ${r.reds.length} red · ⚪ ${r.unknowns.length} unknown** (toplam ${qs.length} lane).`,
    ``,
    toQualityTable(qs),
    ``,
    r.redLanes.length
      ? `## 🔴 RED lane'ler (conductor'a sinyal)\n${r.redLanes.map((x) => `- **${x.lane}**: ${x.detail}`).join("\n")}`
      : `_✅ RED lane yok._`,
    ``,
    `---`,
    `_vitest CANLI koşulmaz (cache tüketilir); tsc stateless read-only. Gap'i conductor fixlemez → lane sekmesine backlog (§3)._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "QUALITY.md"), md + "\n");
  writeFileSync(join(ORCH_DIR, "QUALITY.json"), JSON.stringify({
    ts, lanes: qs, redLanes: r.redLanes,
    totals: { green: r.greens.length, red: r.reds.length, unknown: r.unknowns.length },
  }, null, 2) + "\n");
  console.error(`[quality] ${qs.length} lane · 🟢${r.greens.length} 🔴${r.reds.length} ⚪${r.unknowns.length} · QUALITY.md/json yazıldı.`);
}

if (process.argv[1] && /quality\.ts$/.test(process.argv[1])) main();
