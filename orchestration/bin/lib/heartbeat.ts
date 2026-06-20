/**
 * orchestration/bin/lib/heartbeat.ts — Otonom heartbeat çekirdeği (zero-dep, pure).
 *
 * Periyodik tick mantığı: conduct kararı + aktif claim'ler → collision-safe tek-eylem +
 * stuck lane tespit + delta-notify (yalnız değişince). ML YOK, deterministik.
 * Pattern ref: k8s liveness (last-seen>eşik=stuck), GitOps delta-notify, file-lease (claims.ts).
 */
import type { ClaimEvent } from "./claims";

export interface ConductAction { tier: string; lane: string; kind: string; detail: string; action: string; severity: number; }
export interface LaneAge { lane: string; ageHours: number; idle: boolean }
export interface TickResult { action: ConductAction | null; claimedElsewhere: boolean; stale: string[]; notifyMsg: string; }

/** djb2 deterministik hash (zero-dep) → delta-notify anahtarı. */
export function stateHash(action: ConductAction | null, stale: string[]): string {
  const s = `${action ? action.kind : "none"}|${[...stale].sort().join(",")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** State değişti mi (alert-fatigue önle). */
export function shouldNotify(prevHash: string, curHash: string): boolean {
  return prevHash !== curHash;
}

/** ageHours > eşik olan idle lane'ler → stuck. Infinity (commit yok) guard: dahil etme. */
export function staleLanes(lanes: LaneAge[], thresholdH = 6): string[] {
  return lanes
    .filter((l) => l.idle && Number.isFinite(l.ageHours) && l.ageHours > thresholdH)
    .map((l) => l.lane)
    .sort();
}

/**
 * Collision-aware tek-eylem. conduct'un seçtiği eylemin lane'i başka sekmece aktif
 * claim'liyse → sonraki claim'siz öncelikli finding'i seç. Hepsi claim'liyse → null + idle.
 * lane↔version eşlemesi: claim lane bazında (version conduct'tan gelmez; lane-aktiflik yeterli).
 */
export function tickDecision(
  conductAction: ConductAction | null,
  findings: ConductAction[],
  active: ClaimEvent[],
  stale: string[],
): TickResult {
  const claimedLanes = new Set(active.map((c) => c.lane));
  const isClaimed = (a: ConductAction) => claimedLanes.has(a.lane);

  let action = conductAction;
  let claimedElsewhere = false;

  if (conductAction && isClaimed(conductAction)) {
    claimedElsewhere = true;
    // findings zaten öncelik sırasında değil — tier+severity ile sırala, ilk claim'siz seç.
    const ordered = [...findings].sort((a, b) => rankTier(a.tier) - rankTier(b.tier) || b.severity - a.severity || a.lane.localeCompare(b.lane));
    action = ordered.find((f) => !isClaimed(f)) ?? null;
  }

  const next = action ? `${action.tier}:${action.lane} — ${action.action}` : "tüm öncelikli eylemler başka sekmede claim'li (idle)";
  const staleStr = stale.length ? ` · stuck=[${stale.join(",")}]` : "";
  const notifyMsg = `conductor: ${next}${staleStr}`;
  return { action, claimedElsewhere, stale, notifyMsg };
}

const TIER_ORDER = ["CRITICAL", "RED", "SECURITY", "CONTRACT", "DRIFT", "REGRESSION", "COMPLETENESS", "STALE", "ROADMAP"];
function rankTier(t: string): number { const i = TIER_ORDER.indexOf(t); return i < 0 ? 99 : i; }

// ── vO14: fuse REQUIREMENTS → heartbeat (birleşik-kritik kaynak) ───────────────

export interface FuseReq { criticality: string; source?: string; target: string; detail: string; action: string; score?: number; }

/** fuse Requirement → mevcut ConductAction şekli (tickDecision değişmeden çalışsın). Saf. */
export function reqToConductAction(req: FuseReq | null): ConductAction | null {
  if (!req) return null;
  // target "gate:backend" / "crit:..:lane" → lane çıkar (son ':' sonrası ya da "orchestration").
  const parts = req.target.split(":");
  const lane = parts.length > 1 ? parts[parts.length - 1] : "orchestration";
  return {
    tier: req.criticality,           // CRITICAL/SECURITY/... TIER_ORDER ile hizalı
    lane,
    kind: req.target,                // stabil anahtar (reconcile/delta için)
    detail: req.detail,
    action: req.action,
    severity: typeof req.score === "number" ? req.score : 50,
  };
}

/** readiness < eşik → proje-hazır-değil uyarısı (notify'a eklenir). Saf. */
export function readinessAlert(readiness: number, threshold = 70): string {
  return readiness < threshold ? `⚠️ PROJE HAZIR DEĞİL (${readiness}/100)` : "";
}
