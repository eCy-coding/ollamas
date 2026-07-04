#!/usr/bin/env node
// siri-ask — ollamas Siri arama yardımcısı "BEYNİ" (standalone; gateway/server GEREKMEZ).
//   node bin/siri-ask.mjs "<soru>" [--say] [--trace]
// Yol: (a) Truth-Oracle deterministik (Doğru/Yanlış) → (b) değilse deep web_search + fleet sentez.
// Güven değişmezi: "Doğru/Yanlış" yargısı YALNIZ Oracle'dan; sentez asla verdict ile başlamaz.
// İZLEME: --trace / SIRI_TRACE=1 → iç akış adımları stderr'e (⟦TRACE⟧json). stdout TEMİZ kalır (davranış değişmez).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { formatOracleSpeech, buildSynthPrompt, sanitizeSynth, clampWords, looksLikeDemo, extractiveAnswer, normalizeForOracle, extractUrl, wantsRender, wantsDeepSurf, topFor, isFollowUp, rerankSources, dedupSources, domainOf, computeConfidence } from "./host-bridge/tools/lib/ask-core.mjs";
import { buildSiriRecord, recordSiri, device } from "./host-bridge/lib/siri-log.mjs";

const REPO = dirname(fileURLToPath(import.meta.url)).replace(/[\/\\]bin$/, "");
const NODE = process.execPath;
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const ORACLE_SOCK = process.env.ORACLE_SOCK || "/tmp/ollamas-oracle.sock";

const argv = process.argv.slice(2);
const SAY = argv.includes("--say");
const TRACE = process.env.SIRI_TRACE === "1" || argv.includes("--trace");
// --ctx "<önceki konuşma>" → çok-turlu bağlam (follow-up çözümü). Sonraki arg context'tir, sorgu değil.
const ctxIdx = argv.indexOf("--ctx");
const CTX = ctxIdx >= 0 ? (argv[ctxIdx + 1] || "") : "";
const query = argv.filter((a, i) => a !== "--say" && a !== "--trace" && a !== "--ctx" && !(ctxIdx >= 0 && i === ctxIdx + 1)).join(" ").trim();

const traceEvents = [];
function trace(step, data) {
  traceEvents.push({ step, ...data });
  if (TRACE) { try { process.stderr.write("⟦TRACE⟧" + JSON.stringify({ step, ...data }) + "\n"); } catch {} }
  if (step === "final") { try { recordSiri(buildSiriRecord({ query, events: traceEvents, now: Date.now(), device: device() })); } catch {} }
}

// HIZ: research yanıt cache (TTL). Oracle yolu zaten ~53ms → cache YOK. Yalnız başarılı sentez cache'lenir.
const CACHE_DIR = join(homedir(), ".cache", "ollamas-siri");
const CACHE_TTL = 15 * 60 * 1000; // 15 dk (web içeriği değişebilir → kısa)
const cacheKeyOf = (q) => createHash("sha256").update("siri:" + (q || "").trim().toLowerCase()).digest("hex");
function cacheGet(q) {
  try { const f = join(CACHE_DIR, cacheKeyOf(q) + ".json"); if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, "utf8")); return Date.now() - o.t > CACHE_TTL ? null : o.a; } catch { return null; }
}
function cacheSet(q, a) {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(join(CACHE_DIR, cacheKeyOf(q) + ".json"), JSON.stringify({ t: Date.now(), a })); } catch { /* best-effort */ }
}

function speak(text) {
  process.stdout.write((text || "") + "\n");
  if (SAY && text) { try { spawnSync("/usr/bin/say", ["-v", "Yelda", text], { timeout: 30000 }); } catch {} }
}

async function oracleOne(q) {
  const t0 = Date.now();
  // (1) SICAK daemon (unix socket) — ms düzeyinde, tsx cold-start YOK.
  try {
    const { oracleCall } = await import("../scripts/oracle-client.mjs");
    const r = await oracleCall(q, ORACLE_SOCK, 4000);
    if (r && r.verdict) { trace("oracle", { input: q, via: "daemon", verdict: r.verdict, ms: Date.now() - t0 }); return r; }
  } catch { /* daemon kapalı → CLI'ye düş */ }
  // (2) Fallback: oracle.ts CLI subprocess (daemon yoksa).
  try {
    const r = spawnSync(NODE, [TSX, "orchestration/bin/oracle.ts", "--json", q], { cwd: REPO, encoding: "utf8", timeout: 8000 });
    const j = JSON.parse(r.stdout);
    trace("oracle", { input: q, via: "cli", verdict: j && j.verdict, ms: Date.now() - t0 });
    return j;
  } catch { trace("oracle", { input: q, via: "cli", verdict: null, ms: Date.now() - t0 }); return null; }
}

