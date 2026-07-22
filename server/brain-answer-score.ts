// DIŞSAL cevap kalitesi — gate'in öğrenme ETİKETİ (kusur G'nin kökü).
//
// Eski hâlde `updateGate` gate'in KENDİ argmax'ıyla besleniyordu. Etiketi kendi
// tahmini olan bir öğrenici yetkinlik öğrenemez; yalnız başlangıç eğilimini büyütür.
// Ölçülen sonuç: son 11 yazımın 11'i tek uzmana gitti (ve bu bir erişilebilirlik
// artefaktı değildi — 11 turun 9'unda üç uzman da mevcuttu).
//
// Buradaki puan modelden BAĞIMSIZ: "bu cevap gerçekten getirilen kaynaklara mı
// dayanıyor?" sorusunun deterministik, LLM'siz, string/küme matematiğiyle yanıtı.
// askShared zaten her turda ÜÇ uzmanın cevabını da hesaplıyor → üçünü puanlamak
// sıfır ek maliyet ve gerçek bir etiket verir.
//
// SINIR: Türkçe için sözcük kökleyici (stemmer) yok, bu yüzden `overlap` çekimli
// biçimleri eksik kredilendirir. Bu yüzden ağırlığı düşük (0.15); sinyalin çoğu
// (0.70) doğrulanabilir atıflardan gelir.
import type { AskSource } from "./brain-ask";
import { EXPERTS, type Candidate } from "./brain-formulas";

export interface AnswerScore {
  score: number;
  cites: number;
  validCites: number;
  /** Atıfların ne kadarı GERÇEK bir kaynağa denk geliyor (uydurma atıf cezası). */
  grounded: number;
  lengthBand: number;
  overlap: number;
  abstained: boolean;
}

const ABSTAIN = /BİLGİ_YOK|BILGI_YOK/;
const CITE = /\[mem:([^\]\s]{1,120})\]/g;

/**
 * L33 — an expert that FAILED did not give an opinion.
 *
 * Observed live: the odysseus seat returned `{"ok":false,"output":{"error":"fetch failed"},
 * "diff":"","applied":false,"halt":false}`. That is a tool envelope reporting its own failure,
 * but because it is non-empty text, mixtureSelect counted it as a usable candidate, `degraded`
 * came back EMPTY, and the string was carried into expertAnswers to be rendered in the vault
 * as that expert's view. The panel could not tell a dead member from a quiet one.
 *
 * Detection is deliberately narrow: a JSON envelope that declares failure, or a bare transport
 * error. Prose that merely discusses errors is NOT a failure — an expert explaining `fetch
 * failed` to the user is doing its job. Hence the requirement that the whole payload parse as
 * a failure envelope, rather than a substring match anywhere in the text.
 */
export function isFailurePayload(text: string): boolean {
  const s = String(text ?? "").trim();
  if (!s) return true;
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const j = JSON.parse(s);
      const o = Array.isArray(j) ? j[0] : j;
      if (o && typeof o === "object") {
        if (o.ok === false || o.success === false) return true;
        // `{error: ...}` with no answer-bearing field is a failure, not a reply.
        const err = (o as any).error ?? (o as any).output?.error;
        if (err && !(o as any).answer && !(o as any).text && !(o as any).content) return true;
      }
    } catch { /* not JSON after all — fall through to the prose checks */ }
  }
  // A bare transport error with no surrounding explanation.
  if (/^(fetch failed|econnrefused|etimedout|socket hang up|network error)\.?$/i.test(s)) return true;
  return false;
}

/** Why an expert is not participating — phrased for a human reading the vault note. */
export function failureReason(text: string): string {
  const s = String(text ?? "").trim();
  if (!s) return "boş cevap";
  try {
    const j = JSON.parse(s);
    const o = Array.isArray(j) ? j[0] : j;
    const err = o?.error ?? o?.output?.error;
    if (err) return `upstream: ${String(typeof err === "string" ? err : JSON.stringify(err)).slice(0, 120)}`;
    if (o?.ok === false || o?.success === false) return "upstream ok:false";
  } catch { /* not JSON */ }
  return s.slice(0, 120);
}

