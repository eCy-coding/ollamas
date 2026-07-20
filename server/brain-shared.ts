// Ortak-brain çok-uzman pipeline (~/Desktop/formüller.md §3b): TEK retrieval
// (R_k(x)) → aynı bağlam üç uzmana (ollamas · eCym · odysseus) → MoE gate w_j(x)
// → p_final seçimi. Kişiselleştirme (q* = q + λ·p_u) retrieval'dan ÖNCE uygulanır.
// Erişilemeyen uzman degrade edilir ve ağırlıklar kalanlar üzerinde renormalize olur —
// hiçbir uzman zorunlu değildir (degrade-alive sözleşmesi).
import { gatherContext, type AskDeps, type AskSource } from "./brain-ask";
import {
  EXPERTS, emptyGate, gateLogits, gateWeights, heuristicBias, mixtureSelect,
  personalizeQuery, profileVector, l2normalize, sequenceWeights, weightedContext,
  type Candidate, type Expert, type MixtureResult,
} from "./brain-formulas";
import { scoreAll } from "./brain-answer-score";
import { exploreSelect } from "./brain-explore";

/** Boyut koruması: `gateLogits` eksik boyutu `?? 0` ile doldurur, yani 8-boyutlu bayat
 *  bir gate 768-boyutlu q ile SESSİZCE yalnız ilk 8 boyutu kullanırdı. Uyuşmazlıkta
 *  öğrenilmiş gate'i kullanmaktansa sıfırdan başlarız — sessiz bozulmaktansa görünür
 *  soğuk başlangıç. Saf ve dışa açık: davranış doğrudan test edilebilsin. */
export function usableGate(supplied: Gate | undefined, dim: number): Gate {
  return supplied && supplied.W[0]?.length === dim ? supplied : emptyGate(dim);
}

/** Keşif seçimi: ağırlıklar yine renormalize edilir ama KAZANAN zorlanır.
 *  mixtureSelect argmax'ı seçer; keşifte bilinçli olarak argmax DIŞINI istiyoruz. */
function forcePick(candidates: Candidate[], w: number[], index: number): MixtureResult {
  const base = mixtureSelect(candidates, w);
  const c = candidates[index];
  if (!c || !c.available || !c.answer?.trim()) return base;
  return { ...base, expert: String(c.expert), answer: c.answer };
}

export interface SharedAskResult {
  answer: string;
  expert: string;
  weights: Record<string, number>;
  sources: AskSource[];
  confidence: number;
  mode: "hybrid" | "lexical";
  hops: number;
  degraded: string[];
  personalized: boolean;
  abstained?: boolean;
  /** Uzman başına DIŞSAL kalite puanı (EXPERTS sırasında) — gate'in öğrenme etiketi. */
  scores?: Record<string, number>;
  /** Bu tur keşif amaçlı argmax DIŞI bir uzman mı seçildi. */
  explored?: boolean;
  /** Formül 3a: kaynak başına p_ret(z|x) — bağlam payının dayanağı. */
  pRet?: number[];
}

export interface Gate { W: number[][]; b: number[] }

export interface SharedDeps extends AskDeps {
  /** Uzman üreticileri; her biri aynı (system,user) mesajlarını alır. Eksik olan
   *  uzman "erişilemez" sayılır (weights renormalize). */
  experts: Partial<Record<Expert, (messages: { role: string; content: string }[]) => Promise<string>>>;
  /** Kişiselleştirme için kullanıcı geçmişi gömme vektörleri (p_u kaynağı). */
  profileVectors?: () => Promise<number[][]>;
  /** Sorgu gömme — q* hesaplamak için (yoksa kişiselleştirme atlanır). */
  embed?: (text: string) => Promise<number[]>;
  /** Öğrenilen gate; yoksa boş (uniform + heuristik bias). */
  gate?: Gate;
  /** Gate güncellemesini kalıcılaştırma. askShared BUNU ARTIK ÇAĞIRMAZ (öz-doğrulama
   *  kaldırıldı); eğitim toplu ve ayrıdır (brain-gate-train.ts). Arayüzde kalıyor
   *  çünkü eğitim adımını koşturan çağıran (loop) hâlâ gate'i yazar. */
  saveGate?: (g: Gate) => void;
  /** ε-greedy keşif oranı. 0 (varsayılan) ⇒ daima argmax, bit-aynı davranış. */
  epsilon?: number;
  /** Keşif için enjekte edilen rastgelelik (Math.random YOK — tekrarlanabilirlik). */
  rng?: () => number;
  /** Her turun DIŞSAL sonucu — gate eğitiminin ham verisi. */
  onOutcome?: (o: { q: number[]; scores: number[]; picked: number; explored: boolean }) => void;
  /** Formül 3a: bağlamı p_ret'e göre yeniden paylaştır. Varsayılan kapalı —
   *  `ragseq-weighting` yeteneği terfi edene dek canlıya inmez. */
  ragSeq?: boolean;
  // `recallVec` artık AskDeps'ten miras alınır. Buradaki yinelenen bildirim
  // `Promise<unknown>` dönüyordu; hiç çağrılmadığı için uyuşmazlık yıllarca
  // görünmedi. Tek tanım = tek doğruluk kaynağı.
}

