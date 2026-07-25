#!/usr/bin/env -S npx tsx
// plan — the headless spine of the autonomous loop (H8.5): one command that builds BOTH targets
// (repo web/help ‖ vault _help), runs the gate, verifies the coded site, and reports which gaps
// still need a parallel-planner AI to dispatch. CI-usable: exit non-zero if the gate fails.
//
// WHY THIS EXISTS
// The council runs a repeating loop — decide → build → verify → re-plan → commit. The AI-planning
// step needs Claude subagents (not available in plain CI), but everything MECHANICAL around it can
// run headless: this command IS that mechanical spine. It never fabricates a plan; it prints the
// pending gaps so a human or an agent picks them up, and it fails loudly if a site is incomplete.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SEED_GAPS, mergeGaps, pendingGaps, type Gap } from "../lib/gaps";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");

let stepNo = 0;
/** logfmt-ish line: `NN │ plan │ LEVEL │ message` (level as a WORD, per the readable-flow rule). */
function log(level: "BİLGİ" | "TAMAM" | "HATA", msg: string) {
  console.log(`${String(++stepNo).padStart(2, "0")} │ plan │ ${level.padEnd(5)} │ ${msg}`);
}

/** Run a build step; return true on success. Output is captured and only shown on failure. */
function run(desc: string, cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { cwd: REPO, stdio: ["ignore", "ignore", "pipe"], timeout: 180_000 });
    log("TAMAM", desc);
    return true;
  } catch (e) {
    log("HATA", `${desc} — ${(e as Error).message.split("\n")[0]}`);
    return false;
  }
}

/** The overlaid gap set (seeds + any planner plans persisted to help-gaps.json). */
function currentGaps(): Gap[] {
  const f = join(REPO, "pipeline", "help-gaps.json");
  if (!existsSync(f)) return SEED_GAPS;
  try {
    return mergeGaps(SEED_GAPS, JSON.parse(readFileSync(f, "utf8")) as Gap[]);
  } catch {
    return SEED_GAPS;
  }
}

function main() {
  const strict = process.argv.includes("--strict"); // fail if any high-severity gap is still pending
  log("BİLGİ", "autonomous-loop spine — repo ‖ vault, source-true, MISS≠PASS");

  // 1) Build both targets (help-site validates each system → throws/exits non-zero on incomplete).
  const built = run("iki hedefi kur (repo web/help ‖ vault _help)", "npx", ["tsx", "pipeline/bin/help-site.ts", "all", "--out=web/help", "--vault"]);
  // 2) Verify the coded site (links resolve, 0 dangling, search non-empty, llms.txt, refs).
  const verified = built && run("kodlanmış siteyi doğrula (link/arama/llms.txt/kaynaklar)", "npx", ["tsx", "pipeline/bin/help-site.ts", "all", "--verify"]);

  // 3) Gap report — what still needs a parallel planner to dispatch.
  const gaps = currentGaps();
  const pending = pendingGaps(gaps);
  const highPending = pending.filter((g) => g.severity === "high");
  log("BİLGİ", `eksik: ${gaps.length} toplam · ${pending.length} bekleyen (${highPending.length} yüksek) · ${gaps.length - pending.length} planlı`);
  for (const g of pending.slice(0, 10)) log("BİLGİ", `→ DISPATCH ${g.system}/${g.area} (${g.severity}): ${g.evidence.slice(0, 80)}`);
  if (!pending.length) log("TAMAM", "tüm eksikler paralel planlayıcılara havale edilmiş (bekleyen 0)");

  const ok = built && verified && (!strict || highPending.length === 0);
  log(ok ? "TAMAM" : "HATA", `karar: ${ok ? "GEÇTİ" : "DÜŞTÜ"}${strict ? " (strict)" : ""}`);
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { currentGaps };
