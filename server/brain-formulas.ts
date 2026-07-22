// Ortak-brain formülleri (~/Desktop/formüller.md) — matematiğin GERÇEK kod karşılığı.
// Saf, bağımlılıksız, fixture-testli: her fonksiyon dokümandaki bir formüle birebir
// karşılık gelir (docs/BRAIN-FORMULAS.md eşleme tablosu).
//
//   Formül 2   p_ret(z|x) = exp(qᵀd(z)) / Σ_z' exp(qᵀd(z'))   → retrievalProbabilities
//   Formül 3b  w_j(x)     = softmax(W_g q + b_g)               → gateLogits + gateWeights
//              p_final    = Σ_j w_j p_j(y|x)                   → expectedMixture / mixtureSelect
//   Formül 3c  q*         = q + λ·p_u                          → profileVector + personalizeQuery
//
// DÜRÜSTLÜK NOTU: tam p_final token-logprob ister; yerel/keyless sağlayıcılar logprob
// vermez. Bu yüzden çalışan biçim `mixtureSelect` = w_j ağırlıklı SEÇİM (mevcut olmayan
// uzmanlar üzerinden renormalize). expectedMixture matematiğin kendisidir ve logprob
// eriştiğimiz gün doğrudan kullanılır — formül kılık değiştirmiyor, yaklaşım işaretli.

/** Ortak-brain uzmanları — sıra gate vektörlerinin sırasıdır (W satırları bu sırada). */
export const EXPERTS = ["ollamas", "ecym", "odysseus", "claudecode"] as const;
export type Expert = (typeof EXPERTS)[number];

/** Sayısal-kararlı softmax (max çıkarımı). T = sıcaklık: <1 keskinleştirir, >1 düzleştirir. */
export function softmax(scores: number[], temperature = 1): number[] {
  if (scores.length === 0) return [];
  const t = temperature > 0 ? temperature : 1;
  const scaled = scores.map((s) => s / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Formül 2: retrieval olasılık dağılımı. Girdi = qᵀd(z) iç-çarpım skorları
 *  (ya da recall skorları — sıralama aynı uzayda kaldığı sürece geçerli). */
export function retrievalProbabilities(innerProducts: number[], temperature = 1): number[] {
  return softmax(innerProducts, temperature);
}

/** L2 normalize; sıfır vektör güvenli (norm 0 → aynen döner). */
export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v.slice();
}

/** Formül 3c: p_u = E_ψ(historik) — geçmiş gömme vektörlerinin normalize ortalaması. */
export function profileVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const d = vectors[0].length;
  const mean = Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d && i < v.length; i++) mean[i] += v[i];
  return l2normalize(mean.map((x) => x / vectors.length));
}

/** Formül 3c: q* = q + λ·p_u. λ=0 → kişiselleştirme kapalı (q aynen döner). */
export function personalizeQuery(q: number[], profile: number[], lambda: number): number[] {
  if (!lambda || profile.length === 0) return q.slice();
  return q.map((x, i) => x + lambda * (profile[i] ?? 0));
}

/** Formül 3b: g_φ(q) = W_g q + b_g (uzman başına bir logit). */
export function gateLogits(qEmb: number[], W: number[][], b: number[]): number[] {
  return W.map((row, j) => row.reduce((acc, wi, i) => acc + wi * (qEmb[i] ?? 0), 0) + (b[j] ?? 0));
}

/** Formül 3b: w_j(x) = softmax(g_φ(q)). */
export function gateWeights(logits: number[], temperature = 1): number[] {
  return softmax(logits, temperature);
}

// Soğuk başlangıç yönlendirmesi: gate öğrenmeden ÖNCE soru-tipi sinyalleri ağırlık verir.
// Öğrenme ilerledikçe W_g baskın gelir (bias sabit kalır, logit büyür).
const SIGNALS: Record<Expert, RegExp> = {
  ollamas: /\b(kod|code|modül|module|route|api|test|commit|repo|typescript|server|brain|import|fonksiyon|schema|env)\b/iu,
  ecym: /\b(terminal|komut|command|shell|disk|klasör|dosya|launchd|servis|makbook|macbook|sistem|kur|çalıştır|başlat)\b/iu,
  odysseus: /\b(araştır|research|analiz|derin|uzun|rapor|karşılaştır|strateji|plan|neden|niçin|açıkla)\b/iu,
  claudecode: /\b(review|incele|pr|pull.?request|refactor|debug|hata.?ayıkla|mimari|architecture|güvenlik|security|optimize|iyileştir|düzelt|git|rebase|merge|diff)\b/iu,
};