/** Uzman başına sert zaman sınırı (bounded-race deseni): yerel model / uzak halka
 *  asılırsa TÜM tur takılmasın — süresi dolan uzman "erişilemez" sayılır. */
const expertTimeoutMs = (): number => Number(process.env.BRAIN_EXPERT_TIMEOUT_MS) || 25_000;

/** RAG-Seq bağlam bütçesi (karakter). Prompt'un kaynak bloğunun üst sınırı. */
const ragSeqBudget = (): number => Number(process.env.BRAIN_RAGSEQ_BUDGET) || 4000;

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`expert timed out after ${ms}ms`)), ms);
    (t as { unref?: () => void }).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const SHARED_PROMPT = `Sen ollamas ortak-brain uzmanısın. SADECE verilen KAYNAK kayıtlardan yararlanarak Türkçe, kısa ve net yanıtla.
Kurallar:
- Her iddiadan sonra [mem:ID] biçiminde kaynak belirt.
- Düşük-güven (conf≤0.5) kaynakları ihtiyatla kullan; çelişkide yüksek-güveni seç.
- Kaynaklarda cevap yoksa SADECE: BİLGİ_YOK
- Tahmin etme, süsleme yapma.`;

/** λ — kullanıcı profilinin retrieval'a etkisi (formül 3c). 0 = kapalı. */
export const personalizeLambda = (env: { BRAIN_PERSONALIZE_LAMBDA?: string } = process.env): number => {
  const n = Number(env.BRAIN_PERSONALIZE_LAMBDA);
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
};

