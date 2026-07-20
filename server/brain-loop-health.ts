// Sonsuz loop'un SAĞLIK yüzeyi — "çalışıyor" demez, ÖLÇÜLEN sayı basar.
//
// Neden gerekli: loop'un tur 42-53 arası 12 kez boşa uyandığı, ancak biri
// /tmp/ollamas-brain-loop.log'u elle okuduğunda fark edildi. Sessiz başarısızlık
// sessiz kaldığı sürece sonsuz loop "çalışıyor" görünür. Her tur ölçülür, özet
// tek komutla alınır: `make brain-loop-health`.
//
// Saf çekirdek (summarize/rotate kararı) burada ve testli; IO ince bir kabuk.
import { appendFileSync, existsSync, statSync, readFileSync, writeFileSync, renameSync } from "node:fs";

/** Bir turun ölçülen izi. Atlanan tur da bir sonuçtur — kaydedilir. */
export interface TurnMetric {
  turn: number;
  at: number;
  ms: number;
  strategy?: string;
  ns?: string;
  expert?: string;
  wrote: boolean;
  sources?: number;
  confidence?: number;
  degraded?: string[];
  /** Atlandıysa sınıfı: locked · gpu-busy · embedder-busy · server-unavailable · budget · no-fresh-target */
  skipped?: string;
}

export interface HealthSummary {
  turns: number;
  wrote: number;
  /** Yazan tur oranı — sonsuz loop'un ASIL verimlilik ölçüsü. */
  writeRate: number;
  skipped: number;
  /** Atlama/hata sınıflarının dağılımı — hangi darboğaz baskın, tahmin değil sayı. */
  kinds: Record<string, number>;
  strategies: Record<string, number>;
  experts: Record<string, number>;
  avgMs: number;
  p95Ms: number;
  lastTurn: number | null;
  lastAt: number | null;
  /** Art arda kaç turdur hiçbir şey yazılmadı — 12 olması kusur-3'ün imzasıydı. */
  consecutiveDry: number;
}

const tally = (xs: (string | undefined)[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const x of xs) if (x) out[x] = (out[x] ?? 0) + 1;
  return out;
};

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** SAF: ölçüm satırlarından sağlık özeti. */
export function summarize(metrics: TurnMetric[]): HealthSummary {
  const turns = metrics.length;
  const wrote = metrics.filter((m) => m.wrote).length;
  const durations = metrics.map((m) => m.ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);

  // Sondan geriye: kaç turdur kuru. Yazan ilk turda durur.
  let consecutiveDry = 0;
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].wrote) break;
    consecutiveDry++;
  }

  const last = metrics[metrics.length - 1];
  return {
    turns,
    wrote,
    writeRate: turns ? Number((wrote / turns).toFixed(3)) : 0,
    skipped: metrics.filter((m) => m.skipped).length,
    kinds: tally(metrics.map((m) => m.skipped)),
    strategies: tally(metrics.map((m) => m.strategy)),
    experts: tally(metrics.map((m) => m.expert)),
    avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    p95Ms: Math.round(percentile(durations, 95)),
    lastTurn: last?.turn ?? null,
    lastAt: last?.at ?? null,
    consecutiveDry,
  };
}

/** SAF: dosya bu boyutu aştıysa döndürülmeli mi. */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes > maxBytes;
}

/** SAF: JSONL metnini ayrıştır — bozuk satır TÜM özeti düşürmemeli. */
export function parseMetrics(text: string): TurnMetric[] {
  const out: TurnMetric[] = [];
  for (const line of String(text ?? "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const m = JSON.parse(s);
      if (m && typeof m.turn === "number") out.push(m as TurnMetric);
    } catch { /* bozuk satır atlanır — kısmi log tam sessizlikten iyidir */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// İnce IO kabuğu
// ---------------------------------------------------------------------------

/** Log dosyası tavanı aşarsa .1 uzantısına devret (rotasyonsuz log diski yer.
 *  /tmp/ollamas-brain-loop.log kapaksız büyüyordu). */
export function rotateIfLarge(path: string, maxBytes: number): boolean {
  try {
    if (!existsSync(path)) return false;
    if (!shouldRotate(statSync(path).size, maxBytes)) return false;
    renameSync(path, `${path}.1`); // tek kuşak yeter — arşiv değil, tampon
    return true;
  } catch { return false; }
}

export function appendMetric(path: string, m: TurnMetric, maxBytes = 5 * 1024 * 1024): void {
  try {
    rotateIfLarge(path, maxBytes);
    appendFileSync(path, `${JSON.stringify(m)}\n`);
  } catch { /* ölçüm best-effort — asla turu düşürmez */ }
}

export function readMetrics(path: string, limit = 200): TurnMetric[] {
  try {
    if (!existsSync(path)) return [];
    return parseMetrics(readFileSync(path, "utf8")).slice(-limit);
  } catch { return []; }
}

/** İnsan-okur özet — sıfat yok, sayı var. */
export function renderHealth(h: HealthSummary): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const kv = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "-";
  const age = h.lastAt ? `${Math.round((Date.now() - h.lastAt) / 60000)}dk önce` : "-";
  return [
    `tur           ${h.turns}  (son: #${h.lastTurn ?? "-"}, ${age})`,
    `yazım         ${h.wrote}/${h.turns} = ${pct(h.writeRate)}`,
    `ardışık kuru  ${h.consecutiveDry}${h.consecutiveDry >= 5 ? "  ← HEDEF ÜRETİMİ İNCELE" : ""}`,
    `atlama        ${h.skipped}  [${kv(h.kinds)}]`,
    `strateji      ${kv(h.strategies)}`,
    `uzman         ${kv(h.experts)}`,
    `süre          ort ${h.avgMs}ms · p95 ${h.p95Ms}ms`,
  ].join("\n");
}

export { writeFileSync as _writeFileSync };
