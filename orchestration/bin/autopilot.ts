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
// vO45 fleet-autonomy: alt-modeller aldığım iznin GÜVENLİ eşdeğerini alır — gate-geçen safe-auto önerileri
// manuel conductor-onayı OLMADAN uygula+commit'le (tsc+vitest kapısı KORUNUR). Tek-manuel aktivasyon:
// marker .fleet-autoship-enabled + env ORCH_FLEET_AUTOSHIP=1 (claude-dispatch marker deseniyle aynı).
const FLEET_AUTOSHIP = existsSync(join(ORCH_DIR, ".fleet-autoship-enabled")) && process.env.ORCH_FLEET_AUTOSHIP === "1";

/** Per-step artefact: if a slow refresh times out but this file already exists on disk, the previous
 *  run's output is still valid → degrade to ⏱ stale-ok instead of a hard ✗ (sustainable refresh loop). */
const STEP_ARTEFACT: Record<string, string> = {
  quality: "QUALITY.json", conduct: "CONDUCTOR.md", status: "STATUS.md",
  critic: "CRITIC.json", dod: "DOD.json", fuse: "REQUIREMENTS.json", council: "COUNCIL_ROSTER.json",
};

/** execFileSync throws with `killed:true` (+ SIGTERM) when the timeout fires — distinct from a real error. */
function isTimeoutKill(e: any): boolean {
  return e?.killed === true || e?.code === "ETIMEDOUT" || e?.signal === "SIGTERM";
}

