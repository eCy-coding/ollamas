// stack-health (doctor) — ONE green/red gate for "is the ollamas stack permanently
// healthy?". Aggregates the three pillars Emre cares about: the :3000 server, the local
// model runtime, and the brain/memory + Obsidian mirror. Read-only. `--json` for panels.
// Exit 1 if any CRITICAL check is red, so `npm run doctor` is CI/launchd-gate friendly.
//   npm run doctor            # human table
//   npm run doctor -- --json  # machine
import { execSync } from "node:child_process";

const APP = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const JSON_OUT = process.argv.includes("--json");

type Sev = "CRITICAL" | "HIGH" | "MED";
interface Check { name: string; sev: Sev; status: "PASS" | "FAIL" | "WARN"; detail: string }

const getJson = async (url: string, ms = 8000): Promise<{ ok: boolean; status: number; body: any }> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  let body: any; try { body = JSON.parse(t); } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
};

/** launchd job liveness: PASS if last exit was 0 and (KeepAlive job running | periodic
 *  job ran recently). We read `launchctl print` — the single source of truth. */
function jobHealth(label: string, expectRunning: boolean): Check {
  try {
    const out = execSync(`launchctl print gui/$(id -u)/${label} 2>/dev/null`, { encoding: "utf8", shell: "/bin/zsh" });
    const state = /state = (\S+)/.exec(out)?.[1] || "unknown";
    const lastExit = /last exit code = (\S+)/.exec(out)?.[1] || "?";
    const runs = /runs = (\d+)/.exec(out)?.[1] || "0";
    const running = state === "running";
    const exitOk = lastExit === "0" || lastExit === "(never" || lastExit === "(never exited)";
    // brain-maintain exits 3 by design when it detects embedding drift — that's a memory
    // WARN (run `make brain-reembed`), not a job crash. Distinguish so the table is honest.
    const drift = lastExit === "3";
    const ok = expectRunning ? running : exitOk;
    const status: Check["status"] = ok ? "PASS" : drift ? "WARN" : "FAIL";
    const note = drift ? " — DRIFT: run `make brain-reembed`" : "";
    return { name: `launchd:${label}`, sev: expectRunning ? "CRITICAL" : "MED",
      status, detail: `state=${state} lastExit=${lastExit} runs=${runs}${note}` };
  } catch (e: any) {
    return { name: `launchd:${label}`, sev: expectRunning ? "CRITICAL" : "MED", status: "FAIL", detail: `not loaded: ${e?.message || e}` };
  }
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. Server :3000 — the whole stack's front door.
  try {
    const h = await getJson(`${APP}/api/health`);
    const dbUp = h.body?.db === "up" || h.body?.isLive === true || h.status === 200;
    checks.push({ name: "server.health", sev: "CRITICAL", status: h.status === 200 && dbUp ? "PASS" : "FAIL", detail: `GET /api/health -> ${h.status}${h.body?.db ? ` db=${h.body.db}` : ""}` });
  } catch (e: any) {
    checks.push({ name: "server.health", sev: "CRITICAL", status: "FAIL", detail: `unreachable: ${e?.message || e}` });
  }

  // 2. Local model runtime — real-coding / embedder availability.
  try {
    const t = await getJson(`${OLLAMA}/api/tags`);
    const n = Array.isArray(t.body?.models) ? t.body.models.length : 0;
    const hasEmbed = (t.body?.models || []).some((m: any) => /embed/i.test(m.name));
    checks.push({ name: "ollama.runtime", sev: "HIGH", status: n > 0 ? "PASS" : "FAIL", detail: `${n} models, embed=${hasEmbed}` });
  } catch (e: any) {
    checks.push({ name: "ollama.runtime", sev: "HIGH", status: "FAIL", detail: `unreachable: ${e?.message || e}` });
  }

  // 3. Brain + Obsidian mirror — memory integrity + human-facing vault freshness.
  try {
    const s = await getJson(`${APP}/api/brain/obsidian/status`);
    const drift = Number(s.body?.drift ?? -1);
    const synced = s.body?.lastSync != null;
    checks.push({ name: "brain.obsidian", sev: "MED",
      status: synced && Math.abs(drift) <= 2 ? "PASS" : "WARN",
      detail: `mem=${s.body?.brainMemories} drift=${drift} entities=${s.body?.entities} conflicts=${s.body?.conflicts} synced=${synced}` });
  } catch (e: any) {
    checks.push({ name: "brain.obsidian", sev: "MED", status: "WARN", detail: `status unavailable: ${e?.message || e}` });
  }

  // 4. Always-on + periodic launchd agents.
  checks.push(jobHealth("com.ollamas.server", true));
  checks.push(jobHealth("com.ollamas.brain-loop", false));
  checks.push(jobHealth("com.ollamas.brain-obsidian-sync", false));
  checks.push(jobHealth("com.ollamas.brain-maintain", false));

  return checks;
}

run().then((checks) => {
  const order: Record<Sev, number> = { CRITICAL: 0, HIGH: 1, MED: 2 };
  checks.sort((a, b) => order[a.sev] - order[b.sev]);
  const redCritical = checks.some((c) => c.status === "FAIL" && c.sev === "CRITICAL");
  if (JSON_OUT) {
    console.log(JSON.stringify({ green: !redCritical, checks }, null, 2));
  } else {
    const icon = (s: Check["status"]) => (s === "PASS" ? "✓" : s === "WARN" ? "~" : "✗");
    for (const c of checks) console.log(`  ${icon(c.status)} [${c.sev.padEnd(8)}] ${c.name.padEnd(22)} ${c.status} ${c.detail}`);
    console.log(`\n  ${redCritical ? "✗ RED — a CRITICAL check failed" : "✓ GREEN — stack healthy"}`);
  }
  process.exit(redCritical ? 1 : 0);
}).catch((e) => { console.error(`doctor crashed: ${e?.message || e}`); process.exit(1); });