/** Soru metninden uzman-başı bias vektörü (soğuk başlangıç yönlendirmesi). */
export function heuristicBias(question: string, strength = 0.8): number[] {
  return EXPERTS.map((e) => (SIGNALS[e].test(question || "") ? strength : 0));
}

/** Formül: p_final = Σ_j w_j p_j — saf matematik. Logprob erişimi olduğu anda
 *  doğrudan kullanılacak beklenen-değer hesabı. */
export function expectedMixture(pj: number[], w: number[]): number {
  return pj.reduce((acc, p, j) => acc + p * (w[j] ?? 0), 0);
}

export interface Candidate {
  expert: Expert | string;
  answer: string;
  available: boolean;
}

export interface MixtureResult {
  expert: string;
  answer: string;
  weights: Record<string, number>;
  degraded: string[];
}

export interface Veto { from: string; to: string; delta: number; fromScore: number; toScore: number }

/** Veto eşiği. 999 (ya da ∞) = veto tamamen kapalı → davranış bit-aynı (kill-switch). */
export const vetoDelta = (env: { BRAIN_VETO_DELTA?: string } = process.env): number => {
  const n = Number(env.BRAIN_VETO_DELTA);
  return Number.isFinite(n) && n >= 0 ? n : 0.15;
};

/**
 * L34 — measured quality may overrule the gate.
 *
 * askShared already scores EVERY expert's answer externally (brain-answer-score: grounded
 * citations, corpus overlap, abstention). Until now that number was only a training label:
 * selection went to the gate's argmax. Measured live, that meant eCym scoring 0.881 lost to
 * ollamas scoring 0.694, and every recorded run in the ledger was won by the same expert —
 * not because it was better, but because the gate never let anyone else through.
 *
 * The gate is NOT modified and offline training is untouched. This is a guard on top: when
 * another usable expert beats the gate's pick by a clear margin, quality wins and the swap is
 * recorded so the gate's error rate becomes measurable instead of invisible.
 *
 * Only candidates that are actually usable can win — a failed seat (L33) scores 0 and is
 * excluded, so this can never promote an error payload.
 */
export function qualityVeto(
  scores: Record<string, number>,
  gatePick: string,
  usable: string[],
  threshold = vetoDelta(),
): Veto | null {
  if (!gatePick || !Number.isFinite(threshold)) return null;
  const eligible = usable.filter((e) => e !== gatePick);
  if (!eligible.length) return null;
  const gateScore = scores[gatePick] ?? 0;
  // Ties resolve to the gate: a veto must be an improvement, not a coin flip.
  let best = { expert: "", score: -Infinity };
  for (const e of eligible) {
    const s = scores[e] ?? 0;
    if (s > best.score) best = { expert: e, score: s };
  }
  const delta = best.score - gateScore;
  // `delta > 0` is required independently of the threshold: with threshold 0 a dead-even tie
  // would otherwise flip the winner for no measured reason. A veto must be an improvement.
  if (delta <= 0 || delta < threshold) return null;
  return {
    from: gatePick, to: best.expert,
    delta: Number(delta.toFixed(4)),
    fromScore: Number(gateScore.toFixed(4)), toScore: Number(best.score.toFixed(4)),
  };
}

/** Çalışan p_final biçimi: erişilebilir uzmanlar üzerinden ağırlık renormalize edilir,
 *  en yüksek w_j'li cevap seçilir. Hiçbiri yoksa boş sonuç (çağıran abstain eder). */
export function mixtureSelect(candidates: Candidate[], w: number[]): MixtureResult {
  const weights: Record<string, number> = {};
  const degraded: string[] = [];
  let live = 0;
  candidates.forEach((c, j) => {
    const wj = w[j] ?? 0;
    if (c.available && c.answer?.trim()) live += wj;
    else degraded.push(String(c.expert));
  });
  let best: { expert: string; answer: string; w: number } | null = null;
  candidates.forEach((c, j) => {
    const raw = w[j] ?? 0;
    const usable = c.available && !!c.answer?.trim();
    const norm = usable && live > 0 ? raw / live : 0;
    weights[String(c.expert)] = Number(norm.toFixed(4));
    if (usable && (!best || norm > best.w)) best = { expert: String(c.expert), answer: c.answer, w: norm };
  });
  const picked = best as { expert: string; answer: string; w: number } | null;
  return { expert: picked?.expert ?? "", answer: picked?.answer ?? "", weights, degraded };
}

