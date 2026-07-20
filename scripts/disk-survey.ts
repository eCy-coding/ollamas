// SALT-OKUNUR disk survey — rapor üretir, HİÇBİR ŞEY silmez/taşımaz/sıkıştırmaz.
//
// Emre sözleşmesi: silme asla otonom değildir. Bu script bir JSON rapor yazar;
// `rm` kararı operatörün. Kuarantina scripti ve sıkıştırma şeridi bilinçli olarak
// YOK — disk %69 (274Gi boş), aciliyet bitti, gereksiz karmaşıklık eklenmez.
//
// MacBook dostu: `nice -n 19`, yalnız GPU boştayken, hash yalnız boyutu çakışan
// adaylara uygulanır (hash = GB'larca okuma demek).
//
// Koş: make disk-survey        Çıktı: artifacts/disk/survey-<tarih>.json
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { rankReclaimable, sizeBuckets, groupByHash, humanBytes, type FileItem } from "../server/disk-model";

const HOME = homedir();
const MIN_DUP_BYTES = Number(process.env.DISK_MIN_DUP_BYTES) || 100 * 1024 * 1024;
const OUT_DIR = join(process.cwd(), "artifacts", "disk");

const sh = (cmd: string, args: string[], ms = 300_000): string => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: ms, maxBuffer: 64 * 1024 * 1024 });
  } catch (e: any) {
    return String(e?.stdout ?? ""); // kısmi çıktı tam sessizlikten iyidir
  }
};

/** GPU meşgulse tarama yapma — kullanıcının/loop'un işini yavaşlatmayalım. */
async function gpuBusy(): Promise<boolean> {
  try {
    const base = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
    const r = await fetch(`${base}/api/brain/gpu-status`, { signal: AbortSignal.timeout(5_000) });
    return r.ok ? !!(await r.json())?.active : false;
  } catch { return false; } // sunucu yoksa meşgul sayma
}

async function main() {
  if (await gpuBusy()) {
    console.log(JSON.stringify({ event: "disk.survey", skipped: "gpu meşgul" }));
    return;
  }

  // 1) Büyük dosyalar — nice'lı, salt-okunur. -size +50M ile aday kümesi daraltılır.
  const raw = sh("nice", ["-n", "19", "find", HOME, "-type", "f", "-size", "+50M", "-print0"]);
  const paths = raw.split("\0").filter(Boolean);

  const items: FileItem[] = [];
  for (const p of paths) {
    const out = sh("stat", ["-f", "%z %m", p], 5_000).trim();
    const [b, m] = out.split(/\s+/).map(Number);
    if (Number.isFinite(b)) items.push({ path: p, bytes: b, mtime: Number.isFinite(m) ? m * 1000 : undefined });
  }

  // 2) Kopya avı — İKİ AŞAMALI. Önce boyut kovası (bedava), sonra YALNIZ
  //    çakışanlara shasum (pahalı: her dosya baştan sona okunur).
  const buckets = sizeBuckets(items, MIN_DUP_BYTES);
  const hashed: { path: string; bytes: number; hash: string }[] = [];
  let hashedBytes = 0;
  for (const g of buckets) {
    for (const f of g) {
      const h = sh("shasum", ["-a", "256", f.path], 600_000).split(/\s+/)[0];
      if (h) { hashed.push({ path: f.path, bytes: f.bytes, hash: h }); hashedBytes += f.bytes; }
    }
  }
  const dups = groupByHash(hashed);

  // 3) Sıralama — güvenli + büyük + eski önce; `never` görünür kalır ama en sonda.
  const ranked = rankReclaimable(items, Date.now()).slice(0, 60);

  const totalReclaimable = dups.reduce((a, d) => a + d.reclaimable, 0);
  const report = {
    at: new Date().toISOString(),
    scannedFiles: items.length,
    hashedFiles: hashed.length,
    hashedBytesHuman: humanBytes(hashedBytes),
    duplicateGroups: dups.length,
    totalReclaimableBytes: totalReclaimable,
    totalReclaimableGB: Number((totalReclaimable / 1024 ** 3).toFixed(2)),
    duplicates: dups.map((d) => ({ ...d, human: humanBytes(d.bytes), reclaimableHuman: humanBytes(d.reclaimable) })),
    largest: ranked.map((r) => ({ path: r.path, human: humanBytes(r.bytes), risk: r.risk })),
    note: "SALT-OKUNUR rapor. Hiçbir dosya silinmedi/taşınmadı. Silme kararı operatörün.",
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `survey-${report.at.slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`disk survey → ${out}`);
  console.log(`  taranan: ${report.scannedFiles} dosya · hash'lenen: ${report.hashedFiles}`);
  console.log(`  kopya grubu: ${report.duplicateGroups} · geri kazanılabilir: ${report.totalReclaimableGB} GB`);
  for (const d of report.duplicates.slice(0, 5)) {
    console.log(`  [${d.reclaimableHuman}] ${d.paths.join("\n              ")}`);
  }
}

void main();
