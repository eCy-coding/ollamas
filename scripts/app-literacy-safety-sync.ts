// Politika → eCym safe senkronu (ince IO). Karar mantığı server/app-literacy.ts'te (saf).
//
// Emre panelden izin verince app komutlarının `safe` alanı tazelenir. Yalnız `.safe`
// değişir → `ecy-brain` triggers+desc gömdüğü için vektör indeksi GEÇERLİ kalır,
// bu yüzden yazımdan sonra mtime GERİ YÜKLENİR (gereksiz 882-embed inşası tetiklenmesin).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, statSync, utimesSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { reconcileAppSafety } from "../server/app-literacy";
import { loadAppCards } from "./app-literacy-load";
import { loadPolicyStrict } from "../server/agent-policy-store";

const DS = process.env.ECYM_DATASET || join(homedir(), "ecy-model", "terminal-dataset.json");

export interface SyncResult {
  changed: string[];
  unchanged: number;
  total: number;
  backup: string | null;
}

export function syncAppCommandSafety(): SyncResult {
  if (!existsSync(DS)) return { changed: [], unchanged: 0, total: 0, backup: null };

  const ds = JSON.parse(readFileSync(DS, "utf8"));
  const commands = ds.commands ?? [];

  // KRİTİK: politika GÜVENİLİR okunamıyorsa reconcile ATLA — loadPolicy fail-closed
  // default'u (hepsi kısıtlı) safe'i sıfırlardı (regresyonun kök nedeni). "Okunamadı → dokunma".
  const strictPolicy = loadPolicyStrict();
  if (!strictPolicy) return { changed: [], unchanged: commands.length, total: commands.length, backup: null };

  const { commands: next, changed } = reconcileAppSafety(commands, loadAppCards(), strictPolicy);

  // Değişiklik yoksa YAZMA — mtime bile bozulmasın (tam idempotent).
  if (!changed.length) return { changed: [], unchanged: commands.length, total: commands.length, backup: null };

  const mtimeBefore = statSync(DS).mtime;
  const backup = `${DS}.bak-${Date.now()}`;
  const tmp = `${DS}.tmp.${process.pid}`;
  copyFileSync(DS, backup);
  mkdirSync(join(DS, ".."), { recursive: true });
  writeFileSync(tmp, JSON.stringify({ ...ds, commands: next }, null, 1));
  renameSync(tmp, DS);

  // KRİTİK: safe değişikliği vektörü etkilemez (ecy-brain triggers+desc gömer).
  // mtime'ı geri yükle → ecy-brain'in mtime-tetikli yeniden inşası ATEŞLENMESİN.
  // ECY_REBUILD_VECTORS=1 ile bunu atla (yine de yeniden kurmak isteyene).
  if (process.env.ECY_REBUILD_VECTORS !== "1") {
    try { utimesSync(DS, mtimeBefore, mtimeBefore); } catch { /* best-effort */ }
  }
  try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* zaten yok */ }

  return { changed, unchanged: commands.length - changed.length, total: commands.length, backup };
}

// CLI
if (process.argv[1]?.includes("app-literacy-safety-sync")) {
  const r = syncAppCommandSafety();
  if (!r.total) console.log("dataset yok — senkron atlandı");
  else if (!r.changed.length) console.log(`senkron: değişiklik yok (${r.unchanged} app komutu zaten güncel)`);
  else {
    console.log(`senkron: ${r.changed.length} komut güncellendi, yedek → ${r.backup}`);
    console.log(`  örnek: ${r.changed.slice(0, 8).join(", ")}${r.changed.length > 8 ? " …" : ""}`);
    console.log("  (mtime korundu — vektör indeksi yeniden inşa edilmedi)");
  }
}
