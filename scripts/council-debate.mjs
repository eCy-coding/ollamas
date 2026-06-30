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
import { selectCouncil, seatLine } from "./council-roster.mjs";

const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const CHAMPION = process.env.MAC_MODEL_CHAMPION || "qwen3:8b";
const GATEWAYS = [process.env.OLLAMAS_GATEWAY, "http://127.0.0.1:3000", "http://127.0.0.1:3020"].filter(Boolean);

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

async function streamTurn(model, prompt, color, timeoutMs = 60000) {
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

// Find a live ollamas gateway (for CLOUD council members via the vault api-keys). Null if none up.
async function detectGateway() {
  for (const g of GATEWAYS) {
    try { if ((await fetch(`${g}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return g; } catch { /* next */ }
  }
  return null;
}

// Live availability: which local models are installed, which cloud providers have live keys, and
// whether the keyless gemini binary is present — so a roster member only seats if it's reachable.
async function getAvailability() {
  const localModels = await listInstalled();
  const gateway = await detectGateway();
  let liveProviders = {}, geminiCli = false;
  if (gateway) {
    try {
      const j = await (await fetch(`${gateway}/api/keys/pool`, { signal: AbortSignal.timeout(2500) })).json();
      for (const [p, v] of Object.entries(j.pool || {})) liveProviders[p] = v.live || 0;
    } catch { /* no pool */ }
    try {
      const m = await (await fetch(`${gateway}/api/models/gemini-cli`, { signal: AbortSignal.timeout(2500) })).json();
      geminiCli = Array.isArray(m) && !String(m[0] || "").includes("not installed");
    } catch { /* */ }
  }
  return { localModels, liveProviders, geminiCli, gateway };
}

// Stream a CLOUD/keyless member's turn via the gateway /api/generate SSE (uses the vault key).
async function streamGateway(member, prompt, color, gateway, timeoutMs = 45000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  process.stdout.write(`\n${C.bold}${color}▸ ${member.model || member.id} ${C.dim}(${member.provider})${C.reset}\n`);
  let text = "";
  try {
    const res = await fetch(`${gateway}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: member.provider, model: member.model || undefined, messages: [{ role: "user", content: prompt }], stream: true }),
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
        if (!s.startsWith("data:")) continue;
        try {
          const j = JSON.parse(s.slice(5).trim());
          if (j.chunk) { process.stdout.write(j.chunk); text += j.chunk; }
        } catch { /* partial / done frame */ }
      }
    }
    process.stdout.write("\n");
    return text.trim();
  } catch (e) {
    process.stdout.write(`${C.dim}⚠ ${member.id} (cloud) unreachable — skipping (${(e && e.message) || e})${C.reset}\n`);
    return "";
  } finally { clearTimeout(timer); }
}

// Dispatch a member's turn to the right backend: local → ollama direct; cloud/keyless → gateway.
function streamMember(member, prompt, color, gateway) {
  if (member.kind === "local") return streamTurn(member.model, prompt, color);
  if (gateway) return streamGateway(member, prompt, color, gateway);
  process.stdout.write(`\n${C.dim}⚠ ${member.id} needs the gateway (cloud) — not running, skipping${C.reset}\n`);
  return Promise.resolve("");
}

async function runDebate(topic, members, rounds, gateway) {
  process.stdout.write(`\n${C.bold}═══ COUNCIL ▸ ${topic} ═══${C.reset}\n`);
  let transcript = [];
  for (let r = 1; r <= rounds; r++) {
    process.stdout.write(`\n${C.bold}── TUR ${r}/${rounds} ──${C.reset}\n`);
    const next = [];
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const prompt = buildMemberPrompt(COUNCIL_RULES, topic, r === 1 ? [] : transcript);
      const text = await streamMember(m, prompt, C.colors[i % C.colors.length], gateway);
      if (text) next.push({ model: m.model || m.id, text });
    }
    transcript = next.length ? next : transcript;
    if (!next.length) { process.stdout.write(`${C.dim}(tüm üyeler ulaşılamaz — durduruluyor)${C.reset}\n`); return; }
  }
  // Synthesis → single converged answer (the chair / champion synthesizes).
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
  const avail = await getAvailability();
  if (!avail.localModels.length && !avail.gateway) { process.stdout.write(`⚠ ollama (${OLLAMA}) ve gateway erişilemez — council çalışamaz.\n`); process.exit(1); }

  // --models overrides the roster with explicit local model ids; otherwise seat the justified panel.
  let members;
  if (args.models) {
    members = args.models.split(",").map((s) => s.trim()).filter(Boolean).map((id) => ({ id, kind: "local", provider: "ollama-local", model: id, specialty: "operator-selected", rationale: "--models", proof: "—" }));
  } else {
    members = selectCouncil(avail, 5);
  }
  if (!members.length) { process.stdout.write("⚠ erişilebilir council üyesi yok (model/anahtar).\n"); process.exit(1); }

  // Justified convene banner: WHY each member sits (specialty · rationale · proof).
  process.stdout.write(`\n${C.bold}╔══ COUNCIL ÜYELERİ (gerekçeli) ══╗${C.reset}\n`);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    process.stdout.write(`${C.colors[i % C.colors.length]}${C.bold}▸ ${seatLine(m)}${C.reset}\n${C.dim}   kanıt: ${m.proof}${C.reset}\n`);
  }
  process.stdout.write(`${C.dim}gateway: ${avail.gateway || "yok (yalnız local)"} · tur: ${args.rounds}${C.reset}\n`);

  // Single-shot when there's no interactive TTY (piped / CI / --here in a pipe).
  if (!process.stdin.isTTY) { await runDebate(args.topic, members, args.rounds, avail.gateway); return; }

  let topic = args.topic;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  for (;;) {
    await runDebate(topic, members, args.rounds, avail.gateway);
    const follow = (await ask(`\n${C.dim}↳ sıradaki soru (Enter=bitir): ${C.reset}`)).trim();
    if (!follow) break;
    topic = follow;
  }
  rl.close();
}

// Run only when invoked directly (so tests can import the pure helpers).
if (import.meta.url === `file://${process.argv[1]}`) main();
