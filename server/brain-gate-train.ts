// MoE gate'inin GERÇEK eğitimi — cross-entropy, dışsal etiketle (formüller.md F3b).
//
// Eski `updateGate` (brain-formulas.ts) perceptron-benzeri bir dürtmeydi ve etiketi
// gate'in KENDİ argmax'ıydı → öz-doğrulama → tek uzmana çöküş (ölçüldü: W satır L2
// [0.358, 0.304, 0.660], son 11 yazımın 11'i tek uzman). Burada etiket dışsaldır:
// brain-answer-score.ts'in ürettiği, uzmanın cevabının kaynaklara dayanıp dayanmadığını
// ölçen puan. `updateGate` geriye dönük uyum için duruyor ama artık ÇAĞRILMIYOR.
//
// İki yapısal koruma:
//   • clipRows — hiçbir uzmanın satır normu tavanı geçemez, yani "kaçış" imkânsız.
//   • decay    — kanıtsız kalan ağırlık zamanla sönümlenir.
import { softmax, l2normalize } from "./brain-formulas";

export interface Gate { W: number[][]; b: number[] }

export interface OutcomeRow {
  at: number;
  turn: number;
  /** Sorgu gömme (q veya q*). */
  q: number[];
  /** EXPERTS sırasında dışsal kalite puanları ∈ [0,1]. */
  scores: number[];
}

export interface TrainOpts {
  lr: number;
  epochs: number;
  /** Satır başına azami L2 normu — kaçış koruması. */
  l2Cap: number;
  /** Ağırlık sönümü (epoch başına oran). */
  decay: number;
}

export const DEFAULT_TRAIN: TrainOpts = { lr: 0.05, epochs: 30, l2Cap: 0.5, decay: 0.01 };

/**
 * Puanlardan yumuşak hedef dağılımı. Hepsi 0 ise (hiçbir uzman işe yarar cevap
 * vermedi) null döner — o turdan öğrenilecek bir şey YOKTUR, uydurma etiket üretmeyiz.
 */
export function targetDistribution(scores: number[], temperature = 0.5): number[] | null {
  if (!scores.length || scores.every((s) => !Number.isFinite(s) || s <= 0)) return null;
  const t = temperature > 0 ? temperature : 1;
  return softmax(scores.map((s) => (Number.isFinite(s) ? s : 0) / t));
}

const logitsOf = (g: Gate, q: number[]): number[] =>
  g.W.map((row, j) => row.reduce((acc, wi, i) => acc + wi * (q[i] ?? 0), 0) + (g.b[j] ?? 0));

/** Ortalama cross-entropy — eğitimin gerçekten öğrendiğinin kanıtı bu sayının düşmesidir. */
export function crossEntropyLoss(g: Gate, rows: OutcomeRow[]): number {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const t = targetDistribution(r.scores);
    if (!t) continue;
    const p = softmax(logitsOf(g, r.q));
    // H(t, p) = -Σ t_j log p_j
    sum += -t.reduce((acc, tj, j) => acc + tj * Math.log(Math.max(p[j] ?? 0, 1e-12)), 0);
    n++;
  }
  return n ? sum / n : 0;
}

/** Satır başına L2 izdüşümü: normu tavanı aşan satır YÖNÜ KORUNARAK küçültülür. */
export function clipRows(W: number[][], cap: number): number[][] {
  if (!(cap > 0)) return W.map((r) => r.slice());
  return W.map((row) => {
    const n = Math.sqrt(row.reduce((a, x) => a + x * x, 0));
    if (n <= cap || n === 0) return row.slice();
    const k = cap / n;
    return row.map((x) => x * k);
  });
}

/**
 * Yumuşak-hedef softmax cross-entropy ile gate eğitimi.
 *   dL/dlogit_j = p_j − t_j   ·   dW_j = grad_j · q   ·   db_j = grad_j
 *
 * Girdi gate MUTASYONA UĞRAMAZ. Her epoch sonunda sönüm + tavan uygulanır.
 */
export function trainGate(
  init: Gate,
  rows: OutcomeRow[],
  opts: Partial<TrainOpts> = {},
): { gate: Gate; losses: number[] } {
  const o = { ...DEFAULT_TRAIN, ...opts };
  // YÖN yeterli, BÜYÜKLÜK zararlı. Canlı nomic vektörleri ham saklanıyor (|q|≈20,
  // retrieval için bilinçli tercih — commit 0bb0c64) ve birbirine çok benzer
  // (aynı dilde benzer sorular, kosinüs ~0.8+). Ham hâlde gradyan adımı |q|² ile
  // ölçeklenip aşırı büyüyor: gerçek defterle ölçüldü, kayıp 1.099 → 4.312'ye
  // IRAKSADI (sandbox metriği -0.598 ile yakaladı). Normalize edilince adım
  // boyutu girdiden bağımsız olur. Çıkarım tarafı da aynı temsili kullanmalı
  // (brain-shared.ts gateLogits'e l2normalize(qVec) verir) — yoksa eğitim ile
  // çıkarım farklı uzaylarda olur.
  const usable = rows
    .filter((r) => targetDistribution(r.scores) !== null && Array.isArray(r.q) && r.q.length > 0)
    .map((r) => ({ ...r, q: l2normalize(r.q) }));
  if (!usable.length) return { gate: { W: init.W.map((r) => r.slice()), b: init.b.slice() }, losses: [] };

  let W = init.W.map((r) => r.slice());
  let b = init.b.slice();
  const losses: number[] = [];

  for (let e = 0; e < o.epochs; e++) {
    // Toplu (batch) gradyan — küçük veri için kararlı.
    const gW = W.map((row) => row.map(() => 0));
    const gB = b.map(() => 0);

    for (const r of usable) {
      const t = targetDistribution(r.scores)!;
      const p = softmax(logitsOf({ W, b }, r.q));
      for (let j = 0; j < W.length; j++) {
        const grad = (p[j] ?? 0) - (t[j] ?? 0);
        if (grad === 0) continue;
        const row = gW[j];
        for (let i = 0; i < row.length; i++) row[i] += grad * (r.q[i] ?? 0);
        gB[j] += grad;
      }
    }

    const m = usable.length;
    W = W.map((row, j) => row.map((wi, i) => wi * (1 - o.lr * o.decay) - o.lr * (gW[j][i] / m)));
    b = b.map((bj, j) => bj - o.lr * (gB[j] / m));
    W = clipRows(W, o.l2Cap);
    losses.push(Number(crossEntropyLoss({ W, b }, usable).toFixed(6)));
  }

  return { gate: { W, b }, losses };
}