/** Cevaptaki [mem:ID] atıfları — sırayı koruyarak tekilleştirilmiş. */
export function citationIds(answer: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(answer ?? "").matchAll(CITE)) {
    const id = m[1];
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * RAG-Seq ağırlıklandırmasının atıf-koruma metriği ∈ [0,1] | undefined.
 *
 * YALNIZ ağırlıklandırmanın FİİLEN kontrol ettiğini ölçer: retrieval setinde OLAN
 * (yani weightedContext'in tutabileceği/düşürebileceği) atıflanmış kaynakların ne
 * kadarı ağırlıklı bağlamda kaldı. Küme-DIŞI atıf (cevabın getirilmemiş bir id'yi
 * göstermesi) ragseq-weighting'in suçu DEĞİL → yok sayılır.
 *
 * KÖK HATA (canlı ölçüldü): eski satır-içi metrik `kept/cited.length` küme-dışı atıfı
 * sahte retention=0 sayıp candidate→autonomous'u sahte-mükemmel (vacuous 1.0) baseline'a
 * takıyordu. Küme-içi atıf yoksa metrik BELİRSİZ (undefined) döner → summarize onu eler,
 * ortalamayı ve baseline'ı kirletmez (dürüst, like-for-like karşılaştırma).
 */
export function citedRetentionInSet(
  citedIds: string[], sourceIds: string[], ctxText: string,
): number | undefined {
  const inSet = new Set(sourceIds);
  const relevant = citedIds.filter((id) => inSet.has(id));
  if (!relevant.length) return undefined; // ağırlıklandırma hakkında bilgi taşımaz
  const kept = relevant.filter((id) => ctxText.includes(`[mem:${id}]`)).length;
  return kept / relevant.length;
}

/** İçerik belirteçleri — noktalama atılır, 3+ harfli olanlar kalır. */
const tokens = (s: string): string[] =>
  String(s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3);

/** Uzunluk bandı: çok kısa cevap bilgi taşımaz, çok uzun cevap savurur. */
function lengthBandOf(n: number): number {
  if (n < 40) return 0;
  if (n < 120) return (n - 40) / 80;      // 40→120 arası rampa
  if (n <= 800) return 1;                  // sağlıklı band
  if (n >= 2000) return 0.3;               // savurgan
  return 1 - 0.7 * ((n - 800) / 1200);
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Bir uzman cevabının dışsal kalite puanı ∈ [0,1].
 *
 * Ağırlıklar: doğrulanmış atıf 0.45 · temellendirme oranı 0.25 · uzunluk 0.15 ·
 * içerik örtüşmesi 0.15. Abstain/boş → SERT 0 (kısmi kredi yok: cevap vermemek
 * bir cevap değildir).
 */
export function scoreAnswer(answer: string, sources: AskSource[]): AnswerScore {
  const text = String(answer ?? "").trim();
  const abstained = !text || ABSTAIN.test(text);
  if (abstained) {
    return { score: 0, cites: 0, validCites: 0, grounded: 0, lengthBand: 0, overlap: 0, abstained: true };
  }

  const ids = citationIds(text);
  const known = new Set(sources.map((s) => s.id));
  const validCites = ids.filter((id) => known.has(id)).length;
  // Uydurma atıf CEZALIDIR: atıf var ama hiçbiri gerçek değilse grounded = 0.
  const grounded = ids.length ? validCites / ids.length : 0;

  // Atıf getirisi 2'de doyar — atıf spam'i ödüllendirilmesin.
  const citeCredit = Math.min(1, validCites / 2);

  const lengthBand = lengthBandOf(text.length);

  const corpus = new Set(tokens(sources.map((s) => s.excerpt).join(" ")));
  const ansTokens = tokens(text);
  const overlap = ansTokens.length && corpus.size
    ? ansTokens.filter((t) => corpus.has(t)).length / ansTokens.length
    : 0;

  const score = clamp01(0.45 * citeCredit + 0.25 * grounded + 0.15 * lengthBand + 0.15 * overlap);
  return {
    score: Number(score.toFixed(4)),
    cites: ids.length,
    validCites,
    grounded: Number(grounded.toFixed(4)),
    lengthBand: Number(lengthBand.toFixed(4)),
    overlap: Number(overlap.toFixed(4)),
    abstained: false,
  };
}

/** Üç uzmanın puanı, EXPERTS sırasında. Erişilemez uzman 0 alır. */
export function scoreAll(candidates: Candidate[], sources: AskSource[]): number[] {
  return EXPERTS.map((e) => {
    const c = candidates.find((x) => x.expert === e);
    if (!c || !c.available) return 0;
    return scoreAnswer(c.answer, sources).score;
  });
}
