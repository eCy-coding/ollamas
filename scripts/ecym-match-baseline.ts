// eCym eşleşme TABANI + regresyon kapısı — app kartlarını öğretmenin mevcut 115
// komutu kaçırmadığını kanıtlar. SALT-OKUNUR (ecy-cmd yalnız eşleştirir, çalıştırmaz).
//
//   (arg yok)   TABAN ölç → artifacts/ecym-baseline.json (teach ÖNCESİ çağır)
//   --compare   yeniden ölç, tabanla kıyasla, regresyon varsa exit 1 (teach SONRASI)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchRegressions, newMatches, summarizeMatch, type MatchMap } from "../server/ecym-match";

const DS = join(homedir(), "ecy-model", "terminal-dataset.json");
const ECY_CMD = join(homedir(), ".local", "bin", "ecy-cmd");
const OUT = join(process.cwd(), "artifacts", "ecym-baseline.json");
const compare = process.argv.includes("--compare");

/** Bir sorguyu ecy-cmd'ye ver, eşleşen id'yi al (yoksa null). SALT-OKUNUR. */
function matchOne(query: string): string | null {
  try {
    const out = execFileSync(ECY_CMD, [query], { encoding: "utf8", timeout: 25_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!out) return null;
    const j = JSON.parse(out);
    return typeof j?.id === "string" ? j.id : null;
  } catch {
    return null; // ambiguous/arg-eksik/yok → eşleşme yok say
  }
}

/** MEVCUT (app-literacy DIŞI) komutların her birini kendi ilk tetikleyicisiyle ölç.
 *  app kartlarını dahil etmeyiz: onlar teach'ten sonra gelecek, tabanda olmamalı. */
function measureBaseline(): MatchMap {
  const ds = JSON.parse(readFileSync(DS, "utf8"));
  const cmds = (ds.commands ?? []).filter((c: any) => c.source !== "app-literacy");
  const map: MatchMap = {};
  for (const c of cmds) {
    const trigger = (c.triggers ?? [])[0];
    if (!trigger) continue;
    map[trigger] = matchOne(trigger);
  }
  return map;
}

if (!existsSync(ECY_CMD)) {
  console.error(`ecy-cmd yok: ${ECY_CMD} — eşleşme ölçülemez`);
  process.exit(compare ? 1 : 0);
}

if (!compare) {
  // TABAN
  const before = measureBaseline();
  mkdirSync(join(process.cwd(), "artifacts"), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), matches: before }, null, 1));
  const hit = Object.values(before).filter(Boolean).length;
  console.log(`TABAN: ${Object.keys(before).length} sorgu ölçüldü, ${hit} eşleşti → ${OUT}`);
} else {
  // REGRESYON KAPISI
  if (!existsSync(OUT)) { console.error(`taban yok: ${OUT} — önce --compare'siz çalıştır`); process.exit(1); }
  const before: MatchMap = JSON.parse(readFileSync(OUT, "utf8")).matches;
  const after = measureBaseline();

  const regs = matchRegressions(before, after);
  const gained = newMatches(before, after);
  const s = summarizeMatch(before, after);

  console.log(`ölçülen ${s.measured} · sabit ${s.stable} · yeni-kazanım ${gained.length} · REGRESYON ${regs.length}`);
  if (gained.length) console.log(`  yeni app eşleşmeleri (örnek): ${gained.slice(0, 5).map((g) => `${g.query}→${g.id}`).join(", ")}`);

  if (regs.length) {
    console.error(`\nREGRESYON (${regs.length}) — mevcut komutlar kaçırıldı:`);
    for (const r of regs) console.error(`  "${r.query}": ${r.was} → ${r.now ?? "EŞLEŞME-YOK"}`);
    console.error("\n  GERİ ALMA: en son ~/ecy-model/terminal-dataset.json.bak-<ts>'i geri yükle,");
    console.error("  sonra ecy-brain otomatik yeniden inşa eder (mtime tetikli).");
    process.exit(1);
  }
  console.log("\nregresyon YOK — mevcut 115 komut korundu, app kartları güvenle eklendi");
}
