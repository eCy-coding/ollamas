#!/usr/bin/env tsx
/**
 * orchestration/bin/heartbeat.ts — Otonom sürdürülebilir tick (vO9).
 *
 * READ-ONLY (+§3.1 notify/nudge): tek tick → conduct kararı + aktif claim'ler → collision-safe
 * tek-eylem + stuck lane tespit → delta-notify (yalnız değişince). Sürdürülebilir: launchd plist /
 * --watch setInterval ile periyodik. Lane'i act ETMEZ (§3) — observe+decide+notify.
 *
 * Çalıştır: tsx orchestration/bin/heartbeat.ts [--once|--watch N] [--nudge] [--quiet]
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaims, activeClaims, type ClaimEvent } from "./lib/claims";
import { notify, nudge } from "./lib/signal";
import { stateHash, shouldNotify, staleLanes, tickDecision, reqToConductAction, readinessAlert, type ConductAction, type LaneAge, type FuseReq } from "./lib/heartbeat";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const STATE = join(ORCH_DIR, "heartbeat-state.jsonl");
// The work-claim ledger lives at seyir/work-claim.jsonl (lib/claims defaultStore) — NOT
// orchestration/claims.jsonl (which never existed) → readActiveClaims always returned []
// → collision-avoidance was a silent no-op. Point at the real ledger.
export const CLAIMS = join(ORCH_DIR, "seyir", "work-claim.jsonl");
const IDLE_H = Number(process.env.ORCH_IDLE_HOURS || 6);

const argv = new Set(process.argv.slice(2));
const DO_NUDGE = argv.has("--nudge");
const QUIET = argv.has("--quiet");
const watchIdx = process.argv.indexOf("--watch");
const WATCH_SEC = watchIdx >= 0 ? Number(process.argv[watchIdx + 1] || 600) : 0;
const srcIdx = process.argv.indexOf("--source");
const SOURCE = srcIdx >= 0 ? process.argv[srcIdx + 1] : "fuse"; // vO14: default birleşik-kritik fuse

const TSX = join(HERE, "..", "..", "..", "ollamas", "node_modules", ".bin", "tsx");

interface TickInput { ts: string; action: ConductAction | null; findings: ConductAction[]; readiness: number; }

/** Child tsx exec — non-zero exit'te bile stdout döndür (conduct RED'de exit 1 yapar ama JSON geçerli). */
function execJson(script: string, timeout = 30000): string {
  try {
    return execFileSync(TSX, [join(HERE, script), "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout });
  } catch (e: any) {
    return typeof e?.stdout === "string" ? e.stdout : ""; // gate exit-1 → stdout yine geçerli
  }
}

/** conduct.ts --json → {ts, action, findings}. (--source conduct; geri-uyumlu). */
function runConduct(): TickInput | null {
  try {
    const j = JSON.parse(execJson("conduct.ts"));
    return { ts: j.ts, action: j.action ?? null, findings: j.findings ?? [], readiness: 100 };
  } catch { return null; }
}

/** fuse.ts --json → {readiness, top, requirements} → birleşik-kritik (vO14 default). */
function runFuse(): TickInput | null {
  try {
    const j = JSON.parse(execJson("fuse.ts"));
    const reqs: FuseReq[] = j.requirements ?? [];
    return {
      ts: j.ts ?? new Date().toISOString(),
      action: reqToConductAction(j.top ?? null),
      findings: reqs.map((r) => reqToConductAction(r)).filter((a): a is ConductAction => !!a),
      readiness: typeof j.readiness === "number" ? j.readiness : 100,
    };
  } catch { return null; }
}

function runSource(): TickInput | null {
  return SOURCE === "conduct" ? runConduct() : runFuse();
}

/** collect lane ageHours/idle — conduct findings yetmezse status.json yerine git'ten. */
function laneAges(findings: ConductAction[]): LaneAge[] {
  // conduct STALE finding'leri zaten idle+yaşı kodlar; detail "<lane> Ns commitsiz".
  const out: LaneAge[] = [];
  for (const f of findings) {
    if (f.tier === "STALE") {
      const m = f.detail.match(/(\d+)s/);
      out.push({ lane: f.lane, ageHours: m ? Number(m[1]) : IDLE_H + 1, idle: true });
    }
  }
  return out;
}

function prevHash(): string {
  if (!existsSync(STATE)) return "";
  const lines = readFileSync(STATE, "utf8").trim().split("\n").filter(Boolean);
  try { return lines.length ? JSON.parse(lines[lines.length - 1]).hash || "" : ""; } catch { return ""; }
}

export function readActiveClaims(now: number, claimsPath: string = CLAIMS): ClaimEvent[] {
  if (!existsSync(claimsPath)) return [];
  try { return activeClaims(parseClaims(readFileSync(claimsPath, "utf8")), now); } catch { return []; }
}

function tick(now: number): boolean {
  const src = runSource();
  if (!src) { if (!QUIET) console.error(`[heartbeat] ${SOURCE} çalışmadı — tick atlandı.`); return false; }

  const active = readActiveClaims(now);
  const stale = staleLanes(laneAges(src.findings), IDLE_H);
  const res = tickDecision(src.action, src.findings, active, stale);

  // readiness state-hash'e dahil → readiness değişince de bildir (alert-fatigue korunur).
  const curHash = stateHash(res.action, [...res.stale, `r:${src.readiness}`]);
  const changed = shouldNotify(prevHash(), curHash);
  const alert = readinessAlert(src.readiness);
  const msg = `${res.notifyMsg} · readiness ${src.readiness}/100${alert ? " · " + alert : ""}`;

  if (changed) {
    notify(msg);
    if (DO_NUDGE) {
      for (const lane of res.stale) {
        // §3.1: yalnız teşhis, dry-run default (gerçek gönderim ORCH_NUDGE_LIVE ile).
        nudge({ app: "terminal", tty: "", session: lane }, "git status", { dryRun: !process.env.ORCH_NUDGE_LIVE });
      }
    }
  }
  if (!QUIET) console.log(`[heartbeat:${SOURCE}] ${src.ts} · eylem=${res.action ? res.action.tier + ":" + res.action.lane : "yok"}${res.claimedElsewhere ? " (collision→sonraki)" : ""} · stuck=${res.stale.length} · readiness=${src.readiness} · ${changed ? "NOTIFY" : "sessiz"}`);

  appendFileSync(STATE, JSON.stringify({ ts: src.ts, hash: curHash, source: SOURCE, action: res.action?.kind ?? null, readiness: src.readiness, stale: res.stale, claimedElsewhere: res.claimedElsewhere }) + "\n");
  return true;
}

function main(): void {
  const nowFn = () => Date.now();
  if (WATCH_SEC > 0) {
    if (!QUIET) console.error(`[heartbeat] --watch ${WATCH_SEC}s (SIGINT ile çık)`);
    tick(nowFn());
    const id = setInterval(() => tick(nowFn()), WATCH_SEC * 1000);
    process.on("SIGINT", () => { clearInterval(id); console.error("\n[heartbeat] durdu."); process.exit(0); });
  } else {
    tick(nowFn()); // --once (default)
  }
}

// CLI-guard: run only when invoked directly (tsx heartbeat.ts), NOT on import — so the
// exported CLAIMS/readActiveClaims are import-safe for tests/tools (no side-effect tick).
if (process.argv[1] && /heartbeat\.ts$/.test(process.argv[1])) main();
