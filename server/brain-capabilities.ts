// YETENEK TERFİ KAPISI — "sandbox'ta test et, hatasız olanlar otonom başlasın".
//
// Yeni bir loop yeteneği (ReAtt rerank, CE gate eğitimi, RAG-Seq ağırlıklandırma,
// logprob p_final) canlıya DOĞRUDAN inmez. Önce sandbox'ta ölçülür; ölçüm barajı
// geçerse aday olur; canlı-gölge penceresinde de geçerse otonomlaşır. Canlıda BİR
// hata → anında karantina ve loop son-iyi yola döner.
//
// Buradaki her karar SAF ve testlidir; IO brain-capability-runner.ts'te.
// Tasarım öncülü: brain-shadow.ts (örneklenmiş counterfactual kol, GPU-kibar).

export type Status = "sandbox" | "candidate" | "autonomous" | "quarantined";
export type Mode = "sandbox" | "live";

export interface Run {
  turn: number;
  at: number;
  mode: Mode;
  ok: boolean;
  ms: number;
  /** Yeteneğe özgü kalite ölçüsü (ör. ReAtt için RBO). Yoksa yalnız hata+süre bakılır. */
  metric?: number;
  err?: string;
}

export interface Criteria {
  /** Terfi için gereken en az koşu sayısı (pencere içinde). */
  minRuns: number;
  /** Pencerede tolere edilen azami hata. Sandbox için 0 = "hatasız olan". */
  maxErrors: number;
  /** p95 süre tavanı (ms) — tur bütçesini yiyen yetenek terfi etmez. */
  p95BudgetMs: number;
  /** Taban çizgisine göre kabul edilen azami kalite gerilemesi (negatif tolerans). */
  metricTolerance: number;
}

export interface Cap {
  id: string;
  status: Status;
  since: number;
  criteria: Criteria;
  /** Halka tampon — son N koşu. */
  runs: Run[];
  /** Terfi anındaki referans değerler; gerileme buna göre ölçülür. */
  baseline?: { metric?: number; p95Ms: number };
  lastGood?: { at: number; turn: number };
  quarantine?: { reason: string; at: number; turn: number };
}

export interface Ledger {
  version: 1;
  updatedAt: number;
  caps: Record<string, Cap>;
}

export const RUN_HISTORY = 100;
export const DEFAULT_WINDOW = 20;

export const DEFAULT_CRITERIA: Criteria = {
  minRuns: 10,
  maxErrors: 0,        // "hatasız olanlar" — sandbox'ta sıfır tolerans
  p95BudgetMs: 30_000, // tur bütçesi 90s; tek yetenek üçte birinden fazlasını yiyemez
  metricTolerance: 0.02,
};

export interface Summary {
  n: number;
  errors: number;
  p95Ms: number;
  metricMean: number | null;
  /** Taban çizgisine göre kalite farkı; taban yoksa 0 (gerileme iddia edilemez). */
  metricDelta: number;
}

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** SAF: bir moddaki son `window` koşunun özeti. */
export function summarize(cap: Cap, mode: Mode, window: number = DEFAULT_WINDOW): Summary {
  const runs = cap.runs.filter((r) => r.mode === mode).slice(-window);
  const durations = runs.map((r) => r.ms).sort((a, b) => a - b);
  const metrics = runs.map((r) => r.metric).filter((m): m is number => typeof m === "number");
  const metricMean = metrics.length ? metrics.reduce((a, b) => a + b, 0) / metrics.length : null;
  const base = cap.baseline?.metric;
  return {
    n: runs.length,
    errors: runs.filter((r) => !r.ok).length,
    p95Ms: Math.round(percentile(durations, 95)),
    metricMean: metricMean === null ? null : Number(metricMean.toFixed(4)),
    metricDelta: metricMean !== null && typeof base === "number" ? Number((metricMean - base).toFixed(4)) : 0,
  };
}

/** SAF: barajı geçiyor mu — terfi kararının tek yeri. */
function passes(s: Summary, c: Criteria): { ok: boolean; why: string } {
  if (s.n < c.minRuns) return { ok: false, why: `yetersiz koşu ${s.n}/${c.minRuns}` };
  if (s.errors > c.maxErrors) return { ok: false, why: `hata ${s.errors}>${c.maxErrors}` };
  if (s.p95Ms > c.p95BudgetMs) return { ok: false, why: `p95 ${s.p95Ms}ms>${c.p95BudgetMs}ms` };
  if (s.metricDelta < -c.metricTolerance) return { ok: false, why: `kalite düştü ${s.metricDelta}` };
  return { ok: true, why: "baraj geçildi" };
}

