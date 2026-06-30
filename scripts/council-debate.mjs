#!/usr/bin/env node
// scripts/council-debate.mjs — LIVE multi-model council debate (zero-dep, node 24 fetch).
// Several local ollama models argue a topic interactively across rounds, streaming their turns
// to the terminal, then a synthesis pass prints the SINGLE converged answer. Designed to run
// inside a Terminal.app window opened by scripts/council.mjs (or inline with --here).
//
//   node scripts/council-debate.mjs --topic "is binary search O(log n)? prove it" [--models a,b,c] [--rounds 2]
//
// Council rules (operator-set): ONE answer · only real global evidence (math/science/code) ·
// say "fikrim yok" if no evidence · no guessing/derivation · terse · converge.
import { createInterface } from "node:readline";

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const CHAMPION = process.env.MAC_MODEL_CHAMPION || "qwen3:8b";

// ── pure helpers (unit-tested) ──────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const a = { topic: "", models: "", rounds: 2, here: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--topic") a.topic = argv[++i] || "";
    else if (t === "--models") a.models = argv[++i] || "";
    else if (t === "--rounds") a.rounds = Math.max(1, Math.min(5, Number(argv[++i]) || 2));
    else if (t === "--here") a.here = true;
    else if (!a.topic && !t.startsWith("--")) a.topic = t;
  }
  return a;
}

// Pick up to `want` council members from the installed models: champion first (if present), then
// the next distinct installed models. Falls back to whatever is installed; never invents a model.
export function pickCouncilModels(installed, champion, want = 3) {
  const list = (installed || []).filter(Boolean);
  const out = [];
  if (list.includes(champion)) out.push(champion);
  for (const m of list) { if (out.length >= want) break; if (!out.includes(m)) out.push(m); }
  return out.slice(0, want);
}

export const COUNCIL_RULES =
  "Sen bir COUNCIL üyesisin. Kurallar: TEK cevap ver. Sadece GERÇEK küresel kanıt (matematik/bilim/kod). " +
  "Kanıtın yoksa aynen 'fikrim yok' de — TAHMİN ETME, TÜRETME. Kısa ve net ol. Diğer üyelerle gerçeğe yakınsa.";

// Build a member's prompt for a round: its persona rules + the topic + the prior transcript so it
// can REACT to the others (the interactive part). Round 1 has no transcript (independent position).
export function buildMemberPrompt(rules, topic, transcript) {
  const base = `${rules}\n\nKONU: ${topic}`;
  if (!transcript || !transcript.length) return `${base}\n\nİlk konumunu kanıtıyla ver (3-5 cümle).`;
  const prior = transcript.map((t) => `### ${t.model}\n${t.text}`).join("\n\n");
  return `${base}\n\nÖNCEKİ TUR:\n${prior}\n\nDiğerlerine yanıt ver: kanıtla katıl/itiraz et, görüşünü güncelle ya da koru. Yeni kanıt yoksa 'fikrim yok'. (3-5 cümle)`;
}

// ── thin IO: stream one ollama turn, return the full text ───────────────────────────────────
const C = { dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m", colors: ["\x1b[36m", "\x1b[35m", "\x1b[32m", "\x1b[33m", "\x1b[34m"] };

async function streamTurn(model, prompt, color, timeoutMs = 30000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  process.stdout.write(`\n${C.bold}${color}▸ ${model}${C.reset}\n`);
  let text = "";
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: true }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          const chunk = j.message?.content || "";
          if (chunk) { process.stdout.write(chunk); text += chunk; }
        } catch { /* partial line */ }
      }
    }
    process.stdout.write("\n");
    return text.trim();
  } catch (e) {
    process.stdout.write(`${C.dim}⚠ ${model} unreachable — skipping (${(e && e.message) || e})${C.reset}\n`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function listInstalled() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    return ((await r.json()).models || []).map((m) => m.name).filter(Boolean);
  } catch { return []; }
}

async function runDebate(topic, members, rounds) {
  process.stdout.write(`\n${C.bold}═══ COUNCIL ▸ ${topic} ═══${C.reset}\n${C.dim}üyeler: ${members.join(", ")} · tur: ${rounds}${C.reset}\n`);
  let transcript = [];
  for (let r = 1; r <= rounds; r++) {
    process.stdout.write(`\n${C.bold}── TUR ${r}/${rounds} ──${C.reset}\n`);
    const next = [];
    for (let i = 0; i < members.length; i++) {
      const model = members[i];
      const prompt = buildMemberPrompt(COUNCIL_RULES, topic, r === 1 ? [] : transcript);
      const text = await streamTurn(model, prompt, C.colors[i % C.colors.length]);
      if (text) next.push({ model, text });
    }
    transcript = next.length ? next : transcript;
    if (!next.length) { process.stdout.write(`${C.dim}(tüm üyeler ulaşılamaz — durduruluyor)${C.reset}\n`); return; }
  }
  // Synthesis → single converged answer
  process.stdout.write(`\n${C.bold}── SENTEZ (tek cevap) ──${C.reset}\n`);
  const synthPrompt =
    `${COUNCIL_RULES}\n\nKONU: ${topic}\n\nÜYE GÖRÜŞLERİ:\n` +
    transcript.map((t) => `### ${t.model}\n${t.text}`).join("\n\n") +
    `\n\nTüm görüşleri tart. TEK converged cevabı kanıtıyla ver. Uzlaşma yoksa 'uzlaşma yok: <kaç farklı konum>' de.`;
  await streamTurn(CHAMPION, synthPrompt, C.colors[0], 45000);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.topic) { process.stdout.write("kullanım: node scripts/council-debate.mjs --topic \"<soru>\" [--models a,b,c] [--rounds 2]\n"); process.exit(1); }
  const installed = await listInstalled();
  if (!installed.length) { process.stdout.write(`⚠ ollama (${OLLAMA}) erişilemez veya model yok — council çalışamaz.\n`); process.exit(1); }
  const members = args.models ? args.models.split(",").map((s) => s.trim()).filter(Boolean) : pickCouncilModels(installed, CHAMPION, 3);
  if (!members.length) { process.stdout.write("⚠ council üyesi seçilemedi.\n"); process.exit(1); }

  // Single-shot when there's no interactive TTY (piped / CI / --here in a pipe) — readline would
  // throw on a closed stdin. The operator-interactive follow-up loop runs only with a real TTY.
  if (!process.stdin.isTTY) { await runDebate(args.topic, members, args.rounds); return; }

  let topic = args.topic;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  for (;;) {
    await runDebate(topic, members, args.rounds);
    const follow = (await ask(`\n${C.dim}↳ sıradaki soru (Enter=bitir): ${C.reset}`)).trim();
    if (!follow) break;
    topic = follow;
  }
  rl.close();
}

// Run only when invoked directly (so tests can import the pure helpers).
if (import.meta.url === `file://${process.argv[1]}`) main();
