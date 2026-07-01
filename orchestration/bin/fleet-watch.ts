#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-watch.ts — LIVE follow-along console for the model-fleet (operator watches).
 *
 * Zero-dep. Renders, per stream/slot: live claim state (running/idle) + report verdict + the last log
 * lines. `--watch` refreshes every FLEET_WATCH_SEC (default 3s) on the alt-screen (SIGINT restores).
 * The operator runs this in their own tab to follow everything live; `.log` files are also tail-able:
 *   tail -f ~/.llm-mission-control/fleet/logs/<stream>.<slot>.log
 *
 * Run:
 *   tsx orchestration/bin/fleet-watch.ts            # one snapshot
 *   tsx orchestration/bin/fleet-watch.ts --watch    # live loop (Ctrl-C to stop)
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { defaultStore, readClaims, activeClaims } from "./lib/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEYIR_DIR = join(HERE, "..", "seyir");
const FLEET_HOME = join(homedir(), ".llm-mission-control", "fleet");
const LOGS = join(FLEET_HOME, "logs");
const REPORTS = join(FLEET_HOME, "reports");
const WATCH = process.argv.includes("--watch");
const PERIOD = Math.max(1, Number(process.env.FLEET_WATCH_SEC || 3)) * 1000;
const TAIL = Math.max(1, Number(process.env.FLEET_WATCH_TAIL || 2));

function lastLines(file: string, n: number): string[] {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n); } catch { return []; }
}
function reportVerdict(stream: string, slot: string): string {
  const f = join(REPORTS, `${stream}.${slot}.json`);
  if (!existsSync(f)) return "—";
  try { const j = JSON.parse(readFileSync(f, "utf8")); return `${j.verdict ?? "?"}·${(j.steps ?? []).length}st`; }
  catch { return "partial"; }
}

function render(): string {
  const now = Date.now();
  const active = activeClaims(readClaims(defaultStore(SEYIR_DIR)), now);
  const activeKey = new Set(active.map((c) => `${c.lane}.${c.version}`));
  const logs = existsSync(LOGS) ? readdirSync(LOGS).filter((f) => f.endsWith(".log")).sort() : [];
  const L: string[] = [
    `🛰  FLEET WATCH — canlı (ollamas model-fleet) · ${new Date(now).toISOString().slice(11, 19)}Z`,
    `   active claims: ${active.length}${active.length ? " (" + active.map((c) => `${c.lane}|${c.version}`).join(", ") + ")" : ""}`,
    `   .log dir: ${LOGS}  ·  tail -f <stream>.<slot>.log`,
    ``,
  ];
  if (!logs.length) { L.push("   (henüz worker yok — fleet-launch.ts --go ile başlat)"); return L.join("\n"); }
  for (const lf of logs) {
    const base = lf.replace(/\.log$/, "");
    const [stream, slot] = base.split(".");
    const running = activeKey.has(`${stream}.${slot}`) ? "🟢RUN" : "⚪idle";
    const verdict = reportVerdict(stream, slot);
    let age = "";
    try { age = `${Math.round((now - statSync(join(LOGS, lf)).mtimeMs) / 1000)}s`; } catch { /* ignore */ }
    L.push(`── ${stream}/${slot}  ${running}  verdict=${verdict}  (log ${age} ago)`);
    for (const line of lastLines(join(LOGS, lf), TAIL)) L.push(`   ${line.slice(0, 160)}`);
  }
  return L.join("\n");
}

async function main(): Promise<void> {
  if (!WATCH) { process.stdout.write(render() + "\n"); return; }
  process.stdout.write("\x1b[?1049h"); // alt-screen
  const restore = () => { process.stdout.write("\x1b[?1049l"); process.exit(0); };
  process.on("SIGINT", restore); process.on("SIGTERM", restore);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    process.stdout.write("\x1b[H\x1b[2J" + render() + "\n\n(Ctrl-C: çık)\n");
    await new Promise((r) => setTimeout(r, PERIOD));
  }
}

main();
