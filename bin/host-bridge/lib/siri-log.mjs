// @ts-check
// bin/host-bridge/lib/siri-log.mjs — Siri yapısal JSONL log (gözlemlenebilirlik). KENDİ-YETERLİ; events.mjs
// konvansiyonunu yansıtır ama AYRI dosyaya yazar (seyir-defteri-siri.jsonl). buildSiriRecord SAF (test'li);
// recordSiri best-effort (asla Siri'yi kırmaz). Algoritma-ölçüm güdümü: her sorgunun kararları kalıcı kaydedilir.
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync } from "node:fs";
import { homedir, hostname, platform, arch, cpus } from "node:os";
import { join } from "node:path";

export const SIRI_LOG_FILE = "seyir-defteri-siri.jsonl";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB → rotate (.1)

const _safe = (fn) => { try { return fn(); } catch { return ""; } };
const _num = (v, d = null) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Çalışma ortamı (küçük; kayda gömülür). */
export function device() {
  let ncpu = 0; try { ncpu = cpus().length; } catch { /* yoksay */ }
  return { host: _safe(hostname), platform: _safe(platform), arch: _safe(arch), ncpu };
}

/** SAF: siri-ask trace event dizisinden TEK yapısal kayıt türet (I/O yok; deterministik → test'li).
 *  @param {{query?:string,events?:any[],now?:number,device?:any}} [arg] */
export function buildSiriRecord({ query, events, now, device: dev } = {}) {
  const ev = Array.isArray(events) ? events : [];
  const lastOf = (s) => { let r = null; for (const e of ev) if (e && e.step === s) r = e; return r; };
  const sumMs = (s) => ev.reduce((x, e) => x + (e && e.step === s ? _num(e.ms, 0) : 0), 0);
  const fin = lastOf("final") || {};
  const rer = lastOf("rerank") || {};
  const syn = lastOf("synth") || {};
  const ora = lastOf("oracle") || {};
  const dep = lastOf("deep") || {};
  const route = fin.route || (ora.verdict && ora.verdict !== "UNDECIDABLE" ? "oracle" : "research");
  const mode = fin.mode || null;
  const tsMs = _num(now, 0);
  return {
    ts: new Date(tsMs).toISOString(),
    ts_ms: tsMs,
    tool: "siri-ask",
    duration_ms: _num(fin.ms, null),
    status: route === "error" ? "error" : "ok",
    route,
    mode,
    cache: mode === "cache" ? "hit" : "miss",
    attributes: {
      query: query || "",
      verdict: ora.verdict || fin.verdict || null,
      conf: fin.conf != null ? { score: _num(fin.conf, null), domains: _num(fin.domains, null) } : null,
      top3: Array.isArray(rer.top3) ? rer.top3 : (rer.top ? [rer.top] : []),
      kept: _num(rer.kept, null),
      sources_from: _num(rer.from, null),
      synth_backend: syn.backend || null,
      synth_timed_out: !!syn.timedOut,
      latency: {
        oracle_ms: sumMs("oracle") || null,
        deep_ms: _num(dep.ms, null),
        synth_ms: sumMs("synth") || null,
        total_ms: _num(fin.ms, null),
      },
      steps: ev.map((e) => ({ step: e && e.step, ms: _num(e && e.ms, null) })),
    },
    device: dev || device(),
  };
}

/** best-effort NDJSON yazıcı: SIRI_LOG=0 → atla; SIRI_LOG_DIR/opts.dir → dizin; >5MB → .1 rotasyon.
 *  appendFileSync: POSIX O_APPEND <4KB tek-satır atomik (eşzamanlı süreçlerde satır-bütünlüğü). Asla throw etmez. */
export function recordSiri(record, opts = {}) {
  try {
    if (process.env.SIRI_LOG === "0") return false;
    const dir = opts.dir || process.env.SIRI_LOG_DIR || join(homedir(), ".llm-mission-control");
    const file = join(dir, opts.file || SIRI_LOG_FILE);
    mkdirSync(dir, { recursive: true });
    try { if (existsSync(file) && statSync(file).size > (opts.maxBytes || MAX_BYTES)) renameSync(file, file + ".1"); } catch { /* rotasyon best-effort */ }
    appendFileSync(file, JSON.stringify(record) + "\n");
    return true;
  } catch { return false; }
}
