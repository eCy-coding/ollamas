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
export const EXPERTS = ["ollamas", "ecym", "odysseus"] as const;
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
