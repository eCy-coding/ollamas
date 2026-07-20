// Formül 4 — ReAtt yeniden sıralama SARMALAYICISI (saf matematik brain-formulas.ts'te).
//
// DÜRÜSTLÜK NOTU (brain-formulas.ts:196 konvansiyonu): gerçek ReAtt bunu Transformer'ın
// İÇİNDE, TOKEN düzeyinde, ÇOK BAŞLIKLI ve öğrenilebilir P^head ile yapar. Bizde ne
// dikkat matrisi ne başlıklar var — yalnız gömme vektörleri. Burada uygulanan biçim
// üç yerde daha kaba:
//   • CÜMLE düzeyi (token değil)
//   • TEK başlık (P^head = 1)
//   • TEK sorgu parçası (soru zaten tek cümle; bölmek ek gömme = ek GPU demek)
// avg-max yapısı korunur, çözünürlük düşer. Formül kılık değiştirmiyor; sınırı yazılı.
//
// MALİYET: en fazla MAX_DOCS × MAX_SENT_PER_DOC gömme, sert tavanlı. Sorgu için 0
// gömme (askShared'ın qVec'i yeniden kullanılır). Önbellek turlar arası tekrarı keser.
import { avgMaxScore } from "./brain-formulas";
import type { AskSource } from "./brain-ask";
import type { EmbedCache } from "./brain-embed-cache";

export const MAX_DOCS = 5;
export const MAX_SENT_PER_DOC = 4;
/** Tek koşuda yapılabilecek azami gömme — ısı bütçesinin sert sınırı. */
export const MAX_EMBEDS_PER_RUN = MAX_DOCS * MAX_SENT_PER_DOC;

/** SAF: metni cümlelere böl. Türkçe/İngilizce nokta-soru-ünlem + satır sonu.
 *  Kısa parçalar atılır (tek kelimelik gürültü sıralamayı bozar). */
export function splitSentences(text: string, maxSent: number = MAX_SENT_PER_DOC): string[] {
  return String(text ?? "")
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15)
    .slice(0, maxSent);
}

/** SAF: skorlara göre azalan sıralama; eşitlikte id ile deterministik. */
export function rerank(scored: { id: string; score: number }[]): string[] {
  return [...scored]
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
    .map((s) => s.id);
}

export interface ReattDeps {
  /** Loop bir HTTP istemcisidir: gömme :3000/api/brain/embed üzerinden gelir. */
  embed: (text: string) => Promise<{ vector: number[]; spaceId: string }>;
  cache: EmbedCache;
}

export interface ReattResult {
  original: string[];
  reranked: string[];
  /** Bu koşuda GERÇEKTEN yapılan gömme sayısı (önbellek isabetleri hariç). */
  embeds: number;
  scores: Record<string, number>;
}

/**
 * Kaynakları ReAtt avg-max skoruyla yeniden sırala.
 *
 * `qVec` askShared'dan gelir → sorgu için ek gömme YOK. Yalnız top-MAX_DOCS kaynağın
 * cümleleri gömülür ve önbelleğe yazılır.
 */
export async function reattRerank(
  qVec: number[],
  sources: AskSource[],
  deps: ReattDeps,
): Promise<ReattResult> {
  const original = [...sources]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((s) => s.id);

  const top = [...sources]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_DOCS);

  const scores: Record<string, number> = {};
  let embeds = 0;

  for (const s of top) {
    const chunks = splitSentences(s.excerpt);
    const vectors: number[][] = [];
    for (const c of chunks) {
      if (embeds >= MAX_EMBEDS_PER_RUN) break; // sert tavan
      // spaceId önbellek anahtarına girer; ilk gömmeden önce bilinmediği için
      // önce deneme amaçlı boş uzayla bakılmaz — gömme sonucu spaceId'yi verir.
      const got = await deps.embed(c);
      if (!got?.vector?.length) continue;
      // Önbellek isabetinde embed() zaten çağrılmadı (deps sarmalayıcısı halleder).
      vectors.push(got.vector);
      embeds++;
    }
    scores[s.id] = vectors.length ? avgMaxScore([qVec], vectors) : 0;
  }

  // Top dışında kalan kaynaklar skorsuz kalır → sıralamanın sonuna düşer.
  for (const s of sources) if (!(s.id in scores)) scores[s.id] = -1;

  return {
    original,
    reranked: rerank(sources.map((s) => ({ id: s.id, score: scores[s.id] ?? -1 }))),
    embeds,
    scores,
  };
}

/** SAF: bir id listesindeki hedeflerin Mean Reciprocal Rank'ı.
 *  ReAtt metriğinin temeli — cevabın ATIF YAPTIĞI kaynaklar sıralamada ne kadar üstte. */
export function mrr(ranking: string[], targets: string[]): number {
  if (!targets.length || !ranking.length) return 0;
  let sum = 0;
  let n = 0;
  for (const t of targets) {
    const i = ranking.indexOf(t);
    if (i >= 0) sum += 1 / (i + 1);
    n++;
  }
  return n ? sum / n : 0;
}
