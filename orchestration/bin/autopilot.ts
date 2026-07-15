#!/usr/bin/env tsx
/**
 * orchestration/bin/autopilot.ts — vO-AUTO 0-manuel orkestrasyon tetikleyici.
 *
 * Mevcut otonom parçaları (benchprompt → conduct → status) SIRAYLA read-only spawn eder,
 * never-throw (hook'u bloklamaz), sonuçları AUTOPILOT.md + stdout'a özetler. SessionStart hook
 * (sekme açılışı) + launchd WatchPaths (bench değişimi) bunu çağırır → operatör komut çalıştırmaz.
 *
 * Yeni MANTIK eklemez — var olanı tetikler (vibe yok). §3 read-only: lane'e yazmaz.
 * Çalıştır: tsx orchestration/bin/autopilot.ts [--quiet]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHOR } from "./shared";
import { summarizeAutopilot, type StepResult } from "./lib/autopilot";
import { shouldAutoRefresh, COOLDOWN_H } from "./lib/refresh";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const TSX = join(ANCHOR, "node_modules", ".bin", "tsx");
const QUIET = process.argv.includes("--quiet");
const HEAL = process.argv.includes("--heal"); // vO-AUTO.2: bayatsa otonom tazele (launchd; SessionStart'ta KAPALI=hızlı)

/** Bir adımı read-only spawn et; never-throw → StepResult. Süreyi process.hrtime ile ölç (Date.now yok). */
function runStep(step: string, script: string, args: string[]): StepResult {
  const t0 = process.hrtime.bigint();
  try {
    execFileSync(TSX, [join(HERE, script), ...args], {
      stdio: ["ignore", "ignore", "ignore"], timeout: 60_000, cwd: ORCH_DIR,
    });
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    return { step, ok: true, ms, detail: detailFor(step) };
  } catch (e: any) {
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    return { step, ok: false, ms, detail: (e?.message ?? "hata").slice(0, 80) };
  }
}

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

