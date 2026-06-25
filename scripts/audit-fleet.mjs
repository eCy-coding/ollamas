// Faz11 — audit fleet. Dispatches the benchmark-winning auditor (qwen3-coder:480b-cloud)
// across every partition unit, reads each unit's files end-to-end via macos_terminal,
// extracts non-working-function findings, checkpoints raw/<unit>.json (resumable).
import fs from "node:fs";
const BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:8099";
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const RAW = `${REPO}/docs/audit/raw`;
const SLICES = JSON.parse(fs.readFileSync(`${REPO}/docs/audit/audit-slices.json`, "utf8"));
const PROVIDER = process.env.AUDIT_PROVIDER || "ollama-local";
const MODEL = process.env.AUDIT_MODEL || "qwen3-coder:480b-cloud";
const CONC = +(process.env.AUDIT_CONC || 3);
const ONLY = process.env.AUDIT_ONLY ? process.env.AUDIT_ONLY.split(",") : null; // unit id substrings
const safe = (id) => id.replace(/[^A-Za-z0-9]+/g, "_");

function buildTask(unit) {
  const paths = unit.files.map((f) => `${REPO}/${f}`).join(" ");
  return [
    `Bir kod denetçisisin. Şu dosyaları TEK macos_terminal komutuyla oku (target: iterm2): cat ${paths}`,
    "Sonra her dosyadaki HER export edilen fonksiyon/metodu incele. ÇALIŞMAYAN (non-working) olanları tespit et:",
    "mantık hatası, yanlış sonuç, crash/unhandled null-undefined, eksik await/race, yanlış default, off-by-one, yanlış operatör, swallowed error (boş catch), resource leak (kapatılmayan handle), ulaşılamaz/dead code, yanlış return tipi.",
    "ÇALIŞAN fonksiyonları RAPORLAMA. SADECE gerçekten bozuk/şüpheli olanları, final cevabında JSON dizisi olarak ver:",
    '[{"file":"görece/yol.ts","name":"fnAdi","line":<numara>,"symptom":"tek satır ne bozuk","fix":"tek satır nasıl düzeltilir"}]',
    "Tahmin etme — yalnız gerçek cat çıktısına dayan. Hiç bozuk yoksa [] döndür. Final cevap SADECE JSON dizisi.",
  ].join("\n");
}

async function dispatch(unit, attempt) {
  const body = {
    messages: [{ role: "user", content: buildTask(unit) }],
    provider: PROVIDER, maxSteps: 5, autoApply: false,
  };
  if (MODEL) body.model = MODEL;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 300000);
  const events = [];
  try {
    const res = await fetch(`${BASE}/api/agent/chat`, {
      method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    let buf = ""; const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const r = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let d = ""; for (const ln of r.split("\n")) if (ln.startsWith("data:")) d += ln.slice(5).trim();
        if (!d) continue;
        let p; try { p = JSON.parse(d); } catch { p = { type: "raw", text: d }; }
        events.push(p);
      }
    }
  } catch (e) { return { error: String(e.message || e), events }; }
  finally { clearTimeout(tid); }
  return { events };
}

function parseFindings(answer) {
  const m = answer.match(/\[[\s\S]*\]/);
  if (!m) return { findings: [], parsed: false };
  let txt = m[0].replace(/^```json\s*/i, "").replace(/```$/i, "");
  try {
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) return { findings: arr, parsed: true };
  } catch { /* try trailing-comma strip */ }
  try {
    const arr = JSON.parse(txt.replace(/,\s*([\]}])/g, "$1"));
    if (Array.isArray(arr)) return { findings: arr, parsed: true };
  } catch { /* give up */ }
  return { findings: [], parsed: false };
}

async function runUnit(unit) {
  const outPath = `${RAW}/${safe(unit.id)}.json`;
  if (fs.existsSync(outPath)) {
    try { const prev = JSON.parse(fs.readFileSync(outPath, "utf8")); if (prev.ok) return { id: unit.id, skipped: true }; } catch { /* re-run */ }
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const r = await dispatch(unit, attempt);
    const ms = Date.now() - t0;
    const ev = r.events || [];
    const modelEv = ev.find((e) => e.type === "model");
    const done = ev.find((e) => e.type === "done");
    const steps = ev.filter((e) => e.type === "step");
    const ranTerminal = steps.some((s) => /terminal/i.test(s.tool || ""));
    const demo = JSON.stringify(ev).toLowerCase().includes('"source":"demo"');
    const answer = (done?.text || done?.answer || "") + "";
    const { findings, parsed } = parseFindings(answer);
    const ok = !r.error && ranTerminal && !demo && (parsed || /\[\s*\]/.test(answer));
    const rec = {
      ok, unit: unit.id, group: unit.group, files: unit.files, loc: unit.loc,
      model: modelEv ? `${modelEv.provider}/${modelEv.model}` : `${PROVIDER}/${MODEL}`,
      attempt, ms, steps: steps.length, ranTerminal, demo, parsed, error: r.error || null,
      findings, answerPreview: answer.slice(0, 300),
    };
    if (ok || attempt === 2) {
      fs.writeFileSync(outPath, JSON.stringify(rec, null, 2));
      return { id: unit.id, ok, findings: findings.length, ms, demo, ranTerminal, parsed, err: r.error };
    }
    process.stderr.write(`  retry ${unit.id} (ok=${ok} demo=${demo} ranTerm=${ranTerminal} parsed=${parsed} err=${r.error})\n`);
  }
}

(async () => {
  let units = SLICES.units;
  if (ONLY) units = units.filter((u) => ONLY.some((s) => u.id.includes(s)));
  process.stderr.write(`fleet: ${units.length} units, model=${MODEL}, conc=${CONC}\n`);
  const queue = [...units];
  let done = 0;
  async function worker(wid) {
    while (queue.length) {
      const u = queue.shift();
      const r = await runUnit(u);
      done++;
      if (r?.skipped) process.stderr.write(`[${done}/${units.length}] SKIP ${u.id} (cached)\n`);
      else process.stderr.write(`[${done}/${units.length}] ${r?.ok ? "OK" : "WARN"} ${u.id} findings=${r?.findings ?? "?"} ${r?.ms ?? "?"}ms demo=${r?.demo} parsed=${r?.parsed}${r?.err ? " err=" + r.err : ""}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
  // aggregate
  const all = units.map((u) => { try { return JSON.parse(fs.readFileSync(`${RAW}/${safe(u.id)}.json`, "utf8")); } catch { return null; } }).filter(Boolean);
  const totalFindings = all.reduce((a, b) => a + (b.findings?.length || 0), 0);
  const okCount = all.filter((a) => a.ok).length;
  process.stderr.write(`\nfleet DONE: units=${all.length}/${units.length} ok=${okCount} totalCandidateFindings=${totalFindings}\n`);
})();
