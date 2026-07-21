// Loop SELF-AUTHORING — kalan 80 app kartını loop kendi kendine zenginleştirir ($0).
//
// Top-20 kart elle usage ile yazıldı (Faz 2). Kalan 80'i elle yazmak ölçeklenmez →
// loop bir kart seçer, paylaşımlı brain'e "app X'i nasıl kullanırım, örnek komutlar"
// sorar, üretilen örnek komutları GÜVENLİ-YAPI ile DOĞRULAR (osacompile/appExists),
// yalnız DOĞRULANANI brain'e zengin usage olarak yazar. Metrik `verifiedExampleRate`.
//
// Buradaki her fonksiyon SAF ve testli; IO (osacompile/appExists/brain-write) loop'ta.
import type { AppCard } from "./app-literacy";

/** usage'ı OLMAYAN kartlar — loop'un self-author kuyruğu. Top-20 elle yazıldı, gerisi burada. */
export function cardsNeedingUsage(cards: AppCard[]): AppCard[] {
  return cards.filter((c) => !c.usage || !c.usage.guide || !c.usage.canDo?.length);
}

/**
 * Üretilen metinden ÇALIŞTIRILABİLİR komut adaylarını çıkar — yalnız yapı-doğrulanabilir
 * biçimler (`open -a "App"`, `osascript -e '...'`). Serbest metin cümleleri DEĞİL:
 * doğrulanamayan bir şeyi metrik saymak sahte güven verir (Faz A-E metrik dersi).
 */
export function extractCommandCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => { const t = c.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
  for (const m of String(text ?? "").matchAll(/open\s+-a\s+"[^"]+"(?:\s+[^\n`]*)?/g)) push(m[0]);
  for (const m of String(text ?? "").matchAll(/osascript\s+-e\s+'[^']+'/g)) push(m[0]);
  return out;
}

/**
 * Doğrulanan örnek oranı ∈ [0,1] | undefined. `verify` yapı-doğrular (compile/appExists).
 * Aday YOKSA undefined döner (küme-içi dürüstlük — sıfır aday "mükemmel" ya da "berbat"
 * değil, ÖLÇÜLEMEZ; ragseq metrik dersiyle aynı: vacuous değer ortalamayı kirletmesin).
 */
export function verifiedExampleRate(
  candidates: string[], verify: (cmd: string) => boolean,
): { verified: number; total: number; rate: number | undefined } {
  const total = candidates.length;
  if (total === 0) return { verified: 0, total: 0, rate: undefined };
  const verified = candidates.filter((c) => { try { return verify(c); } catch { return false; } }).length;
  return { verified, total, rate: verified / total };
}

/**
 * Loop'un brain'e yazacağı zengin usage kaydı — YALNIZ doğrulanan örneklerle.
 * id `loop:app-usage:<slug>` (elle yazılan `teach:app:<slug>`'i EZMEZ, additive).
 * Doğrulanmayan örnek İÇERİĞE GİRMEZ (uydurma komut brain'e sızmasın).
 */
export function buildAuthoredUsageRecord(
  app: string, slug: string, guide: string, verifiedExamples: string[],
): { id: string; content: string; ns: string } {
  const ex = verifiedExamples.length ? ` Doğrulanmış örnek komutlar: ${verifiedExamples.join(" | ")}.` : "";
  return {
    id: `loop:app-usage:${slug}`,
    ns: "knowledge",
    content: `${app} kullanım (loop-authored): ${guide.trim()}${ex}`,
  };
}
