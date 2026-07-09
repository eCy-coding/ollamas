// @ts-check
// Faz11 audit-capability benchmark — measures which model best detects REAL bugs
// (high recall) without fabricating (high precision). Ground-truth = bench-fixture.groundtruth.json.
// Usage: node scripts/bench-audit.mjs   (boots against OLLAMAS_URL, default :8099)
import fs from "node:fs";
const BASE = process.env.OLLAMAS_URL || "http://127.0.0.1:8099";
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const FIXTURE = `${REPO}/docs/audit/fixtures/bench-fixture.ts`;
const GT = JSON.parse(fs.readFileSync(`${REPO}/docs/audit/fixtures/bench-fixture.groundtruth.json`, "utf8"));
const BUGGY = Object.keys(GT.buggy);
const CLEAN = GT.clean;
const ALL = [...BUGGY, ...CLEAN];

const TASK = [
  `macos_terminal (target: iterm2) ile şu komutu çalıştır: cat ${FIXTURE}`,
  "Dosyada 10 export fonksiyon var. HER fonksiyon için WORKING mı BROKEN mı karar ver.",
  "BROKEN = mantık hatası içeren (yanlış sonuç, crash, eksik await, yanlış default, off-by-one, yanlış operatör vb.).",
  "SADECE bozuk olanları JSON dizisi olarak final cevabında ver: [{\"name\":\"fnAdi\",\"reason\":\"tek satır\"}]",
  "Tahmin etme — gerçekten cat çıktısını oku. Final cevap SADECE JSON dizisi olsun.",
].join("\n");

const CANDIDATES = [
  { label: "qwen3-coder:480b-cloud", provider: "ollama-local", model: "qwen3-coder:480b-cloud", timeout: 180000 },
  { label: "gemini", provider: "gemini", model: undefined, timeout: 120000 },
  { label: "qwen3:8b", provider: "ollama-local", model: "qwen3:8b", timeout: 240000 },
];

async function runOnce(c) {
  const body = { messages: [{ role: "user", content: TASK }], maxSteps: 4, autoApply: false };
  if (c.provider) body.provider = c.provider;
  if (c.model) body.model = c.model;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), c.timeout);
  let events = [];
  try {
    const res = await fetch(`${BASE}/api/agent/chat`, {
      method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    let buf = ""; const dec = new TextDecoder();
    for await (const chunk of /** @type {any} */ (res.body)) {
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let data = ""; for (const ln of raw.split("\n")) if (ln.startsWith("data:")) data += ln.slice(5).trim();
        if (!data) continue;
        let p; try { p = JSON.parse(data); } catch { p = { type: "raw", text: data }; }
        events.push(p);
      }
    }
  } catch (e) { return { error: String(e.message || e), events }; }
  finally { clearTimeout(tid); }
  return { events };
}

function extractFlagged(answer) {
  // try JSON array of {name}
  const m = answer.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      const names = arr.map((x) => (typeof x === "string" ? x : x.name || x.function || "")).filter(Boolean);
      if (names.length) return new Set(names);
    } catch { /* fall through */ }
  }
  // fallback: which of the known names appear in the answer (agent told to list only broken)
  const set = new Set();
  for (const n of ALL) if (new RegExp(`\\b${n}\\b`).test(answer)) set.add(n);
  return set;
}

function score(flagged) {
  const tp = BUGGY.filter((b) => flagged.has(b)).length;
  const fp = CLEAN.filter((c) => flagged.has(c)).length;
  const recall = tp / BUGGY.length;
  const precision = flagged.size ? tp / (tp + fp) : 0;
  const composite = recall * precision;
  return { tp, fp, recall: +recall.toFixed(3), precision: +precision.toFixed(3), composite: +composite.toFixed(3) };
}

(async () => {
  const results = [];
  for (const c of CANDIDATES) {
    process.stderr.write(`\n=== bench ${c.label} ===\n`);
    const t0 = Date.now();
    const r = await runOnce(c);
    const ms = Date.now() - t0;
    if (r.error && !(r.events && r.events.length)) {
      results.push({ label: c.label, error: r.error, ms });
      console.log(`${c.label}: ERROR ${r.error} (${ms}ms)`);
      continue;
    }
    const ev = r.events || [];
    const modelEv = ev.find((e) => e.type === "model");
    const done = ev.find((e) => e.type === "done");
    const steps = ev.filter((e) => e.type === "step");
    const ranTerminal = steps.some((s) => /terminal/i.test(s.tool || ""));
    const demo = ev.some((e) => /demo/i.test(JSON.stringify(e))) || JSON.stringify(ev).toLowerCase().includes('"source":"demo"');
    const answer = (done?.text || done?.answer || "") + "";
    const flagged = extractFlagged(answer);
    const sc = score(flagged);
    const row = {
      label: c.label, modelResolved: modelEv ? `${modelEv.provider}/${modelEv.model}` : "?",
      ms, steps: steps.length, ranTerminal, demo, flagged: [...flagged], ...sc,
      answerPreview: answer.slice(0, 200),
    };
    results.push(row);
    console.log(`${c.label}: recall=${sc.recall} precision=${sc.precision} composite=${sc.composite} tp=${sc.tp} fp=${sc.fp} demo=${demo} ranTerm=${ranTerminal} ${ms}ms`);
    console.log(`  flagged: ${[...flagged].join(", ") || "(none)"}`);
  }
  // rank: composite desc, tie-break latency asc. `results` is a union of scored rows and error rows
  // ({label,error,ms}); the `!r.error` filter removes error rows, so the scored props are safe below —
  // TS can't narrow that union across .filter, so the row is typed `any` here (the guard is real).
  const ranked = /** @type {any[]} */ ([...results]).filter((r) => !r.error).sort((a, b) => b.composite - a.composite || a.ms - b.ms);
  const out = {
    task: "audit-capability (bug-detection) benchmark",
    fixture: "docs/audit/fixtures/bench-fixture.ts",
    groundTruth: { buggy: BUGGY, clean: CLEAN },
    scoredAt: process.env.BENCH_STAMP || null,
    results, ranked: ranked.map((r) => ({ label: r.label, composite: r.composite, recall: r.recall, precision: r.precision, ms: r.ms })),
    winner: ranked[0]?.label || null,
  };
  fs.writeFileSync(`${REPO}/docs/audit/AUDIT-BENCH.json`, JSON.stringify(out, null, 2));
  console.log(`\nWINNER: ${out.winner}  (ranked: ${out.ranked.map((r) => r.label + "=" + r.composite).join(", ")})`);
})();