/** Adım sonrası üretilen artefakttan kısa detay (pick / next-action) çıkar (best-effort). */
function detailFor(step: string): string {
  if (step === "benchprompt") {
    const sel = readJson(join(ORCH_DIR, "MODEL_SELECTION.json"));
    const m = sel?.selection?.model || Object.values(sel?.champions || {}).map((a: any) => a.model)[0];
    const tok = sel?.selection?.tokS;
    return m ? `pick ${m}${tok ? ` · ${tok} tok/s` : ""}${sel?.stale ? " · ⚠️ STALE" : ""}` : "model seçimi tazelendi";
  }
  if (step === "conduct") {
    const f = join(ORCH_DIR, "CONDUCTOR.md");
    if (existsSync(f)) {
      const line = readFileSync(f, "utf8").split("\n").find((l) => /next|sonraki|aksiyon|action|→/i.test(l) && l.trim().length > 8);
      if (line) return line.replace(/[#>*`|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return "karar tazelendi";
  }
  if (step === "critic") {
    const c = readJson(join(ORCH_DIR, "CRITIC.json"));
    return c ? `completeness skor ${c.score ?? "?"} · ${(c.findings ?? []).length} açık` : "öz-denetim tazelendi";
  }
  if (step === "dod") {
    const d = readJson(join(ORCH_DIR, "DOD.json"));
    return d ? `DoD skor ${d.score ?? "?"} · ${(d.findings ?? []).length} yarım-iş` : "DoD tazelendi";
  }
  if (step === "fuse") {
    const r = readJson(join(ORCH_DIR, "REQUIREMENTS.json"));
    return r ? `hazırlık ${r.readiness ?? "?"}/100 · top ${r.top ? r.top.criticality + ":" + r.top.target : "yok"}` : "gereksinim füzyonu tazelendi";
  }
  if (step === "status") return "lane matrisi tazelendi";
  return "ok";
}

/** doctor adımı: NO-GO'da exit 1 atar (gate) → execFileSync throw; tolere et, DOCTOR.md verdict'ini oku. */
function runDoctor(): StepResult {
  const t0 = process.hrtime.bigint();
  let threw = false;
  try {
    execFileSync(TSX, [join(HERE, "doctor.ts"), "--quiet"], { stdio: ["ignore", "ignore", "ignore"], timeout: 30_000, cwd: ORCH_DIR });
  } catch { threw = true; } // NO-GO exit 1 = beklenen, hata değil
  const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
  // verdict DOCTOR.md'den (read-only): "## ✅ GO ..." veya "## 🛑 NO-GO ...".
  let detail = "readiness bilinmiyor", go = !threw;
  try {
    const line = readFileSync(join(ORCH_DIR, "DOCTOR.md"), "utf8").split("\n").find((l) => /^##\s/.test(l));
    if (line) {
      go = !/NO-GO/.test(line); // NO-GO yoksa GO
      // "## 🛑 NO-GO — sebep" → yalnız "sebep" (lib/autopilot GO/NO-GO ön-ekini kendi ekler).
      detail = line.replace(/^#+\s*/, "").replace(/^[✀-➿☀-⛿✅🛑\s]+/u, "")
        .replace(/^(NO-GO|GO)\s*[—-]\s*/, "").trim().slice(0, 90);
    }
  } catch { /* DOCTOR.md yok */ }
  return { step: "doctor", ok: go, ms, detail };
}

/** server :3000 read-only probe (refresh path şart). */
function serverUp(): boolean {
  try { execFileSync("curl", ["-s", "-m", "2", "-o", "/dev/null", "http://localhost:3000/api/health"], { stdio: ["ignore", "ignore", "ignore"] }); return true; }
  catch { return false; }
}

/** vO-AUTO.2 otonom staleness self-heal: bayat + up + cooldown geçti ise benchprompt --refresh (debounced). */
function runHeal(): StepResult {
  const t0 = process.hrtime.bigint();
  const sel = readJson(join(ORCH_DIR, "MODEL_SELECTION.json")) || {};
  const stampF = join(ORCH_DIR, ".autopilot-refresh.json");
  const lastAttemptMs = readJson(stampF)?.lastAttemptMs || 0;
  const nowMs = Date.now();
  const d = shouldAutoRefresh({ stale: sel.stale === true, serverUp: serverUp(), lastAttemptMs, nowMs, cooldownHours: COOLDOWN_H });
  let ok = true, detail = d.reason;
  if (d.go) {
    writeFileSync(stampF, JSON.stringify({ lastAttemptMs: nowMs }) + "\n"); // stamp ÖNCE → fail'de bile thrash-guard (cooldown)
    try {
      execFileSync(TSX, [join(HERE, "benchprompt.ts"), "--refresh"], { stdio: ["ignore", "ignore", "ignore"], timeout: 620_000, cwd: ORCH_DIR });
      detail = `🔄 auto-refresh tetiklendi — ${d.reason}`;
    } catch (e: any) { ok = false; detail = `auto-refresh hata: ${(e?.message ?? "").slice(0, 50)}`; }
  }
  const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
  return { step: "heal", ok, ms, detail };
}

function main(): void {
  // ISO ts: dosya mtime tabanlı değil — autopilot her koşuda taze tetik; deterministik test PURE fn'de.
  const ts = new Date().toISOString();
  const results: StepResult[] = [
    ...(HEAL ? [runHeal()] : []),  // launchd --heal: bayatsa önce tazele; SessionStart'ta atlanır (hızlı)
    runStep("benchprompt", "benchprompt.ts", []),
    runStep("critic", "critic.ts", []),   // vO11 öz-denetim → CRITIC.json (conduct ÖNCESİ üret)
    runStep("dod", "dod.ts", []),         // vO12 yarım-iş gate → DOD.json (conduct ÖNCESİ üret)
    runStep("conduct", "conduct.ts", ["--json", "--no-gate"]), // CRITIC/DOD'u COMPLETENESS-finding olarak tüketir; --no-gate: kasıtlı RED gate-exit'i refresh'te crash sayma (gerçek crash hâlâ ✗)
    runStep("fuse", "fuse.ts", []),       // vO14 tüm-gate → REQUIREMENTS.md kritik-öncelikli birleşik
    runStep("status", "status.ts", []),
    runDoctor(),
  ];
  const md = summarizeAutopilot(results, ts);
  writeFileSync(join(ORCH_DIR, "AUTOPILOT.md"), md.endsWith("\n") ? md : md + "\n");
  process.stdout.write(md + "\n");
  if (!QUIET) {
    const okN = results.filter((r) => r.ok).length;
    console.error(`[autopilot] ${okN}/${results.length} adım · ${results.map((r) => `${r.step}:${r.ok ? "ok" : "FAIL"}`).join(" ")}`);
  }
}

if (process.argv[1] && /autopilot\.ts$/.test(process.argv[1])) main();
