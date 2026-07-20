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
  /** Hata mesajı ALTYAPI kaynaklı mı (fetch failed, timeout, 503…). True dönerse
   *  koşu KAYDEDİLMEZ ve yetenek karantinaya ALINMAZ — geçici bir server/ağ hıçkırığı
   *  yeteneğin kusuru değildir (aç turdaki skip gibi). Yoksa her hata yeteneğe yazılır. */
  isInfraError?: (message: string) => boolean;
}

/**
 * Yeteneği kapıdan geçirerek çalıştır.
 *
 * KOŞMA/ÇIKTI KARARI yeteneğin DURUMUNA göre (mode yalnız KAYIT etiketidir):
 *   • autonomous → koşar, ÇIKTI KULLANILIR (güvenilir).
 *   • sandbox + mode:sandbox → koşar, ÇIKTI ATILIR (yalnız ölçülür).
 *   • candidate + mode:live → CANLI-GÖLGE: koşar, canlı ölçülür, ÇIKTI ATILIR
 *     (henüz güvenilmez ama canlı-pencere biriktirmeli — yoksa candidate sonsuza
 *     dek candidate kalır; bu boşluk candidate→autonomous'u tıkıyordu).
 *   • aksi (sandbox+live, quarantined, …) → KOŞMAZ, fallback.
 *
 * Canlı-gölge de GERÇEK bir canlı koşudur: hata → evaluate anında karantina eder.
 * NE OLURSA OLSUN hata durumunda `fallback` döner — kapı loop'u asla düşürmez.
 */
export async function withCapability<T>(
  id: string,
  next: () => Promise<T>,
  fallback: () => Promise<T>,
  opts: WithCapOpts,
): Promise<T> {
  const { ledger, turn, mode = "live" } = opts;
  const cap = ensureCap(ledger, id);
  const isAutonomous = autonomousIds(ledger).includes(id);
  const isSandboxRun = mode === "sandbox" && (cap.status === "sandbox" || cap.status === "candidate");
  const isLiveShadow = mode === "live" && cap.status === "candidate";
  const allowed = isAutonomous || isSandboxRun || isLiveShadow;
  if (!allowed) return fallback();

  const t0 = Date.now();
  try {
    const out = await next();
    const run: Run = { turn, at: Date.now(), mode, ok: true, ms: Date.now() - t0, metric: opts.metricOf?.(out) };
    ledger.caps[id] = recordRun(cap, run, run.at);
    saveLedger(ledger);
    // Yalnız OTONOM yetenek çıktısı kullanılır. Sandbox ölçümü ve canlı-gölge
    // GÜVENİLMEZ → çıktı atılır (canlı davranış değişmez), yalnız deftere ölçü düşer.
    return isAutonomous ? out : fallback();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // ALTYAPI hatası (geçici server/ağ) yeteneğin kusuru DEĞİL → koşu kaydedilmez,
    // karantina yok. Yoksa bir HTTP hıçkırığı sağlam bir yeteneği haksızca gömerdi
    // (gözlendi: reatt-rerank canlı-gölgede "fetch failed" ile yanlış karantina).
    if (opts.isInfraError?.(msg)) return fallback();
    const run: Run = {
      turn, at: Date.now(), mode, ok: false, ms: Date.now() - t0,
      err: msg.slice(0, 120),
    };
    ledger.caps[id] = recordRun(cap, run, run.at);
    saveLedger(ledger);
    return fallback(); // son-iyi yol
  }
}
