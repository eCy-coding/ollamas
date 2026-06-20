/**
 * refresh.ts (lib) — vO-AUTO.2 otonom staleness self-heal kararı (PURE, deterministik).
 *
 * autopilot --heal: bench bayat + server up + cooldown geçmiş ise benchprompt --refresh tetikler
 * (0-manuel: "en-verimli seçim" elle müdahalesiz taze kalır). I/O yok → test edilebilir.
 * Debounce (cooldown) = ardışık ağır-refresh thrash'ini önler (p-debounce deseni, native).
 */

export const COOLDOWN_H = 12; // varsayılan: en fazla 12 saatte bir ağır bench (DOCTOR/OPTIMIZE_STALE_DAYS ile uyumlu)

export interface RefreshDecision { go: boolean; reason: string }

export interface RefreshInput {
  stale: boolean;        // MODEL_SELECTION.stale (veya yaş > staleDays)
  serverUp: boolean;     // :3000 /api/health yanıt verdi mi (refresh path şart)
  lastAttemptMs: number; // son refresh DENEME zamanı (stamp; 0 = hiç)
  nowMs: number;
  cooldownHours: number;
}

/**
 * Otonom refresh kararı:
 * - taze → atla (gereksiz iş yok)
 * - bayat + server kapalı → atla, bench-lane'e devir (orchestration heavy-bench KOŞMAZ)
 * - bayat + up + cooldown aktif → atla (debounce: thrash yok)
 * - bayat + up + cooldown geçti → TAZELE
 */
export function shouldAutoRefresh(input: RefreshInput): RefreshDecision {
  const { stale, serverUp, lastAttemptMs, nowMs, cooldownHours } = input;
  if (!stale) return { go: false, reason: "bench taze (fresh) → refresh gereksiz, atla" };
  if (!serverUp) return { go: false, reason: "bayat ama server :3000 kapalı → bench-lane'e devir (heavy-bench orchestration'da koşmaz)" };
  const elapsedH = (nowMs - lastAttemptMs) / 3_600_000;
  if (elapsedH < cooldownHours) {
    return { go: false, reason: `bayat + up ama cooldown aktif (${elapsedH.toFixed(1)}h < ${cooldownHours}h) → debounce, atla` };
  }
  return { go: true, reason: `bayat + server up + cooldown geçti (${elapsedH.toFixed(1)}h) → tazele (benchprompt --refresh)` };
}
