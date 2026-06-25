/**
 * orchestration/bin/lib/claims.ts — vO7 Work-Claim Ledger: paralel sekmelerin AYNI görevi almasını
 * önler (bu oturumda 3× duplikasyonun kök-fix'i, ERR-ORCH-013).
 *
 * Pure çekirdek (parse/fold/active/collision/fence) spawn/IO yapmaz → test edilebilir. I/O sarmalayıcı
 * (acquire/renew/release/read) atomic `mkdirSync` lock + append-only JSONL kullanır (zero-dep).
 * Desen adoption: proper-lockfile (MIT, mkdir-lock + mtime-heartbeat + stale-takeover) reimplement +
 * append-only JSONL LWW + fencing token (idea). Scope §3: yalnız orchestration/seyir/ altına yazar.
 */
import { mkdirSync, rmdirSync, statSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type ClaimStatus = "claimed" | "done" | "released";
export interface ClaimEvent {
  ts: number;        // epoch ms
  tab: string;       // sekme kimliği
  pid: number;
  lane: string;
  version: string;
  status: ClaimStatus;
  ttlMs: number;     // claimed bu süre sonra stale
  fence: number;     // (lane|version) için monoton; diriltilen stale sekme clobber edemez
}

const STATUSES = new Set<ClaimStatus>(["claimed", "done", "released"]);

export function claimKey(lane: string, version: string): string {
  return `${lane}|${version}`;
}

// ── Pure çekirdek ────────────────────────────────────────────────────────────

/** JSONL → ClaimEvent[]. Bozuk/eksik-alan satırı atlanır (graceful, asla throw). */
export function parseClaims(jsonl: string): ClaimEvent[] {
  const out: ClaimEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (
        o && typeof o.ts === "number" && typeof o.tab === "string" &&
        typeof o.lane === "string" && typeof o.version === "string" &&
        STATUSES.has(o.status) && typeof o.ttlMs === "number"
      ) {
        out.push({
          ts: o.ts, tab: o.tab, pid: typeof o.pid === "number" ? o.pid : 0,
          lane: o.lane, version: o.version, status: o.status, ttlMs: o.ttlMs,
          fence: typeof o.fence === "number" ? o.fence : 0,
        });
      }
    } catch { /* bozuk satır atla */ }
  }
  return out;
}

/** a, b'den "daha güncel" mi? LWW sıralaması: ts → fence → tab (deterministik). */
function newer(a: ClaimEvent, b: ClaimEvent): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  if (a.fence !== b.fence) return a.fence > b.fence;
  return a.tab > b.tab;
}

/** Event listesi → key başına son durum (LWW). */
export function foldClaims(events: ClaimEvent[]): Map<string, ClaimEvent> {
  const m = new Map<string, ClaimEvent>();
  for (const e of events) {
    const k = claimKey(e.lane, e.version);
    const cur = m.get(k);
    if (!cur || newer(e, cur)) m.set(k, e);
  }
  return m;
}

/** claimed + ttl içinde mi? */
export function isActive(c: ClaimEvent, now: number): boolean {
  return c.status === "claimed" && now - c.ts < c.ttlMs;
}

/** claimed ama ttl aşıldı mı? (stale → takeover edilebilir) */
export function isStale(c: ClaimEvent, now: number): boolean {
  return c.status === "claimed" && now - c.ts >= c.ttlMs;
}

/** Fold + yalnız canlı (aktif) claim'ler. */
export function activeClaims(events: ClaimEvent[], now: number): ClaimEvent[] {
  return [...foldClaims(events).values()].filter((c) => isActive(c, now));
}

/** Aynı lane|version'ı BAŞKA bir canlı sekme tutuyor mu? Tutuyorsa o claim, yoksa null. */
export function detectCollision(
  events: ClaimEvent[], lane: string, version: string, selfTab: string, now: number,
): ClaimEvent | null {
  const c = foldClaims(events).get(claimKey(lane, version));
  if (c && isActive(c, now) && c.tab !== selfTab) return c;
  return null;
}

/** (lane|version) için bir sonraki monoton fence. Hiç yoksa 1. */
export function nextFence(events: ClaimEvent[], lane: string, version: string): number {
  let max = 0;
  for (const e of events) {
    if (e.lane === lane && e.version === version && e.fence > max) max = e.fence;
  }
  return max + 1;
}

// ── I/O sarmalayıcı (atomic mkdir-lock + append-only JSONL) ───────────────────