export async function askShared(question: string, deps: SharedDeps): Promise<SharedAskResult> {
  const q = (question || "").trim();
  if (!q) return { answer: "", expert: "", weights: {}, sources: [], confidence: 0, mode: "hybrid", hops: 0, degraded: [], personalized: false, abstained: true };

  // (3c) Kişiselleştirme: q* = q + λ·p_u.
  //
  // ÖNEMLİ (2026-07-20 kök-düzeltme): burası eskiden `embed && profileVectors &&
  // recallVec` ÜÇÜNÜ birden şart koşuyordu. Hiçbir çağıran üçünü de vermediği için
  // qVec DAİMA null kalıyordu → gateLogits boş vektör alıyor → W_g hiç çarpılmıyor →
  // gate kalıcı olarak yalnız heuristicBias regex'iydi ve updateGate hiç çalışmadı
  // (gate.json dosyası hiç oluşmamıştı). Artık koşullar AYRIŞTI:
  //   • embed varsa           → qVec üretilir, gate GERÇEKTEN öğrenir.
  //   • profil de varsa       → q* = q + λ·p_u (kişiselleştirme).
  //   • recallVec de varsa    → q* retrieval'ı GERÇEKTEN sürer (yoksa yalnız gate'i besler).
  // Böylece eksik bağımlılık tüm zinciri öldürmez, sadece kendi katkısını düşürür.
  let personalized = false;
  let qVec: number[] | null = null;
  const lambda = personalizeLambda();
  if (deps.embed) {
    try {
      qVec = await deps.embed(q);
      if (lambda > 0 && deps.profileVectors) {
        const history = await deps.profileVectors();
        if (history.length) {
          qVec = personalizeQuery(qVec, profileVector(history), lambda);
          // "personalized" YALNIZ q* gerçekten retrieval'ı sürdüyse doğrudur —
          // aksi halde rapor kendini kandırır.
          personalized = !!deps.recallVec;
        }
      }
    } catch { /* gömme best-effort — qVec null kalır, düz metin yoluyla devam */ }
  }

  // (2) TEK retrieval: R_k(x) tüm uzmanlara AYNI gider. q* varsa vektörle sürülür.
  const ctx = await gatherContext(q, deps, qVec);

  // (3a RAG-Sequence) p_ret dağılımı HER ZAMAN hesaplanır (bedava, raporlanır).
  // Bağlamın p_ret'e göre yeniden paylaştırılması ise yetenek bayrağına bağlı:
  // canlıya ancak terfi kapısından geçerek iner.
  const pRet = sequenceWeights(ctx.sources.map((s) => s.score ?? 0));
  const contextText = deps.ragSeq && ctx.sources.length
    ? weightedContext(ctx.sources, pRet, ragSeqBudget())
    : ctx.context;

  const userMsg = `SORU: ${q}\n\nKAYNAKLAR:\n${contextText}`;
  const messages = [
    { role: "system", content: SHARED_PROMPT },
    { role: "user", content: userMsg },
  ];

  // (3b) Uzman çıktıları — paralel, her biri best-effort.
  const answers = await Promise.all(
    EXPERTS.map(async (e) => {
      const fn = deps.experts[e];
      if (!fn) return { expert: e, answer: "", available: false };
      try {
        const raw = (await bounded(fn(messages), expertTimeoutMs()))?.trim() ?? "";
        const usable = !!raw && !/BİLGİ_YOK|BILGI_YOK/.test(raw);
        return { expert: e, answer: usable ? raw : "", available: usable };
      } catch {
        return { expert: e, answer: "", available: false };
      }
    }),
  );

  // (3b) w_j(x) = softmax(W_g q + b_g) + soğuk-başlangıç heuristik biası.
  // Boyut koruması: gateLogits eksik boyutu `?? 0` ile doldurur, yani 8-boyutlu bayat
  // bir gate 768-boyutlu q ile SESSİZCE ilk 8 boyutu kullanırdı. Uyuşmazlıkta öğrenilmiş
  // gate'i kullanmak yerine sıfırdan başlarız — sessiz bozulmaktansa görünür soğuk başlangıç.
  const dim = qVec?.length ?? 8;
  const gate = usableGate(deps.gate, dim);
  const bias = heuristicBias(q);
  // Gate YÖNE bakar, büyüklüğe değil: ham nomic vektörü |q|≈20 ve logitleri o oranda
  // şişirip heuristik biası ezerdi; ayrıca eğitim tarafı da normalize ediyor
  // (brain-gate-train.ts) — eğitim ve çıkarım AYNI temsilde olmalı.
  // Retrieval ham vektörü kullanmaya devam eder (normalize etmek recall'ı bozuyordu).
  const gateVec = qVec ? l2normalize(qVec) : [];
  const logits = gateLogits(gateVec, gate.W, gate.b).map((l, j) => l + (bias[j] ?? 0));
  const w = gateWeights(logits);

  // DIŞSAL etiket: üç uzmanın cevabı ZATEN hesaplandı → üçünü de puanlamak bedava.
  // Gate'in öğrenmesi gereken sinyal budur, kendi argmax'ı değil.
  const scores = scoreAll(answers, ctx.sources);
  const scoreMap = Object.fromEntries(EXPERTS.map((x, j) => [x, scores[j] ?? 0]));

  // (F3b keşif) ε olasılıkla argmax DIŞI bir uzman seçilir. Gerekçe: gate hep
  // argmax'ı seçerse kaybeden uzmanların cevabı hiç değerlendirilmez ve eğitim
  // verisi tek uzmandan gelir — doğru etiketle bile öz-doğrulama sürerdi.
  // ε=0 (varsayılan, canlı HTTP yolu) ⇒ davranış bit-aynı, sıfır gerileme.
  const epsilon = deps.epsilon ?? 0;
  const explore = epsilon > 0 && deps.rng
    ? exploreSelect(w, EXPERTS.map((e) => answers.find((a) => a.expert === e)?.available ?? false), { epsilon, rng: deps.rng })
    : { index: -1, explored: false };
  const picked = explore.explored && explore.index >= 0
    ? forcePick(answers, w, explore.index)
    : mixtureSelect(answers, w);

  const confidence = ctx.sources.length
    ? Number((ctx.sources.reduce((a, s) => a + (s.conf ?? s.score ?? 0), 0) / ctx.sources.length).toFixed(3))
    : 0;

  if (!picked.answer) {
    return {
      answer: "Kayıtlarımda bu konuda güvenilir bilgi yok.",
      expert: "", weights: picked.weights, sources: ctx.sources, confidence: 0,
      mode: ctx.mode, hops: ctx.hops, degraded: picked.degraded, personalized, abstained: true,
      scores: scoreMap, explored: explore.explored, pRet,
    };
  }

  // (F3b öğrenme) KALDIRILDI: burada eskiden `updateGate(..., indexOf(picked.expert))`
  // vardı — yani gate KENDİ argmax'ıyla eğitiliyordu. Etiketi kendi tahmini olan bir
  // öğrenici yetkinlik öğrenemez, yalnız başlangıç eğilimini büyütür. Ölçülen sonuç:
  // W satır L2 [0.358, 0.304, 0.660] ve son 11 yazımın 11'i tek uzman (üstelik 11 turun
  // 9'unda üç uzman da MEVCUTTU → erişilebilirlik artefaktı değil, öz-doğrulama).
  //
  // Yerine: üç uzmanın da cevabı DIŞSAL olarak puanlanır (brain-answer-score.ts) ve
  // ham sonuç deftere yazılır; eğitim ayrı ve toplu yapılır (brain-gate-train.ts,
  // cross-entropy + L2 tavanı). Bu fonksiyon artık gate'e YAZMAZ.
  if (deps.onOutcome && qVec) {
    try {
      deps.onOutcome({ q: qVec, scores, picked: EXPERTS.indexOf(picked.expert as Expert), explored: explore.explored });
    } catch { /* defter best-effort — turu bloklamaz */ }
  }

  return {
    answer: picked.answer,
    expert: picked.expert,
    weights: picked.weights,
    sources: ctx.sources,
    confidence,
    mode: ctx.mode,
    hops: ctx.hops,
    degraded: picked.degraded,
    personalized,
    scores: scoreMap,
    explored: explore.explored,
    pRet,
  };
}
