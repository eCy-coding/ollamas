// bin/host-bridge/tools/lib/ask-calibrate.mjs — Siri ölçüm SAF yardımcıları (test'li; I/O yok).
//   ndcg3: graded + çok-gold sıralama kalitesi (Järvelin&Kekäläinen). windowHealth: log SLO + drift.
//   siri-calibrate.mjs (ndcg3) ve siri-log-report.mjs (windowHealth) tüketir; testler birim doğrular.

/** Graded nDCG@3 — gain = 2^rel − 1 (Järvelin&Kekäläinen), IDCG-normalize. top3 = host dizisi.
 *  gold = [{domain, rel}] (rel: 3 resmî/birincil · 2 saygın · 1 kabul) · string → [{domain, rel:3}].
 *  Her gold en iyi (ilk) eşleştiği rütbede sayılır; IDCG = gold'lar rel↓ ideal top-3. Saf. */
export function ndcg3(top3, gold) {
  if (!gold) return null;
  const arr = Array.isArray(gold) ? gold : [gold];
  const norm = arr
    .map((g) => (typeof g === "string" ? { domain: g, rel: 3 } : { domain: g && g.domain, rel: g && g.rel == null ? 3 : g.rel }))
    .filter((g) => g.domain);
  if (!norm.length) return null;
  const gain = (rel) => Math.pow(2, rel) - 1;
  const t = top3 || [];
  let dcg = 0; const seen = new Set();
  for (let i = 0; i < t.length; i += 1) {
    const h = (t[i] || "").toLowerCase();
    for (const g of norm) {
      if (!seen.has(g.domain) && h.includes(String(g.domain).toLowerCase())) { dcg += gain(g.rel) / Math.log2(i + 2); seen.add(g.domain); break; }
    }
  }
  const ideal = [...norm].sort((a, b) => b.rel - a.rel).slice(0, 3);
  const idcg = ideal.reduce((s, g, i) => s + gain(g.rel) / Math.log2(i + 2), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

/** Log SAĞLIK / DRIFT — son windowN (recent) vs kalan (older). SLO + recent-vs-baseline drift (Google SRE).
 *  records = buildSiriRecord kayıtları. SLO bu web+LLM hattına UYARLI (API-RAG <500ms DEĞİL). Saf. */
export function windowHealth(records, opts = {}) {
  const windowN = opts.windowN || 20;
  const slo = { errorMax: opts.errorMax != null ? opts.errorMax : 0.05, confMin: opts.confMin != null ? opts.confMin : 60, p95Max: opts.p95Max != null ? opts.p95Max : 35000 };
  const recs = Array.isArray(records) ? records : [];
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : null);
  const metricsOf = (sub) => {
    let err = 0, cacheHit = 0; const conf = [], tot = [];
    for (const r of sub) {
      if (r && r.status === "error") err += 1;
      if (r && r.cache === "hit") cacheHit += 1;
      const a = (r && r.attributes) || {};
      if (a.conf && typeof a.conf.score === "number") conf.push(a.conf.score);
      const L = a.latency || {};
      if (typeof L.total_ms === "number") tot.push(L.total_ms);
    }
    return { n: sub.length, errorRate: sub.length ? err / sub.length : 0, confAvg: mean(conf), p95: p95(tot), cacheHitRate: sub.length ? cacheHit / sub.length : 0 };
  };
  const recent = metricsOf(recs.slice(-windowN));
  const older = recs.length > windowN ? metricsOf(recs.slice(0, recs.length - windowN)) : null;
  const checks = [
    { name: "error", ok: recent.errorRate <= slo.errorMax, val: recent.errorRate },
    { name: "confidence", ok: recent.confAvg == null || recent.confAvg >= slo.confMin, val: recent.confAvg },
    { name: "p95", ok: recent.p95 == null || recent.p95 <= slo.p95Max, val: recent.p95 },
  ];
  const status = checks.every((c) => c.ok) ? "PASS" : "WARN";
  let drift = null;
  if (older) {
    const pc = (a, b) => (typeof a === "number" && typeof b === "number" && b !== 0 ? (a - b) / b : null);
    drift = {
      confDelta: recent.confAvg != null && older.confAvg != null ? recent.confAvg - older.confAvg : null,
      p95Pc: pc(recent.p95, older.p95),
      errorDelta: recent.errorRate - older.errorRate,
    };
  }
  return { recent, older, status, checks, drift, slo };
}