/** Online gate kalibrasyonu (perceptron-benzeri): seçilen/başarılı uzmanın logiti
 *  bu sorgu yönünde artar, diğerleri hafifçe azalır. Loop her turda çağırır. */
export function updateGate(
  W: number[][],
  b: number[],
  qEmb: number[],
  chosenIdx: number,
  lr = 0.05,
): { W: number[][]; b: number[] } {
  const q = l2normalize(qEmb);
  const W2 = W.map((row, j) =>
    row.map((wi, i) => wi + (j === chosenIdx ? lr : -lr / Math.max(1, W.length - 1)) * (q[i] ?? 0)),
  );
  const b2 = b.map((bj, j) => bj + (j === chosenIdx ? lr : -lr / Math.max(1, b.length - 1)) * 0.1);
  return { W: W2, b: b2 };
}

/** Boş gate (öğrenilmemiş) — d boyutlu, uzman sayısı kadar satır. */
export function emptyGate(d: number): { W: number[][]; b: number[] } {
  return { W: EXPERTS.map(() => Array(d).fill(0)), b: EXPERTS.map(() => 0) };
}

// ---------------------------------------------------------------------------
// Formül 3a — RAG-Sequence:  p_RAG-Seq(y|x) = Σ_z p_ret(z|x) · p_gen(y|x,z)
//
// DÜRÜSTLÜK NOTU: tam biçim her belge için AYRI bir üretim koşup olasılıkları
// toplamayı ister — üç uzman × k belge = kat kat LLM çağrısı, MacBook'ta ne ısı
// ne süre bütçesi kaldırır. Çalışan biçim, p_ret'i belgenin BAĞLAMDAKİ PAYINA
// çevirir: yüksek olasılıklı belge daha önce ve daha uzun yer alır, düşük olan
// susturulmaz ama kısalır. Yani Σ_z ağırlıklandırması üretimden ÖNCE, bağlam
// katmanında uygulanır. Formül kılık değiştirmiyor; yaklaşım işaretli.
// ---------------------------------------------------------------------------

/** Formül 3a: retrieval skorlarından p_ret dağılımı (F2 ile aynı softmax). */
export function sequenceWeights(scores: number[], temperature = 1): number[] {
  return retrievalProbabilities(scores, temperature);
}

/** Bir kaynağın bağlamda görünecek asgari karakteri — p_ret düşük olsa bile
 *  kaynak TAMAMEN susturulmaz (aksi halde tek belge bağlamı ele geçirir). */
const MIN_SHARE = 80;

export interface WeightedSource {
  id: string;
  excerpt: string;
}

/** Formül 3a çalışan biçimi: kaynakları p_ret'e göre sırala, bütçeyi p_z oranında
 *  paylaştır. Çıktı doğrudan prompt'a giren KAYNAKLAR bloğudur. */
