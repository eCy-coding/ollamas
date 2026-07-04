#!/usr/bin/env tsx
/**
 * orchestration/bin/doctor.ts — vO-AUTO.1 autopilot kurulum sağlık denetimi: hook+launchd+artefakt tazeliği (GO/NO-GO gate).
 *
 * "0-manuel autopilot gerçekten CANLI + TAZE mi?" denetler → DOCTOR.md + stdout + exit-code
 * (NO-GO→1, conduct-gate uyumlu). `--fix`: yalnız selfHealable uyarıları güvenle giderir
 * (bench-stale→benchprompt --refresh, artifacts→autopilot); settings.json/launchctl AKTİVASYONU
 * ASLA otomatik (guardrail/privileged) → exact-komut yazdırıp kullanıcıya devreder.
 *
 * Çalıştır: tsx orchestration/bin/doctor.ts [--fix] [--quiet]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHOR } from "./shared";
import { runChecks, verdict, renderDoctor, type DoctorInput } from "./lib/doctor";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const WT_ROOT = join(ORCH_DIR, "..");
const TSX = join(ANCHOR, "node_modules", ".bin", "tsx");
const FIX = process.argv.includes("--fix");
const QUIET = process.argv.includes("--quiet");
const STALE_DAYS = Number(process.env.DOCTOR_STALE_DAYS || 2);

function read(p: string): string { try { return readFileSync(p, "utf8"); } catch { return ""; } }
function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function launchctl(): string { try { return execFileSync("launchctl", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } }

function gather(): DoctorInput {
  const artifacts: Record<string, boolean> = {};
  for (const f of ["MODEL_PROMPT.md", "CONDUCTOR.md", "AUTOPILOT.md"]) artifacts[f] = existsSync(join(ORCH_DIR, f));
  return {
    settings: read(join(WT_ROOT, ".claude", "settings.json")),
    launchctlOut: launchctl(),
    selection: readJson(join(ORCH_DIR, "MODEL_SELECTION.json")) || {},
    artifacts,
    nowMs: Date.now(),
    staleDays: STALE_DAYS,
  };
}

/** Yalnız selfHealable uyarıları güvenle gider (privileged ASLA). */
function selfHeal(): void {
  const cs = runChecks(gather());
  for (const c of cs) {
    if (c.status === "ok" || !c.selfHealable) continue;
    try {
      if (c.id === "bench-fresh") {
        if (!QUIET) console.error("[doctor --fix] bench tazeleme: benchprompt.ts --refresh");
        execFileSync(TSX, [join(HERE, "benchprompt.ts"), "--refresh"], { stdio: ["ignore", "ignore", "inherit"], timeout: 620_000, cwd: ORCH_DIR });
      } else if (c.id === "artifacts") {
        if (!QUIET) console.error("[doctor --fix] artefakt üret: autopilot.ts");
        execFileSync(TSX, [join(HERE, "autopilot.ts"), "--quiet"], { stdio: ["ignore", "ignore", "inherit"], timeout: 120_000, cwd: ORCH_DIR });
      }
    } catch { if (!QUIET) console.error(`[doctor --fix] ${c.id}: tazeleme başarısız (devral: ${c.fix})`); }
  }
}

function main(): void {
  if (FIX) selfHeal(); // önce safe-heal, sonra yeniden denetle
  const cs = runChecks(gather());
  const v = verdict(cs);
  const md = renderDoctor(cs, v, new Date().toISOString());
  writeFileSync(join(ORCH_DIR, "DOCTOR.md"), md.endsWith("\n") ? md : md + "\n");
  process.stdout.write(md + "\n");
  if (!QUIET) console.error(`[doctor] ${v.go ? "GO" : "NO-GO"} · ${cs.map((c) => `${c.id}:${c.status}`).join(" ")}`);
  if (!v.go) process.exit(1); // NO-GO → gate
}

if (process.argv[1] && /doctor\.ts$/.test(process.argv[1])) main();
