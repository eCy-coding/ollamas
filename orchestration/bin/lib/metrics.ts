/**
 * metrics.ts — ollamas backend runtime'ı READ-ONLY okumak için saf parser'lar (vO3 cockpit).
 *
 * İki kaynak, iki saf fonksiyon (spawn YOK, fetch YOK → test edilebilir):
 *   1. /api/health JSON gövdesi (server.ts:221 şekli) → parseHealth
 *   2. /metrics Prometheus text → sumPromMetric / promGauge
 *
 * Tasarım: asla throw etmez (bozuk girdi → null/0). Cockpit matrisi backend kapalıyken
 * de render etmeli (best-effort, ERR-ORCH-001 dersi: yokluk = "—", çökme değil).
 */

/** /api/health'ten cockpit'in ihtiyacı olan alt-küme. */
export interface BackendHealth {
  cpu: number;               // metrics.cpuLoad1Min (1-dk load avg)
  ram: number;               // metrics.memory.percentageUsed
  ollamaVersion: string | null;
  mode: string;              // live | demo | degraded
  db: string;                // up | down
  models: number;            // loadedModels.length
}

const UNKNOWN_VER = new Set(["unavailable", "unknown", ""]);

/** /api/health JSON gövdesini BackendHealth'e eşle. Bozuk JSON / eksik alan → tolerant. */
export function parseHealth(raw: string): BackendHealth | null {
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const m = (j.metrics && typeof j.metrics === "object") ? j.metrics : {};
  const ver = typeof m.ollamaVersion === "string" ? m.ollamaVersion.trim() : "";
  return {
    cpu: Number(m.cpuLoad1Min) || 0,
    ram: Number(m.memory?.percentageUsed) || 0,
    ollamaVersion: UNKNOWN_VER.has(ver) ? null : ver,
    mode: typeof j.mode === "string" ? j.mode : "unknown",
    db: typeof j.db === "string" ? j.db : "unknown",
    models: Array.isArray(m.loadedModels) ? m.loadedModels.length : 0,
  };
}

/**
 * Prometheus exposition formatından `name`'e TAM eşleşen tüm örnek değerlerini topla.
 * Etiketleri yok sayar (counter toplamı). `name{...}` ve `name <val>` formlarını kabul eder,
 * `name_bucket`/`name_sum` gibi prefix yanlış-eşleşmesini ENGELLER (sınır karakteri `{` veya boşluk).
 */
export function sumPromMetric(text: string, name: string): number {
  let total = 0;
  let found = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!t.startsWith(name)) continue;
    const after = t.charAt(name.length); // tam-ad sınırı: { (etiket) veya boşluk (değer)
    if (after !== "{" && after !== " " && after !== "\t") continue;
    const val = Number(t.slice(t.lastIndexOf(" ") + 1));
    if (Number.isFinite(val)) { total += val; found = true; }
  }
  return found ? total : 0;
}

/** Tek-örnek gauge değeri (ilk eşleşen). Yok → null. */
export function promGauge(text: string, name: string): number | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!t.startsWith(name)) continue;
    const after = t.charAt(name.length);
    if (after !== "{" && after !== " " && after !== "\t") continue;
    const val = Number(t.slice(t.lastIndexOf(" ") + 1));
    if (Number.isFinite(val)) return val;
  }
  return null;
}