export function weightedContext(sources: WeightedSource[], p: number[], budget: number): string {
  if (!sources.length) return "";
  const order = sources
    .map((s, i) => ({ s, p: p[i] ?? 0 }))
    .sort((a, b) => b.p - a.p);

  const parts: string[] = [];
  let spent = 0;
  for (const { s, p: pz } of order) {
    const share = Math.max(MIN_SHARE, Math.floor(budget * pz));
    const room = Math.max(0, budget - spent);
    if (room <= 0) break;
    const take = Math.min(share, room, s.excerpt.length);
    if (take <= 0) continue;
    parts.push(`[mem:${s.id}] ${s.excerpt.slice(0, take)}`);
    spent += take;
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Formül 4 — Retrieval-as-Attention (ReAtt):
//   A^{q,d}[t,s] = Q_t · K_s      (sorgu-belge dikkat matrisi)
//   r_h(q,d)     = avg_{t∈q}( max_{s∈d} A[t,s] )
//   r(q,d)       = Σ_h P^head_h · r_h(q,d)
//
// DÜRÜSTLÜK NOTU: gerçek ReAtt bunu Transformer'ın İÇİNDE, TOKEN düzeyinde ve
// birden çok başlıkla (head) yapar; öğrenilebilir P^head ile tek bir
// "retrieval-head" seçilir. Bizde ne token-düzeyi dikkat matrisine ne de
// başlıklara erişim var — elimizde yalnız cümle/parça gömmeleri var. Bu yüzden
// burada uygulanan biçim CÜMLE düzeyinde ve TEK başlıklıdır (P^head = 1):
// avg-max yapısı korunur, çözünürlük düşer. `expectedMixture` gibi bu da
// işaretli bir yaklaşımdır — formül kılık değiştirmiyor, sınırı yazılıyor.
// ---------------------------------------------------------------------------

/** İki vektörün kosinüs benzerliği; sıfır vektör güvenli (0 döner). */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Formül 4 (cümle düzeyi): her sorgu parçası için belgedeki EN İYİ eşleşme
 *  bulunur, sonra bunların ORTALAMASI alınır. Max sayesinde uzun belgeler
 *  alakasız parçalarıyla cezalandırılmaz; avg sayesinde sorgunun her yönü sayılır. */
export function avgMaxScore(qChunks: number[][], dChunks: number[][]): number {
  if (!qChunks.length || !dChunks.length) return 0;
  let sum = 0;
  for (const qc of qChunks) {
    let best = 0;
    for (const dc of dChunks) {
      const s = cosine(qc, dc);
      if (s > best) best = s;
    }
    sum += best;
  }
  return sum / qChunks.length;
}

// ---------------------------------------------------------------------------
// Formül 3a/3b — GERÇEK p_final:  p_final(y|x) = Σ_j w_j(x) · p_j(y|x)
//
// Dosya başındaki dürüstlük notu "logprob eriştiğimiz gün doğrudan kullanılır"
// diyordu. FAZ-0 ÖLÇÜMÜ (scripts/probe-logprobs.ts, 2026-07-20): ollama 0.32.1
// `/v1/chat/completions` per-token logprob VERİYOR; `/api/chat` VERMİYOR.
// Yani o gün geldi — ama KISMEN: odysseus MCP köprüsünden geldiği için logprob
// üretemez. Bu yüzden p_final yalnız logprob DÖNEN uzmanlar üzerinde hesaplanır
// ve kapsama (coverage) açıkça raporlanır. Kapsama düşükse sayı "tam p_final"
// değildir ve öyle sunulmamalıdır.
// ---------------------------------------------------------------------------

/** Dizi olasılığının uzunluktan bağımsız ölçüsü: ORTALAMA token logprob'u.
 *  Toplam kullanılsaydı uzun cevap sistematik olarak cezalanırdı. */
export function sequenceLogprob(tokenLogprobs: number[]): number | null {
  if (!tokenLogprobs.length) return null;
  const sum = tokenLogprobs.reduce((a, b) => a + b, 0);
  return sum / tokenLogprobs.length;
}

export interface PFinalResult {
  /** Σ_j w_j p_j — yalnız logprob veren uzmanlar üzerinden. Hiçbiri yoksa null. */
  pFinal: number | null;
  /** Hangi uzmanlar hesaba katılabildi. */
  covered: boolean[];
  /** Katılan uzmanların toplam w ağırlığı — sonucun ne kadar "tam" olduğu. */
  coverage: number;
}

/** Formül: p_final = Σ_j w_j·p_j, p_j = exp(ortalama logprob).
 *  Logprob vermeyen uzman (null) toplamdan DIŞLANIR — sıfır saymak onu
 *  "kesinlikle yanlış" ilan etmek olurdu, oysa yalnızca ÖLÇÜLEMEDİ. */
export function perTokenMixture(avgLogprobs: (number | null)[], w: number[]): PFinalResult {
  const covered = avgLogprobs.map((lp) => lp !== null && Number.isFinite(lp));
  let pFinal = 0;
  let coverage = 0;
  for (let j = 0; j < avgLogprobs.length; j++) {
    if (!covered[j]) continue;
    pFinal += (w[j] ?? 0) * Math.exp(avgLogprobs[j] as number);
    coverage += w[j] ?? 0;
  }
  return {
    pFinal: coverage > 0 ? pFinal : null,
    covered,
    coverage: Number(coverage.toFixed(6)),
  };
}
