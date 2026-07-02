#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-run.ts — the ONE command that runs the fleet end-to-end (the systematic work
 * algorithm): PREFLIGHT (bridge + server + workspace=repo) → LAUNCH (fleet-launch --go --sequenced, T1→Tn,
 * ≤2/model) → CONDUCT LOOP (poll fleet-conduct until every stream is gated, bounded rounds; the persistent
 * living workers self-retry, so we observe/collect rather than double-dispatch) → REPORT (done/missing).
 *
 * Claude = conductor. This driver is the automated lieutenant (görev ver: launch; veri al: conduct) — it
 * holds no authority of its own and never mutates the repo (workers are PROPOSE-only --no-apply).
 *
 * Run:  tsx orchestration/bin/fleet-run.ts [--cloud-only] [--streams a,b] [--rounds 3] [--dry]
 * Env:  OLLAMAS_URL (default :3000), FLEET_RUN_POLL_SEC (default 30).
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preflight, isRunConverged, shouldContinueRun, renderRunReport, type RunRound, type StreamState } from "./lib/fleet-run";
import { selectWorkspaceRequest, parseWorkspaceResp } from "./lib/workspace";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const CLOUD_ONLY = argv.includes("--cloud-only");
const DRY = argv.includes("--dry");
const STREAMS = flag("--streams");
const ROUNDS = Number(flag("--rounds", "3"));
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const BRIDGE_URL = process.env.HOST_BRIDGE_URL || "http://127.0.0.1:7345";
const POLL_MS = Math.max(5, Number(process.env.FLEET_RUN_POLL_SEC || 30)) * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } };

async function reachable(url: string): Promise<boolean> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}

/** Is the server's agent workspace already the repo? (reads /api/health workspacePath.) */
async function workspaceIsRepo(): Promise<boolean> {
  try { const j: any = await (await fetch(`${OLLAMAS_URL}/api/health`, { signal: AbortSignal.timeout(2500) })).json(); return j?.workspacePath === REPO; } catch { return false; }
}

async function setWorkspace(): Promise<void> {
  const req = selectWorkspaceRequest(OLLAMAS_URL, REPO);
  try {
    const res = await fetch(req.url, { method: req.method, headers: { "Content-Type": req.contentType }, body: req.body, signal: AbortSignal.timeout(4000) });
    const r = parseWorkspaceResp(await res.text());
    console.log(r.ok ? `  ↳ workspace → ${r.workspacePath}` : `  ⚠ workspace set failed: ${r.error}`);
  } catch (e: any) { console.log(`  ⚠ workspace set skipped: ${(e?.message ?? e).slice(0, 60)}`); }
}

/** One conduct snapshot via `fleet-conduct --json`. Returns {done,total,converged,streams}. */
function conduct(): { done: number; total: number; converged: boolean; streams: StreamState[] } {
  try {
    const out = execFileSync(TSX, [join(HERE, "fleet-conduct.ts"), "--json"], { encoding: "utf8", timeout: 30000 });
    const j = JSON.parse(out);
    const per = (j.perStream ?? []) as { stream: string; ensembleDone: boolean }[];
    const streams: StreamState[] = per.map((p) => ({ stream: p.stream, done: !!p.ensembleDone }));
    const done = streams.filter((s) => s.done).length;
    return { done, total: streams.length, converged: !!j.converged && streams.length > 0, streams };
  } catch { return { done: 0, total: 0, converged: false, streams: [] }; }
}

async function main(): Promise<void> {
  const ts = nowIso();
  console.log(`🛰  fleet-run — systematic end-to-end driver${CLOUD_ONLY ? " [cloud-only]" : ""}${DRY ? " [dry]" : ""}`);

  // ── PREFLIGHT ──
  const [bridgeOk, serverOk] = await Promise.all([reachable(`${BRIDGE_URL}/health`), reachable(`${OLLAMAS_URL}/api/health`)]);
  const wsOk = serverOk ? await workspaceIsRepo() : false;
  const pf = preflight({ bridgeOk, serverOk, workspaceOk: wsOk });
  console.log(`  preflight: bridge=${bridgeOk ? "✅" : "❌"} server=${serverOk ? "✅" : "❌"} workspace=repo=${wsOk ? "✅" : "→will set"}`);
  for (const i of pf.issues) console.log(`    · ${i}`);
  if (!pf.ready) { console.error(`fleet-run: preflight FAILED — çöz + tekrar dene.`); process.exit(3); }
  if (!wsOk) await setWorkspace();

  if (DRY) {
    const dry = execFileSync(TSX, [join(HERE, "fleet-launch.ts"), "--sequenced", ...(CLOUD_ONLY ? ["--cloud-only"] : []), ...(STREAMS ? ["--streams", STREAMS] : [])], { encoding: "utf8" });
    console.log(dry);
    console.log(`[dry] would then poll fleet-conduct for ${ROUNDS} rounds until CONVERGED.`);
    return;
  }

  // ── LAUNCH (sequenced, ≤2/model) ──
  const launchArgs = ["--go", "--sequenced", ...(CLOUD_ONLY ? ["--cloud-only"] : []), ...(STREAMS ? ["--streams", STREAMS] : [])];
  console.log(`  launch: fleet-launch ${launchArgs.join(" ")}`);
  try { console.log(execFileSync(TSX, [join(HERE, "fleet-launch.ts"), ...launchArgs], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => "    " + l).join("\n")); }
  catch (e: any) { console.error(`  ⚠ launch: ${(e?.message ?? e).slice(0, 80)}`); }

  // ── CONDUCT LOOP (bounded; living workers self-retry, we collect) ──
  const rounds: RunRound[] = [];
  let round = 0, snap = conduct();
  console.log(`  ↳ round 0: ${snap.done}/${snap.total} gated${snap.converged ? " · ✅ CONVERGED" : ""}`);
  while (shouldContinueRun(round, ROUNDS, snap.converged)) {
    round++;
    await sleep(POLL_MS);
    snap = conduct();
    rounds.push({ round, done: snap.done, total: snap.total, redispatched: 0, converged: snap.converged });
    console.log(`  ↳ round ${round}: ${snap.done}/${snap.total} gated${snap.converged ? " · ✅ CONVERGED" : ""}`);
  }
  if (!rounds.length) rounds.push({ round: 0, done: snap.done, total: snap.total, redispatched: 0, converged: snap.converged });

  // ── REPORT ──
  const converged = isRunConverged(snap.done, snap.total);
  writeFileSync(join(ORCH_DIR, "FLEET_RUN.md"), renderRunReport(rounds, snap.streams, ROUNDS, ts) + "\n");
  console.log(`\nFLEET RUN — ${converged ? "✅ CONVERGED" : `⏳ ${snap.done}/${snap.total} (bounded ${ROUNDS} round)`}:`);
  for (const s of snap.streams) console.log(`  ${s.done ? "✅" : "⏳"} ${s.stream}`);
  console.log(`Rapor: orchestration/FLEET_RUN.md · canlı takip: /fleet-watch · kill: fleet-conduct --stop`);
  process.exit(converged ? 0 : 1);
}

main().catch((e) => { console.error(`fleet-run: ${e?.message ?? e}`); process.exit(1); });
