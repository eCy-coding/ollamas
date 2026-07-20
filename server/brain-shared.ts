// Ortak-brain çok-uzman pipeline (~/Desktop/formüller.md §3b): TEK retrieval
// (R_k(x)) → aynı bağlam üç uzmana (ollamas · eCym · odysseus) → MoE gate w_j(x)
// → p_final seçimi. Kişiselleştirme (q* = q + λ·p_u) retrieval'dan ÖNCE uygulanır.
// Erişilemeyen uzman degrade edilir ve ağırlıklar kalanlar üzerinde renormalize olur —
// hiçbir uzman zorunlu değildir (degrade-alive sözleşmesi).
import { gatherContext, type AskDeps, type AskSource } from "./brain-ask";
import {
  EXPERTS, emptyGate, gateLogits, gateWeights, heuristicBias, mixtureSelect,
  personalizeQuery, profileVector, updateGate, type Expert,
} from "./brain-formulas";

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
  /** Gate güncellemesini kalıcılaştırma (loop kullanır). */
  saveGate?: (g: Gate) => void;
  /** Kişiselleştirilmiş vektörle recall (q* desteği). Yoksa normal recall kullanılır. */
  recallVec?: (vec: number[], opts: { k?: number; ns?: string }) => Promise<unknown>;
}

/** Uzman başına sert zaman sınırı (bounded-race deseni): yerel model / uzak halka
 *  asılırsa TÜM tur takılmasın — süresi dolan uzman "erişilemez" sayılır. */
const expertTimeoutMs = (): number => Number(process.env.BRAIN_EXPERT_TIMEOUT_MS) || 25_000;

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

  // (3c) Kişiselleştirme: q* = q + λ·p_u — profil vektörü varsa retrieval o vektörle.
  let personalized = false;
  let qVec: number[] | null = null;
  const lambda = personalizeLambda();
  if (lambda > 0 && deps.embed && deps.profileVectors && deps.recallVec) {
    try {
      const history = await deps.profileVectors();
      if (history.length) {
        const pu = profileVector(history);
        qVec = personalizeQuery(await deps.embed(q), pu, lambda);
        personalized = true;
      }
    } catch { /* profil best-effort — kişiselleştirme yoksa düz q ile devam */ }
  }

  // (2) TEK retrieval: R_k(x) tüm uzmanlara AYNI gider.
  const ctx = await gatherContext(q, deps);
  const userMsg = `SORU: ${q}\n\nKAYNAKLAR:\n${ctx.context}`;
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
  const gate = deps.gate ?? emptyGate(qVec?.length ?? 8);
  const logits = gateLogits(qVec ?? [], gate.W, gate.b).map((l, j) => l + heuristicBias(q)[j]);
  const w = gateWeights(logits);
  const picked = mixtureSelect(answers, w);

  const confidence = ctx.sources.length
    ? Number((ctx.sources.reduce((a, s) => a + (s.conf ?? s.score ?? 0), 0) / ctx.sources.length).toFixed(3))
    : 0;

  if (!picked.answer) {
    return {
      answer: "Kayıtlarımda bu konuda güvenilir bilgi yok.",
      expert: "", weights: picked.weights, sources: ctx.sources, confidence: 0,
      mode: ctx.mode, hops: ctx.hops, degraded: picked.degraded, personalized, abstained: true,
    };
  }

  // Online gate kalibrasyonu: kazanan uzman bu sorgu yönünde güçlenir.
  if (deps.saveGate && qVec) {
    try {
      deps.saveGate(updateGate(gate.W, gate.b, qVec, EXPERTS.indexOf(picked.expert as Expert), 0.05));
    } catch { /* kalibrasyon best-effort */ }
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
  };
}
