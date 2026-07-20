// Ajan politikasının kalıcılığı — ince IO kabuğu. Karar mantığı agent-policy.ts'te (saf).
//
// brain-gate-store.ts deseninin birebir aynısı: atomik yazım (tmp+rename), son-iyi
// yedek, ve GEÇERSİZ VERİ DİSKE YAZILMAZ. Fark şu ki burada bozulmanın bedeli daha
// ağır: bozuk bir gate yalnız yönlendirmeyi kötüleştirir, bozuk bir politika YETKİ
// meselesidir. Bu yüzden okuma tarafı da fail-closed — bozuksa varsayılana düşer,
// varsayılanda hiçbir sınıf "auto" değildir.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultPolicy, validatePolicy, type AgentPolicy } from "./agent-policy";

const stateDir = (): string => process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
export const policyPath = (): string => join(stateDir(), "agent-policy.json");
const backupPath = (): string => join(stateDir(), "agent-policy.last-good.json");

/**
 * Politikayı oku. Dosya yok / bozuk / geçersizse SIRAYLA: son-iyi yedek → varsayılan.
 * Hiçbir durumda "yetki genişleten" bir sonuç dönmez.
 */
export function loadPolicy(): AgentPolicy {
  for (const f of [policyPath(), backupPath()]) {
    try {
      if (!existsSync(f)) continue;
      const p = JSON.parse(readFileSync(f, "utf8"));
      if (validatePolicy(p).ok) return p as AgentPolicy;
    } catch { /* bir sonraki adaya düş */ }
  }
  return defaultPolicy(Date.now());
}

/** Politikayı ATOMİK yaz. Geçersiz politika ASLA diske inmez. */
export function savePolicy(p: AgentPolicy): { ok: boolean; errors: string[] } {
  const v = validatePolicy(p);
  if (!v.ok) return v;
  const target = policyPath();
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    mkdirSync(stateDir(), { recursive: true });
    // Yenisini yazmadan ÖNCE mevcut geçerli sürümü yedekle.
    try { if (existsSync(target)) copyFileSync(target, backupPath()); } catch { /* yedek best-effort */ }
    writeFileSync(tmp, JSON.stringify(p, null, 1));
    renameSync(tmp, target);
    return { ok: true, errors: [] };
  } catch (e: any) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* temizlik */ }
    return { ok: false, errors: [String(e?.message ?? e)] };
  }
}
