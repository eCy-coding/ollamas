/**
 * orchestration/oracle/cdcl.ts — deterministik CDCL SAT çözücü (trimmed 1-UIP).
 *
 * DPLL + two-watched-literals BCP + 1-UIP conflict analizi + learned asserting clause +
 * non-chronological backjump + VSIDS. Determinizm SERT değişmez: aynı CNF → aynı sat/unsat VE
 * aynı model. Bunu garanti eden kurallar: RNG YOK; tüm diziler indeks sırasında gezilir; VSIDS
 * tie-break = en küçük değişken indeksi (strict >); sabit faz=false; rescale sabit eşik+sıra.
 * Luby restart / phase-saving / clause-deletion / pure-literal YOK (determinizm+bug yüzeyini küçült).
 *
 * Kaynak: MiniSat (Eén & Sörensson) 1-UIP analyze; two-watched-literals (MPI). Bkz. ALGORITHM.md.
 */

export type CdclResult = { sat: true; model: Int8Array } | { sat: false };

// Adversaryel PHP gibi worst-case üstel örneklerde asılmamak için conflict tavanı.
const MAX_CONFLICTS = 4_000_000;
const VAR_DECAY = 0.95;

const litIndex = (lit: number): number => (Math.abs(lit) << 1) | (lit < 0 ? 1 : 0);

