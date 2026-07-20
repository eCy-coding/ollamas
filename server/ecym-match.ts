// eCym eşleşme regresyonu — 100 app komutu eklemenin mevcut komutları kaçırıp
// kaçırmadığını ölçen saf çekirdek.
//
// NEDEN GEREKLİ: eCym eşleştirme top-1 kosinüs, eşik 0.70. 105 app komutu korpusu
// 115→220 yapar (%91). Yeni bir app tetikleyicisi mevcut bir komuta 0.70+ kosinüsle
// DAHA YAKIN olup onu sessizce kaçırabilir. Çakışma harness'i (app-literacy.ts)
// yalnız KİMLİK çakışmasını yakalar ("aynı tetikleyici iki komutta"); bu ise
// "yakın ama aynı olmayan" kaymayı yakalar — ancak öğrettikten SONRA ölçülebilir.
//
// Saf ve testli: IO scripts/ecym-match-baseline.ts'te.

/** Sorgu → eşleşen komut id'si (eşleşme yoksa null). */
export type MatchMap = Record<string, string | null>;

export interface Regression {
  query: string;
  /** Teach ÖNCESİ eşleşen komut. */
  was: string;
  /** Teach SONRASI eşleşen komut (kaçırıldı → başka id ya da null). */
  now: string | null;
}

/**
 * SAF: teach öncesi/sonrası eşleşme haritalarını kıyasla, KAÇAN komutları döndür.
 *
 * Regresyon TANIMI: teach öncesi bir sorgu belirli bir komuta (`was`) eşleşiyordu,
 * teach sonrası artık ona eşleşmiyor (`now !== was`). Bu, kullanıcının yerleşik bir
 * komutunun app kartları yüzünden çalışmaz hâle geldiği anlamına gelir.
 *
 * Yalnız `before`'da GERÇEK bir eşleşme (null olmayan) olan sorgular sayılır:
 * eskiden de eşleşmeyen bir sorgunun hâlâ eşleşmemesi regresyon değildir.
 */
export function matchRegressions(before: MatchMap, after: MatchMap): Regression[] {
  const out: Regression[] = [];
  for (const [query, was] of Object.entries(before)) {
    if (was === null || was === undefined) continue; // eskiden eşleşmiyordu → regresyon değil
    const now = after[query] ?? null;
    if (now !== was) out.push({ query, was, now });
  }
  return out;
}

/** SAF: yalnız YENİ kazanılan eşleşmeler (before'da yoktu/farklıydı, after'da var).
 *  App kartlarının gerçekten yeni yetenek kattığının kanıtı — bilgi amaçlı. */
export function newMatches(before: MatchMap, after: MatchMap): { query: string; id: string }[] {
  const out: { query: string; id: string }[] = [];
  for (const [query, now] of Object.entries(after)) {
    if (now && before[query] !== now) out.push({ query, id: now });
  }
  return out;
}

/** SAF: özet — kaç sorgu ölçüldü, kaçı regresyon, kaçı yeni kazanım. */
export function summarizeMatch(before: MatchMap, after: MatchMap): {
  measured: number; regressions: number; gained: number; stable: number;
} {
  const regs = matchRegressions(before, after).length;
  const gained = newMatches(before, after).length;
  const measured = Object.keys(before).length;
  const stable = Object.entries(before).filter(([q, w]) => w !== null && after[q] === w).length;
  return { measured, regressions: regs, gained, stable };
}
