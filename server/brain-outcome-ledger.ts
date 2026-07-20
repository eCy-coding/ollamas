// Gate eğitiminin VERİ kaynağı: her turun (sorgu vektörü, üç uzman puanı) kaydı.
//
// Bu defter olmadan eğitim tek turluk olur ve gate yine anlık gürültüyü ezberler.
// brain-loop-health.ts'in JSONL desenini izler: bozuk satır tüm dosyayı düşürmez,
// yazım best-effort (asla turu bloklamaz), boyut tavanlı.
//
// BOYUT UYARISI: q 768 float ≈ 6KB/satır. 5 ondalığa yuvarlanır ve satır sayısı
// tavanlanır; aksi hâlde defter günlerce birikip on MB'lara çıkar.
import { appendFileSync, existsSync, statSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OutcomeRow } from "./brain-gate-train";

const stateDir = (): string => process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
export const outcomePath = (): string => join(stateDir(), "gate-outcomes.jsonl");

/** Vektörü 5 ondalığa indir — retrieval kalitesine etkisi yok, dosya boyutu yarıya iner. */
const round5 = (v: number[]): number[] => v.map((x) => Number(x.toFixed(5)));

/** SAF: JSONL → satırlar. Bozuk satır atlanır. */
export function parseOutcomes(text: string): OutcomeRow[] {
  const out: OutcomeRow[] = [];
  for (const line of String(text ?? "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s);
      if (r && Array.isArray(r.q) && Array.isArray(r.scores) && r.q.length) out.push(r as OutcomeRow);
    } catch { /* bozuk satır — kısmi defter tam sessizlikten iyidir */ }
  }
  return out;
}

/** SAF: tavan aşıldı mı. */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes > maxBytes;
}

const MAX_BYTES = Number(process.env.BRAIN_OUTCOME_MAX_BYTES) || 4 * 1024 * 1024;

export function appendOutcome(r: OutcomeRow): void {
  try {
    const p = outcomePath();
    if (existsSync(p) && shouldRotate(statSync(p).size, MAX_BYTES)) renameSync(p, `${p}.1`);
    appendFileSync(p, `${JSON.stringify({ ...r, q: round5(r.q) })}\n`);
  } catch { /* defter best-effort — asla turu düşürmez */ }
}

/** Son `limit` satır. Eğitim yalnız yakın geçmişten öğrenir (bayat kanıt ağırlık yapmasın). */
export function readOutcomes(limit = 500): OutcomeRow[] {
  try {
    const p = outcomePath();
    if (!existsSync(p)) return [];
    return parseOutcomes(readFileSync(p, "utf8")).slice(-limit);
  } catch { return []; }
}