/** SAF: bir sonraki durum. Karantina TEK YÖNLÜ — yalnız CLI reset geri alır. */
export function evaluate(cap: Cap, _now: number = 0): { next: Status; reason: string } {
  if (cap.status === "quarantined") return { next: "quarantined", reason: "karantinada — reset gerekir" };

  // Canlı yolda TEK hata bile karantina sebebidir: otonom bir yetenek sessizce
  // bozuk çalışmaktansa devre dışı kalmalı.
  const liveFail = cap.runs.filter((r) => r.mode === "live").slice(-1)[0];
  if (liveFail && !liveFail.ok) return { next: "quarantined", reason: `canlı hata: ${liveFail.err ?? "bilinmiyor"}` };

  if (cap.status === "sandbox") {
    const s = summarize(cap, "sandbox");
    const p = passes(s, cap.criteria);
    return p.ok ? { next: "candidate", reason: `sandbox ${p.why}` } : { next: "sandbox", reason: `sandbox ${p.why}` };
  }
  if (cap.status === "candidate") {
    const s = summarize(cap, "live");
    const p = passes(s, cap.criteria);
    return p.ok ? { next: "autonomous", reason: `canlı-gölge ${p.why}` } : { next: "candidate", reason: `canlı-gölge ${p.why}` };
  }
  return { next: "autonomous", reason: "otonom" };
}

/** SAF: koşu kaydet (değişmez) — durum geçişi burada uygulanır. */
export function recordRun(cap: Cap, run: Run, now: number = run.at): Cap {
  const runs = [...cap.runs, run].slice(-RUN_HISTORY);
  const next: Cap = { ...cap, runs };
  if (run.ok) next.lastGood = { at: run.at, turn: run.turn };

  const { next: status, reason } = evaluate(next, now);
  if (status === cap.status) return next;
  if (status === "quarantined") return { ...next, status, since: now, quarantine: { reason, at: now, turn: run.turn } };

  // Terfi anında taban çizgisi dondurulur: sonraki pencere BUNA göre kıyaslanır.
  const s = summarize(next, cap.status === "sandbox" ? "sandbox" : "live");
  return { ...next, status, since: now, baseline: { metric: s.metricMean ?? undefined, p95Ms: s.p95Ms } };
}

/** SAF: elle/otomatik karantina. */
export function demote(cap: Cap, reason: string, now: number, turn = 0): Cap {
  return { ...cap, status: "quarantined", since: now, quarantine: { reason, at: now, turn } };
}

/** SAF: karantinadan sandbox'a — geçmiş koşular silinir, temiz sayfa. */
export function reset(cap: Cap, now: number): Cap {
  return { ...cap, status: "sandbox", since: now, runs: [], baseline: undefined, quarantine: undefined };
}

export function emptyCap(id: string, c: Partial<Criteria> = {}, now = 0): Cap {
  return { id, status: "sandbox", since: now, criteria: { ...DEFAULT_CRITERIA, ...c }, runs: [] };
}

export function emptyLedger(now = 0): Ledger {
  return { version: 1, updatedAt: now, caps: {} };
}

/** SAF: canlıda koşmasına izin verilen yetenekler. */
export function autonomousIds(l: Ledger): string[] {
  return Object.values(l.caps).filter((c) => c.status === "autonomous").map((c) => c.id).sort();
}

/** SAF: bu turda sandbox'ta denenecek yetenek — turdan türetilir, deterministik.
 *  Tur başına EN FAZLA BİR sandbox koşusu: ısı bütçesi tek yeteneği kaldırır. */
export function sandboxIdFor(l: Ledger, turn: number): string | null {
  const ids = Object.values(l.caps)
    .filter((c) => c.status === "sandbox" || c.status === "candidate")
    .map((c) => c.id)
    .sort();
  return ids.length ? ids[((turn % ids.length) + ids.length) % ids.length] : null;
}

/** İnsan-okur tablo — sıfat yok, sayı var. */
export function renderTable(l: Ledger): string {
  const rows = Object.values(l.caps).sort((a, b) => a.id.localeCompare(b.id));
  if (!rows.length) return "kayıtlı yetenek yok.";
  const head = "yetenek                durum        sandbox(n/hata/p95)   canlı(n/hata/p95)   not";
  const body = rows.map((c) => {
    const s = summarize(c, "sandbox");
    const v = summarize(c, "live");
    const note = c.quarantine ? `karantina: ${c.quarantine.reason}` : evaluate(c).reason;
    return `${c.id.padEnd(22)} ${c.status.padEnd(12)} ${`${s.n}/${s.errors}/${s.p95Ms}ms`.padEnd(21)} ${`${v.n}/${v.errors}/${v.p95Ms}ms`.padEnd(19)} ${note}`;
  });
  return [head, ...body].join("\n");
}