/** Bir adımı read-only spawn et; never-throw → StepResult. Süreyi process.hrtime ile ölç (Date.now yok). */
function runStep(step: string, script: string, args: string[], timeoutMs = 60_000): StepResult {
  const t0 = process.hrtime.bigint();
  try {
    execFileSync(TSX, [join(HERE, script), ...args], {
      stdio: ["ignore", "ignore", "pipe"], timeout: timeoutMs, cwd: ORCH_DIR,
    });
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    return { step, ok: true, ms, detail: detailFor(step) };
  } catch (e: any) {
    const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    // ROOT-FIX (RISK-ORCH: quality/conduct/status ETIMEDOUT → phantom ✗ dropping readiness): a refresh
    // step that exceeds its budget is NOT a failure if its artefact already exists — the loop reuses the
    // last-known-good output and stays green. Only a timeout with NO prior artefact (or a genuine non-zero
    // exit) is a real failure.
    const artefact = STEP_ARTEFACT[step];
    if (isTimeoutKill(e) && artefact && existsSync(join(ORCH_DIR, artefact))) {
      return { step, ok: true, stale: true, ms, detail: `⏱ ${Math.round(ms / 1000)}s timeout → önceki ${artefact} korunur (stale)` };
    }
    // Captured stderr (last non-empty line) is the real reason; fall back to the exec message.
    // Avoids the truncated "Command failed: …/tsx /" noise when a step genuinely errors.
    const err = (e?.stderr?.toString().trim().split("\n").filter(Boolean).pop() || e?.message || "hata");
    return { step, ok: false, ms, detail: err.slice(0, 80) };
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
  if (step === "quality") {
    const q = readJson(join(ORCH_DIR, "QUALITY.json"));
    const t = q?.totals;
    return t ? `lane sağlığı tazelendi · 🟢${t.green} 🔴${t.red} ⚪${t.unknown}` : "lane sağlığı tazelendi";
  }
  if (step === "conduct") {
    const f = join(ORCH_DIR, "CONDUCTOR.md");
    if (existsSync(f)) {
      // Skip the markdown table HEADER (e.g. "| Lane | Şu an | → Sıradaki |", which
      // matches "→") and separator rows; return the first real data row. A header is
      // a row immediately followed by a "|---|" separator.
      const ls = readFileSync(f, "utf8").split("\n");
      const isSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
      const line = ls.find((l, i) => /next|sonraki|aksiyon|action|→/i.test(l) && l.trim().length > 8 && !isSep(l) && !isSep(ls[i + 1] || ""));
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
  if (step === "dispatch") {
    const f = join(ORCH_DIR, "RECONCILE.md");
    if (existsSync(f)) {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.includes("▶"));
      if (line) return line.replace(/[#>*`|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return "fleet reconcile tazelendi";
  }
  if (step === "council") {
    const r = readJson(join(ORCH_DIR, "COUNCIL_ROSTER.json"));
    if (r) return `roster ${r.present ?? "?"}/${r.total ?? "?"} seat · coverage ${(r.lanesCovered ?? []).length}/7${(r.lanesUncovered ?? []).length ? ` · ⚠️ ${(r.lanesUncovered).join(",")}` : ""}`;
    return "council roster tazelendi";
  }
  if (step === "tasklist") {
    const f = join(ORCH_DIR, "..", "docs", "MASTER_TASKLIST.md");
    if (existsSync(f)) { const m = /acceptance \((\d+)\/(\d+)\)/i.exec(readFileSync(f, "utf8")); if (m) return `master task list tazelendi · kabul ${m[1]}/${m[2]}`; }
    return "master task list tazelendi";
  }
  if (step === "next") {
    const f = join(ORCH_DIR, "FLEET_NEXT.md");
    if (existsSync(f)) {
      const rows = readFileSync(f, "utf8").split("\n").filter((l) => /P1 apply-additive/.test(l)).length;
      return `next-task kuyruğu tazelendi · ${rows} safe-additive (P1)`;
    }
    return "next-task kuyruğu tazelendi";
  }
  if (step === "think") {
    const t = readJson(join(ORCH_DIR, "THINK.json")); // think --json ürünü (varsa)
    if (t) return `${t.proven ?? 0} proven · ${t.needsResearch ?? 0} needs-research · registry ${t.registrySize ?? "?"}`;
    return "think loop tazelendi (THINK.md)";
  }
  if (step === "fleet") {
    const s = join(ORCH_DIR, "FLEET_STATUS.md");
    if (existsSync(s)) {
      const line = readFileSync(s, "utf8").split("\n").find((l) => /Convergence:/.test(l));
      if (line) return line.replace(/[#>*`]/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
    }
    return "fleet durum tazelendi (launch --go ile başlat)";
  }
  if (step === "fleetship") {
    const s = readJson(join(ORCH_DIR, "FLEET_SHIP.json"));
    if (s) { const c = (s.shipped ?? []).filter((x: any) => /committed \(/.test(x.reason || "")).length; return `alt-model oto-ship: ${c} commit / ${(s.shipped ?? []).length} shipped · ${(s.reverted ?? []).length} revert`; }
    return "fleet auto-ship tazelendi";
  }
  if (step === "claude") {
    const f = join(ORCH_DIR, "CLAUDE_DISPATCH.md");
    if (existsSync(f)) {
      const line = readFileSync(f, "utf8").split("\n").find((l) => /^##\s+(▶|\[dry\]|⏭|🛑)/.test(l));
      if (line) return line.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().slice(0, 80);
    }
    return "claude-dispatch kararı tazelendi";
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
  try { execFileSync("curl", ["-sf", "-m", "2", "-o", "/dev/null", "http://localhost:3000/api/health"], { stdio: ["ignore", "ignore", "ignore"] }); return true; } // -f: HTTP >=400 → non-zero exit → not "up"
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
    runStep("council", "council.ts", []),  // model-council light: roster tazele (ollama list) → COUNCIL_ROSTER.json (ağır --all opt-in)
    runStep("fleet", "fleet-conduct.ts", []),  // local model-fleet supervise: reports+claims → FLEET_STATUS.md (launch --go opt-in)
    ...(FLEET_AUTOSHIP ? [runStep("fleetship", "fleet-apply.ts", ["--apply-all", "--commit"], 900_000)] : []), // vO45 alt-model otonomi: gate-geçen safe-auto önerileri oto-uygula+commit (marker+env ile açık; gate/proposal başına dakikalar → 15dk timeout)
    // vO41: QUALITY.json'u HER koşuda tazele (bayat roll-up → phantom-CRITICAL kökü). SessionStart'ta
    // --no-tsc (hızlı: lane listesi + vitest cache), launchd --heal'de tam tsc taraması.
    // HEAL modda quality 12 worktree'de CANLI tsc koşar (~2s/lane değil, worktree başına tsc cold-start
    // dakikalar sürebilir) → default 60s garanti aşımdı (son koşu 15/16). Canlı-tsc yoluna 300s ver.
    runStep("quality", "quality.ts", HEAL ? [] : ["--no-tsc"], HEAL ? 300_000 : 60_000),
    runStep("critic", "critic.ts", []),   // vO11 öz-denetim → CRITIC.json (conduct ÖNCESİ üret)
    runStep("dod", "dod.ts", []),         // vO12 yarım-iş gate → DOD.json (conduct ÖNCESİ üret)
    runStep("conduct", "conduct.ts", ["--json"], 150_000), // CRITIC/DOD'u COMPLETENESS-finding olarak tüketir (collect() ağır → 150s bütçe + stale-fallback)
    runStep("fuse", "fuse.ts", []),       // vO14 tüm-gate → REQUIREMENTS.md kritik-öncelikli birleşik
    runStep("think", "think.ts", []),     // vO22 THINK loop: finding → PROVEN-solution(registry) | NEEDS_RESEARCH (no-guess)
    runStep("next", "fleet-next.ts", []), // vO24 precompute next-task queue (safe-additive apply → edit → research) → FLEET_NEXT.md
    runStep("tasklist", "tasklist.ts", []), // vO29 persistent master task list → docs/MASTER_TASKLIST.md (auto-refresh)
    runStep("claude", "claude-dispatch.ts", ["--go"]), // vO40 en-kritik gereksinimi Claude conductor oturumuna delege (marker .claude-dispatch-enabled YOKSA dry — tek-manuel aktivasyon)
    runStep("status", "status.ts", [], 150_000),
    runStep("dispatch", "reconcile.ts", []), // vO27 autonomous fleet reconcile → RECONCILE.md (0-manuel self-reconcile)
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
