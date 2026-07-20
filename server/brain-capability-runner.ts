// Terfi kapısının IO kabuğu: defteri oku/yaz + `withCapability` sarmalı.
// Karar mantığı brain-capabilities.ts'te (saf, testli); burada yalnız disk ve zaman var.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  emptyLedger, emptyCap, recordRun, autonomousIds, type Cap, type Ledger, type Mode, type Run,
} from "./brain-capabilities";

const stateDir = (): string => process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
export const ledgerPath = (): string => join(stateDir(), "capabilities.json");

export function loadLedger(): Ledger {
  try {
    const l = JSON.parse(readFileSync(ledgerPath(), "utf8")) as Ledger;
    if (l && l.version === 1 && l.caps && typeof l.caps === "object") return l;
  } catch { /* yok/bozuk → temiz defter; yetenekler sandbox'tan başlar (güvenli taraf) */ }
  return emptyLedger(Date.now());
}

/** Atomik yazım — iki süreç (canlı yol + loop) aynı defteri günceller. */
export function saveLedger(l: Ledger): boolean {
  const target = ledgerPath();
  const tmp = `${target}.tmp.${process.pid}`;
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ ...l, updatedAt: Date.now() }, null, 1));
    renameSync(tmp, target);
    return true;
  } catch {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* temizlik */ }
    return false;
  }
}

/** Defterde yoksa yeteneği sandbox olarak kaydet — yeni yetenek ASLA otonom doğmaz. */
export function ensureCap(l: Ledger, id: string): Cap {
  if (!l.caps[id]) l.caps[id] = emptyCap(id, {}, Date.now());
  return l.caps[id];
}

export interface WithCapOpts {
  ledger: Ledger;
  turn: number;
  /** Sandbox modunda mı çalıştırılıyor (canlı sonuç KULLANILMAZ). */
  mode?: Mode;
  /** Yeteneğe özgü kalite ölçüsü — sonuçtan türetilir. */
  metricOf?: (result: unknown) => number | undefined;
}

/**
 * Yeteneği kapıdan geçirerek çalıştır.
 *
 * SÖZLEŞME: `next` yalnız yetenek `autonomous` ise (ya da açıkça sandbox modunda)
 * koşar. NE OLURSA OLSUN hata durumunda `fallback`'in değeri döner — kapı loop'u
 * asla düşürmez. Her koşu deftere yazılır; canlı hata anında karantinaya alır.
 */
export async function withCapability<T>(
  id: string,
  next: () => Promise<T>,
  fallback: () => Promise<T>,
  opts: WithCapOpts,
): Promise<T> {
  const { ledger, turn, mode = "live" } = opts;
  const cap = ensureCap(ledger, id);
  const allowed = mode === "sandbox" || autonomousIds(ledger).includes(id);
  if (!allowed) return fallback();

  const t0 = Date.now();
  try {
    const out = await next();
    const run: Run = { turn, at: Date.now(), mode, ok: true, ms: Date.now() - t0, metric: opts.metricOf?.(out) };
    ledger.caps[id] = recordRun(cap, run, run.at);
    saveLedger(ledger);
    // Sandbox koşusunun SONUCU KULLANILMAZ — yalnız ölçülür. Canlı davranış değişmez.
    return mode === "sandbox" ? fallback() : out;
  } catch (e: any) {
    const run: Run = {
      turn, at: Date.now(), mode, ok: false, ms: Date.now() - t0,
      err: String(e?.message ?? e).slice(0, 120),
    };
    ledger.caps[id] = recordRun(cap, run, run.at);
    saveLedger(ledger);
    return fallback(); // son-iyi yol
  }
}