/** clauses: her kloz literal dizisi (lit = ±değişken, 1..nVars). nVars = TOPLAM (orijinal + Tseitin aux). */
export function solveCdcl(clauses: number[][], nVars: number): CdclResult {
  const value = new Int8Array(nVars + 1);          // 0 atanmamış / +1 doğru / -1 yanlış
  const level = new Int32Array(nVars + 1);
  const reason = new Int32Array(nVars + 1).fill(-1); // forced eden kloz id, -1 = karar/yok
  const activity = new Float64Array(nVars + 1);
  const seen = new Uint8Array(nVars + 1);
  const trail: number[] = [];
  const trailLim: number[] = [];
  let qhead = 0;
  let varInc = 1.0;
  let conflicts = 0;

  const watchSize = (nVars + 1) << 1;
  const watches: number[][] = new Array(watchSize);
  for (let i = 0; i < watchSize; i++) watches[i] = [];
  const store: number[][] = [];                    // kloz deposu (orijinal + learned)

  const decisionLevel = () => trailLim.length;
  const litTrue = (l: number) => value[Math.abs(l)] === (l > 0 ? 1 : -1);
  const litFalse = (l: number) => value[Math.abs(l)] === (l > 0 ? -1 : 1);

  const enqueue = (lit: number, cid: number) => {
    const v = Math.abs(lit);
    value[v] = lit > 0 ? 1 : -1;
    level[v] = decisionLevel();
    reason[v] = cid;
    trail.push(lit);
  };

  const bump = (v: number) => {
    if ((activity[v] += varInc) > 1e100) {
      for (let i = 1; i <= nVars; i++) activity[i] *= 1e-100; // artan indeks, sabit sabit
      varInc *= 1e-100;
    }
  };

  // ── BCP: yalnız ¬p'yi izleyen klozları yokla; izlemeyi non-false literale taşı / unit / conflict ──
  const propagate = (): number => {
    while (qhead < trail.length) {
      const p = trail[qhead++];
      const fw = watches[litIndex(-p)];      // ¬p'yi (artık false) izleyenler
      let i = 0, j = 0;
      let confl = -1;
      while (i < fw.length) {
        const cid = fw[i++];
        const c = store[cid];
        if (c[0] === -p) { c[0] = c[1]; c[1] = -p; }  // false watch → c[1]
        const other = c[0];
        if (litTrue(other)) { fw[j++] = cid; continue; } // zaten sağlanmış
        let moved = false;
        for (let k = 2; k < c.length; k++) {
          if (!litFalse(c[k])) { c[1] = c[k]; c[k] = -p; watches[litIndex(c[1])].push(cid); moved = true; break; }
        }
        if (moved) continue;                          // izleme taşındı → fw'den düştü
        fw[j++] = cid;                                // ¬p'yi izlemeye devam
        if (litFalse(other)) {                        // conflict
          confl = cid;
          while (i < fw.length) fw[j++] = fw[i++];
          fw.length = j;
          return confl;
        }
        enqueue(other, cid);                          // unit
      }
      fw.length = j;
    }
    return -1;
  };

  // ── 1-UIP analiz (MiniSat): trail'i geriye yürüt, current-level sayaç==1'de UIP ──
  const analyze = (confl: number): { learned: number[]; btLevel: number } => {
    const dl = decisionLevel();
    const learned: number[] = [0];                   // [0] = UIP (sonra)
    let counter = 0;
    let p = 0;
    let cid = confl;
    let index = trail.length - 1;
    do {
      const c = store[cid];
      for (let k = p === 0 ? 0 : 1; k < c.length; k++) {
        const q = c[k];
        const v = Math.abs(q);
        if (!seen[v] && level[v] > 0) {
          bump(v);
          seen[v] = 1;
          if (level[v] >= dl) counter++;
          else learned.push(q);
        }
      }
      while (!seen[Math.abs(trail[index])]) index--;
      p = trail[index];
      const pv = Math.abs(p);
      cid = reason[pv];
      seen[pv] = 0;
      index--;
      counter--;
    } while (counter > 0);
    learned[0] = -p;                                 // UIP negasyonu

    // M1: learned[1] = ikinci-en-yüksek-seviye literali (iki watch en yüksek iki seviye olmalı)
    let btLevel = 0;
    if (learned.length > 1) {
      let maxI = 1;
      for (let k = 2; k < learned.length; k++) if (level[Math.abs(learned[k])] > level[Math.abs(learned[maxI])]) maxI = k;
      const tmp = learned[1]; learned[1] = learned[maxI]; learned[maxI] = tmp;
      btLevel = level[Math.abs(learned[1])];
    }
    // M2: seen[] tam temizlik (UIP dahil tüm learned vars)
    for (let k = 0; k < learned.length; k++) seen[Math.abs(learned[k])] = 0;
    return { learned, btLevel };
  };

  const cancelUntil = (lvl: number) => {
    if (decisionLevel() <= lvl) return;
    for (let c = trail.length - 1; c >= trailLim[lvl]; c--) value[Math.abs(trail[c])] = 0; // faz-saklama YOK
    trail.length = trailLim[lvl];
    qhead = trail.length;
    trailLim.length = lvl;
  };

  const pickBranch = (): number => {
    let best = 0; let bestAct = -1;
    for (let v = 1; v <= nVars; v++) if (value[v] === 0 && activity[v] > bestAct) { bestAct = activity[v]; best = v; } // strict > → en küçük indeks tie
    return best;
  };

  // ── kloz yükleme: unit'ler level 0'da enqueue; ≥2 literal watch'lı depoya ──
  for (const cl of clauses) {
    if (cl.length === 0) return { sat: false };
    if (cl.length === 1) {
      const lit = cl[0]; const v = Math.abs(lit); const want = lit > 0 ? 1 : -1;
      if (value[v] === 0) enqueue(lit, -1);
      else if (value[v] !== want) return { sat: false };
      continue;
    }
    const cid = store.length; store.push(cl.slice());
    watches[litIndex(cl[0])].push(cid);
    watches[litIndex(cl[1])].push(cid);
  }

  // ── ana döngü ──
  for (;;) {
    const confl = propagate();
    if (confl !== -1) {
      if (decisionLevel() === 0) return { sat: false };
      if (++conflicts > MAX_CONFLICTS) throw new Error("CDCL_BUDGET");
      const { learned, btLevel } = analyze(confl);
      cancelUntil(btLevel);
      if (learned.length === 1) {
        enqueue(learned[0], -1);                     // M10: level 0'da
      } else {
        const cid = store.length; store.push(learned);
        watches[litIndex(learned[0])].push(cid);
        watches[litIndex(learned[1])].push(cid);
        enqueue(learned[0], cid);
      }
      varInc /= VAR_DECAY;                           // VSIDS decay
    } else {
      if (trail.length === nVars) {                  // tüm değişken atandı (aux dahil) → SAT
        const model = new Int8Array(nVars + 1);
        for (let v = 1; v <= nVars; v++) model[v] = value[v];
        return { sat: true, model };
      }
      const v = pickBranch();
      if (v === 0) {                                  // atanmamış yok ama trail<nVars? (olmamalı)
        const model = new Int8Array(nVars + 1);
        for (let i = 1; i <= nVars; i++) model[i] = value[i];
        return { sat: true, model };
      }
      trailLim.push(trail.length);
      enqueue(-v, -1);                                // sabit faz=false → literal -v doğru
    }
  }
}