// Kalibrasyon: önce Türkçe→sembolik normalize, sonra orijinal; ikisi de UNDECIDABLE → research.
async function oracle(q) {
  const norm = normalizeForOracle(q);
  if (norm !== q) trace("normalize", { input: q, normalized: norm });
  const tries = norm && norm !== q ? [norm, q] : [q];
  let last = null;
  for (const c of tries) {
    last = await oracleOne(c);
    if (last && (last.verdict === "TRUE" || last.verdict === "FALSE")) return last;
  }
  return last;
}

// web_search.mjs tek-mod sarmalayıcı (search/--deep/--fetch/--render). JSON döndürür.
function webSearch(args) {
  try {
    const r = spawnSync(NODE, [join(REPO, "bin/host-bridge/tools/web_search.mjs"), ...args],
      { cwd: REPO, encoding: "utf8", timeout: 40000, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(r.stdout);
  } catch { return null; }
}
const sumChars = (rs) => rs.reduce((x, y) => x + (y.chars != null ? y.chars : (y.text || "").length), 0);

// research ROUTER — web_search'ün TÜM modlarını kullan: URL→fetch(+render); değilse deep(top/render);
// derinlemesine istek → one-hop surf (üst kaynağın bir linkini izle). Sonuç: [{title,url,text}].
function webResearch(query) {
  const url = extractUrl(query);
  const render = wantsRender(query);

  // (1) Belirli sayfa → --fetch <url> --render (dışa-bağlan: JS-ağır ise Chrome render).
  if (url) {
    const t0 = Date.now();
    const j = webSearch(["--fetch", url, "--render"]);
    const text = (j && j.text) || "";
    trace("fetch", { url, render: true, rendered: !!(j && j.rendered), chars: text.length, ms: Date.now() - t0 });
    return text ? [{ title: (j && j.title) || url, url, text }] : [];
  }

  // (2) Çok-kaynak → --deep --top N (+ --render istenirse; auto-render zaten var).
  // Follow-up + bağlam → arama sorgusunu önceki konuşmayla zenginleştir (çok-turlu).
  const searchQ = CTX && isFollowUp(query) ? `${CTX} ${query}` : query;
  const top = topFor(query);
  const t0 = Date.now();
  const deepArgs = ["--deep", searchQ, "--top", String(top)];
  if (render) deepArgs.push("--render");
  const j = webSearch(deepArgs);
  let results = j && Array.isArray(j.results) ? j.results : [];
  trace("deep", { query: searchQ, followup: searchQ !== query, sources: results.length, chars: sumChars(results), top, render, ms: Date.now() - t0 });

  // (3) Derinlemesine → ONE-HOP surf: üst kaynağın bir (tercihen dış-host) linkini --fetch --render ile izle.
  if (wantsDeepSurf(query) && results.length) {
    const t1 = Date.now();
    try {
      const topUrl = results[0].url;
      const pf = webSearch(["--fetch", topUrl]); // links (cache'ten hızlı)
      const links = pf && Array.isArray(pf.links) ? pf.links : [];
      const host = (u) => { try { return new URL(u).host; } catch { return ""; } };
      // Junk linkleri ele (login/kayıt/yasal/sosyal vb.) → içerik linki tercih et.
      const junk = /(login|signin|sign-in|register|signup|sign-up|account|cart|checkout|privacy|terms|cookie|legal|contact|developer\/registration|\/auth|facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com)/i;
      const good = links.filter((l) => host(l) && !junk.test(l));
      const next = good.find((l) => host(l) !== host(topUrl)) || good[0] || links.find((l) => host(l) && host(l) !== host(topUrl)) || links[0];
      if (next) {
        const nf = webSearch(["--fetch", next, "--render"]);
        if (nf && nf.text) { results.push({ title: nf.title || next, url: next, text: nf.text }); trace("surf", { from: topUrl, to: next, chars: nf.text.length, ms: Date.now() - t1 }); }
        else trace("surf", { from: topUrl, to: next, chars: 0, ms: Date.now() - t1 });
      }
    } catch { /* surf best-effort */ }
  }
  // RERANK (RAG best-practice): sentezden ÖNCE en-alakalı + otorite kaynağı başa al, host-tekrarı ele.
  const ranked = rerankSources(searchQ, dedupSources(results));
  if (ranked.length) trace("rerank", { top: domainOf(ranked[0].url), top3: ranked.slice(0, 3).map((r) => domainOf(r.url)), kept: ranked.length, from: results.length });
  return ranked;
}

// SINIRLI ADAPTİF synth: per-deneme timeout (env-ayarlı) + fail-fast. spawnSync Node'da timeout'ta THROW ETMEZ →
// { signal:"SIGTERM", error.code:"ETIMEDOUT" } döner; gerçek sinyalden sapta. 1. deneme timeout (fleet doygun) →
// retry YOK, "" dön → main() extractiveAnswer'a düşer. Retry yalnız geçici boş/demo için. En-kötü ~31s.
const SYNTH_TIMEOUT = Number(process.env.SIRI_SYNTH_TIMEOUT) || 30000;
function synth(prompt) {
  for (let a = 0; a < 2; a++) {
    const t0 = Date.now();
    const r = spawnSync(NODE, [TSX, join(REPO, "bin/siri-synth.ts")],
      { cwd: REPO, input: prompt, encoding: "utf8", timeout: SYNTH_TIMEOUT, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, SIRI_TRACE: TRACE ? "1" : "" } });
    const timedOut = (r.error && r.error.code === "ETIMEDOUT") || r.signal === "SIGTERM";
    const out = (r.stdout || "").trim();
    const m = (r.stderr || "").match(/⟦SYNTH⟧\s*(\S+)/);
    const backend = m ? m[1] : (timedOut ? "timeout" : (r.error ? "error" : "?"));
    const demo = looksLikeDemo(out);
    trace("synth", { backend, chars: out.length, demo, timedOut, ms: Date.now() - t0, attempt: a + 1 });
    if (out && !demo) return out;
    if (timedOut) return ""; // fleet doygun → 2. ${SYNTH_TIMEOUT}'i yakma, hemen extractive
    if (a === 0) { try { spawnSync("/bin/sleep", ["1"]); } catch {} }
  }
  return "";
}

(async function main() {
  const tStart = Date.now();
  try {
    if (!query) { speak("Lütfen bir soru söyleyin."); process.exit(0); }

    // (a) Evrensel doğru/yanlış — deterministik.
    const o = await oracle(query);
    if (o && (o.verdict === "TRUE" || o.verdict === "FALSE")) {
      trace("final", { route: "oracle", verdict: o.verdict, ms: Date.now() - tStart });
      speak(formatOracleSpeech(o.verdict, o.proof));
      process.exit(0);
    }

    // (b) Açık uçlu → önce CACHE (hız): aynı soru (+bağlam) TTL içinde tekrar → anında.
    const cacheQ = CTX ? CTX + " :: " + query : query;
    const cached = cacheGet(cacheQ);
    if (cached) { trace("final", { route: "research", mode: "cache", ms: Date.now() - tStart }); speak(cached); process.exit(0); }

    // cache yok → web araştırma (fetch/deep/render/surf) + sentez.
    const results = webResearch(query);
    if (!results.length) { trace("final", { route: "research", mode: "no-sources", ms: Date.now() - tStart }); speak("Bu konuda yeterli kaynak bulamadım."); process.exit(0); }

    // Synth → bağlamlı (çok-turlu) + grounded prompt; baştaki "Doğru/Yanlış" dolgusunu SIYIR (research ≠ oracle).
    let answer = clampWords(sanitizeSynth(synth(buildSynthPrompt(query, results, CTX || null))), 60);
    let mode = "synth";
    if (!answer || looksLikeDemo(answer)) {
      answer = extractiveAnswer(results, query); mode = "extractive";
      trace("fallback", { to: "extractive" });
    }
    const conf = computeConfidence(results, answer);
    if (conf.domains < 2 || conf.grounding < 0.5) answer = answer + " (⚠ sınırlı kaynak)";
    trace("final", { route: "research", mode, conf: Math.round(conf.score * 100), domains: conf.domains, ms: Date.now() - tStart });
    if (mode === "synth" && answer) cacheSet(cacheQ, answer); // yalnız başarılı sentezi cache'le (bağlam-anahtarlı)
    speak(answer);
    process.exit(0);
  } catch {
    trace("final", { route: "error", ms: Date.now() - tStart });
    speak("Şu an yanıt veremedim.");
    process.exit(0);
  }
})();
