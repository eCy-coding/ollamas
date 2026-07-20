// Sandbox egzersizcisinin KAPILARI — saf, IO'suz, testli.
//
// KUSUR S (2026-07-20): terfi kapısı (brain-capabilities.ts) kuruldu ve dört yetenek
// deftere kaydedildi, ama üçü üretimde HİÇ çağrılmıyordu. Terfi `minRuns: 10` sandbox
// koşusu ister; hiçbir şey onları koşturmadığı için sonsuza dek sandbox'ta kaldılar.
// `sandboxIdFor` bile yazılmış, export edilmiş, test edilmiş ama bir kez çağrılmamıştı
// — Faz 3'te düzelttiğim ölü formüllerle AYNI SINIF kusur: var görünen, erişilemez kod.
//
// Buradaki kapılar egzersizcinin turun GERÇEK işini asla tehlikeye atmamasını sağlar.

import type { Cap } from "./brain-capabilities";

/** Tur bütçesinin en az bu oranı kalmalı ki sandbox koşusu başlasın. */
export const DEFAULT_RESERVE = 0.4;

export interface ExerciseGate {
  gpuBusy: boolean;
  elapsedMs: number;
  budgetMs: number;
  reserveFraction?: number;
}

/** Sandbox koşusu bu turda başlatılabilir mi. Turun asıl işi ÖNCE gelir:
 *  ölçüm için ne kullanıcının GPU'su ne turun bütçesi çalınır. */
export function shouldExercise(g: ExerciseGate): { ok: boolean; why: string } {
  if (g.gpuBusy) return { ok: false, why: "gpu meşgul" };
  if (!Number.isFinite(g.elapsedMs) || !Number.isFinite(g.budgetMs) || g.budgetMs <= 0) {
    return { ok: false, why: "bütçe bilinmiyor" };
  }
  const reserve = g.reserveFraction ?? DEFAULT_RESERVE;
  const remaining = g.budgetMs - g.elapsedMs;
  if (remaining < g.budgetMs * reserve) {
    return { ok: false, why: `bütçe yetersiz (${Math.round(remaining)}ms kaldı)` };
  }
  return { ok: true, why: "uygun" };
}

/** Bu yetenek bu turda ZATEN koştu mu. `gate-ce-train` turn%10'da kendi dalından
 *  koşuyor ve `sandboxIdFor` de onu seçebilir; aynı turda iki koşu ölçümü çift sayar.
 *  Özel-durum değil, genel kural. */
export function alreadyRanThisTurn(cap: Cap, turn: number): boolean {
  return cap.runs.some((r) => r.turn === turn);
}

// Altyapı arızası desenleri. Bunlar YETENEK KUSURU DEĞİLDİR.
const INFRA = /\b(503|econnrefused|enotfound|econnreset|socket hang up)\b|embedder busy|fetch failed|aborted|timed? ?out|timeout/i;

/**
 * Bir hata mesajı altyapı arızası mı (yetenek kusuru değil)?
 *
 * NEDEN KRİTİK: `DEFAULT_CRITERIA.maxErrors` 0'dır. Tek bir embedder 503'ü deftere
 * hata olarak yazılırsa yetenek 20 turluk pencere boyunca terfi edemez — yani
 * sunucunun geçici meşguliyeti, yeteneğin kalitesi hakkında kalıcı bir yargıya
 * dönüşür. Bu yüzden altyapı arızaları `withCapability`'ye GİRİLMEDEN elenir ve
 * koşu hiç kaydedilmez (atlanır), hata olarak sayılmaz.
 */
export function isInfraFailure(message: string): boolean {
  return INFRA.test(String(message ?? ""));
}
