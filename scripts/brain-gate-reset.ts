// Çökmüş gate'i arşivle ve sıfırla — kusur G'nin tasfiyesi.
//
// Neden kurtarılamaz: gate KENDİ argmax'ıyla eğitildiği için W'nin YÖNÜ zaten
// eğilimin kendisidir. Normları küçültmek (yeniden ölçekleme) yönü korur, yani
// çöküşü küçük harflerle sürdürür. Tek dürüst seçenek sıfırdan başlamak.
//
// HEM gate.json HEM gate.last-good.json arşivlenir: yedek de aynı süreçle
// üretildiği için o da aynı derecede çökmüş durumda.
//
// Koş:  npx tsx scripts/brain-gate-reset.ts [--dry]
// Geri: arşiv dosyasını gate.json üzerine kopyala.
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyGate } from "../server/brain-formulas";

const DIM = Number(process.env.BRAIN_GATE_DIM) || 768;
const dir = process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
const gateFile = join(dir, "gate.json");
const backupFile = join(dir, "gate.last-good.json");
const dry = process.argv.includes("--dry");

/** Satır normları — çöküşün ölçüsü. */
function norms(p: string): number[] | null {
  try {
    const g = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(g?.W)) return null;
    return g.W.map((r: number[]) => Number(Math.sqrt(r.reduce((a, x) => a + x * x, 0)).toFixed(4)));
  } catch { return null; }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const report: Record<string, unknown> = { dry, dim: DIM, archived: [] as string[] };

for (const f of [gateFile, backupFile]) {
  if (!existsSync(f)) continue;
  const n = norms(f);
  report[`${f.endsWith("last-good.json") ? "backup" : "gate"}Norms`] = n;
  const archive = f.replace(/\.json$/, `.collapsed-${stamp}.json`);
  if (!dry) {
    copyFileSync(f, archive);
    unlinkSync(f);
  }
  (report.archived as string[]).push(archive);
}

if (!dry) writeFileSync(gateFile, JSON.stringify(emptyGate(DIM)));

report.result = dry
  ? "DRY — hiçbir şey değişmedi"
  : `gate sıfırlandı (${DIM} boyut). Geri alma: arşivi ${gateFile} üzerine kopyala.`;
console.log(JSON.stringify(report, null, 2));
