// ε-greedy KEŞİF — çökmüş gate'in kendi aleyhine kanıt toplayabilmesi için.
//
// Kusur G'nin ikinci yarısı: gate hep argmax'ı seçerse, kaybeden uzmanların cevabı
// hiç PUANLANMAZ ve eğitim verisi tek uzmandan gelir. Bu, doğru etiketle bile
// (bkz. brain-answer-score.ts) öz-doğrulamayı sürdürürdü. Ara sıra argmax DIŞINI
// seçmek, gate'in "yanılıyor muyum?" sorusunu ölçebilmesinin tek yolu.
//
// `Math.random` YOK — rng enjekte edilir (brain-shadow.ts:38 deseni), böylece
// testler tekrarlanabilir ve tur davranışı sorudan türetilebilir.

/** FNV-1a 32-bit — metinden deterministik tohum. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — küçük, hızlı, tohumlanabilir PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ExploreOpts {
  /** Keşif olasılığı [0,1]. 0 = keşif yok (bugünkü davranışla bit-aynı). */
  epsilon: number;
  rng: () => number;
}

export interface ExploreResult {
  index: number;
  explored: boolean;
}

/**
 * Erişilebilir uzmanlar arasından seç: ε olasılıkla argmax DIŞINDAN rastgele,
 * aksi hâlde argmax. Hiç erişilebilir uzman yoksa index = -1.
 *
 * ε=0 ⇒ daima argmax — sıfır-gerileme garantisi (canlı HTTP yolu bunu kullanır;
 * kullanıcı sorgusu keşif kurbanı olmaz).
 */
export function exploreSelect(w: number[], available: boolean[], opts: ExploreOpts): ExploreResult {
  const idx = w.map((_, i) => i).filter((i) => available[i]);
  if (idx.length === 0) return { index: -1, explored: false };

  let best = idx[0];
  for (const i of idx) if ((w[i] ?? 0) > (w[best] ?? 0)) best = i;

  const eps = Number.isFinite(opts.epsilon) ? Math.min(1, Math.max(0, opts.epsilon)) : 0;
  const others = idx.filter((i) => i !== best);
  if (eps <= 0 || others.length === 0) return { index: best, explored: false };

  if (opts.rng() < eps) {
    const pick = others[Math.min(others.length - 1, Math.floor(opts.rng() * others.length))];
    return { index: pick, explored: true };
  }
  return { index: best, explored: false };
}