const DEFAULT_TTL_MS = Number(process.env.ORCH_CLAIM_TTL_MIN || 20) * 60_000;
const LOCK_STALE_MS = 10_000; // proper-lockfile deseni: 10s sonra lock stale → takeover

export interface ClaimStore { ledgerPath: string; lockDir: string; }

/** Atomic lock: mkdir EEXIST = başkası tutuyor. Stale (mtime>10s) → takeover. */
export function withLock<T>(lockDir: string, fn: () => T): T {
  let held = false;
  for (let i = 0; i < 50 && !held; i++) {
    try {
      mkdirSync(lockDir); // atomik: yoksa oluştur, varsa EEXIST
      held = true;
    } catch {
      // stale lock takeover (sahibi çökmüş)
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch { /* yarış: başkası kaldırdı */ }
      // kısa busy-wait (zero-dep, deterministik döngü)
      const until = Date.now() + 20;
      while (Date.now() < until) { /* spin */ }
    }
  }
  // Lock alınamadıysa fn()'i KOŞULSUZ çalıştırma (eski hata: held=false olsa bile yazardı
  // → başka writer lock'tayken duplicate claim). Lock olmadan yazma = ERR-ORCH-013 riski.
  if (!held) throw new Error("claim lock not acquired (lockDir held by another writer) — aborting to prevent duplicate claim");
  try {
    return fn();
  } finally {
    try { rmdirSync(lockDir); } catch { /* zaten gitti */ }
  }
}

export function defaultStore(seyirDir: string): ClaimStore {
  return { ledgerPath: join(seyirDir, "work-claim.jsonl"), lockDir: join(seyirDir, ".claim.lock") };
}

export function readClaims(store: ClaimStore): ClaimEvent[] {
  if (!existsSync(store.ledgerPath)) return [];
  return parseClaims(readFileSync(store.ledgerPath, "utf8"));
}

function appendEvent(store: ClaimStore, e: ClaimEvent): void {
  mkdirSync(dirname(store.ledgerPath), { recursive: true });
  appendFileSync(store.ledgerPath, JSON.stringify(e) + "\n");
}

export interface AcquireResult { ok: boolean; collision?: ClaimEvent; claim?: ClaimEvent; }

/**
 * Lane|version'ı claim et (atomic). Başka canlı sekme tutuyorsa ok:false + collision döner.
 * Aksi halde monoton fence ile claim append edilir.
 */
export function acquireClaim(
  store: ClaimStore, opts: { lane: string; version: string; tab: string; pid: number; ttlMs?: number; now?: number },
): AcquireResult {
  const now = opts.now ?? Date.now();
  return withLock(store.lockDir, () => {
    const events = readClaims(store);
    const collision = detectCollision(events, opts.lane, opts.version, opts.tab, now);
    if (collision) return { ok: false, collision };
    const claim: ClaimEvent = {
      ts: now, tab: opts.tab, pid: opts.pid, lane: opts.lane, version: opts.version,
      status: "claimed", ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS, fence: nextFence(events, opts.lane, opts.version),
    };
    appendEvent(store, claim);
    return { ok: true, claim };
  });
}

/** Heartbeat: kendi claim'inin ts'ini tazele (TTL'i uzat). */
export function renewClaim(store: ClaimStore, opts: { lane: string; version: string; tab: string; pid: number; ttlMs?: number; now?: number }): ClaimEvent {
  const now = opts.now ?? Date.now();
  return withLock(store.lockDir, () => {
    const events = readClaims(store);
    const claim: ClaimEvent = {
      ts: now, tab: opts.tab, pid: opts.pid, lane: opts.lane, version: opts.version,
      status: "claimed", ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS, fence: nextFence(events, opts.lane, opts.version),
    };
    appendEvent(store, claim);
    return claim;
  });
}

/** Claim'i kapat (status=done|released). */
export function closeClaim(store: ClaimStore, opts: { lane: string; version: string; tab: string; pid: number; status: "done" | "released"; now?: number }): ClaimEvent {
  const now = opts.now ?? Date.now();
  return withLock(store.lockDir, () => {
    const events = readClaims(store);
    const claim: ClaimEvent = {
      ts: now, tab: opts.tab, pid: opts.pid, lane: opts.lane, version: opts.version,
      status: opts.status, ttlMs: 0, fence: nextFence(events, opts.lane, opts.version),
    };
    appendEvent(store, claim);
    return claim;
  });
}
