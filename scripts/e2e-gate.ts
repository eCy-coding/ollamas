// Unified end-to-end health gate — the single source of truth for "is the whole
// localhost:3000 stack flawless right now". Checks every leg of the ollamas + eCym +
// odysseus + obsidian/brain/memory chain and emits one green/red JSON + a process exit
// code (0 = all green, 1 = any red). Zero deps (node built-ins only) so it runs the same
// under `npx tsx`, launchd, or CI.
//
// Consumers:
//   - operator:  `npx tsx scripts/e2e-gate.ts`  (human-readable JSON)
//   - watchdog:  scripts/e2e-watchdog.sh reads the exit code + JSON to self-heal/notify
//
// Design note: this REPORTS current truth. A leg may be legitimately mid-restart (e.g.
// odysseus during a provider switch) and show red transiently — the watchdog debounces
// with a consecutive-failure counter so a single transient red never triggers a restart.

const PORT = process.env.PORT || "3000";
const HOME = process.env.HOME || "";
const BASE = `http://127.0.0.1:${PORT}`;

interface CheckResult { name: string; ok: boolean; detail: string }
const checks: CheckResult[] = [];

async function req(url: string, init: RequestInit = {}, ms = 6000): Promise<{ status: number; text: string }> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  return { status: r.status, text: await r.text() };
}

async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  try {
    const { ok, detail } = await fn();
    checks.push({ name, ok, detail });
  } catch (e: any) {
    checks.push({ name, ok: false, detail: e?.message || String(e) });
  }
}

// 1. Hub :3000 — the anchor of the whole system.
await check("hub:3000", async () => {
  const { status, text } = await req(`${BASE}/api/health`);
  const j = JSON.parse(text);
  const ok = status === 200 && j.db === "up" && j.isLive !== false;
  return { ok, detail: `status=${status} db=${j.db} live=${j.isLive}` };
});

// 2. odysseus backend reachable THROUGH the hub bridge (the e2e chain leg).
await check("odysseus-bridge", async () => {
  const { status, text } = await req(`${BASE}/api/odysseus/run`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "health" }),
  }, 15000);
  const j = JSON.parse(text);
  return { ok: status === 200 && j.ok === true, detail: `status=${status} ok=${j.ok} ${String(j.result || "").slice(0, 40)}` };
});

// 3. ody-pulse liveness (:4777 root answers).
await check("pulse:4777", async () => {
  const { status } = await req("http://127.0.0.1:4777/");
  return { ok: status === 200, detail: `status=${status}` };
});

// 4. ollama engine (:11434).
await check("ollama:11434", async () => {
  const { status } = await req("http://127.0.0.1:11434/api/tags");
  return { ok: status === 200, detail: `status=${status}` };
});

// 5. chroma vector store (:8100, v2 heartbeat — v1 is 410 Gone).
await check("chroma:8100", async () => {
  const { status } = await req("http://127.0.0.1:8100/api/v2/heartbeat");
  return { ok: status === 200, detail: `status=${status}` };
});

// 6. brain/memory readable (SQLite-backed overview).
await check("brain", async () => {
  // overview computes over the full 47MB sqlite brain — allow a generous window.
  const { status, text } = await req(`${BASE}/api/brain/overview`, {}, 20000);
  const j = JSON.parse(text);
  return { ok: status === 200, detail: `status=${status} memories=${j.memories ?? j.total ?? "?"}` };
});

// 7. brain-loop freshness — the periodic consolidation must be firing (15-min launchd
//    timer; >40min stale = two missed cycles = broken).
await check("brain-loop-fresh", async () => {
  const { readFileSync } = await import("node:fs");
  const s = JSON.parse(readFileSync(`${HOME}/.llm-mission-control/loop-state.json`, "utf8"));
  const ageMin = (Date.now() - Number(s.lastAt || 0)) / 60000;
  return { ok: Number.isFinite(ageMin) && ageMin < 40, detail: `lastTurn ${ageMin.toFixed(1)}min ago (turn ${s.turn})` };
});

// 8. obsidian ⇄ brain mirror consistent (vault present, no unresolved conflicts).
await check("obsidian", async () => {
  const { status, text } = await req(`${BASE}/api/brain/obsidian/status`);
  const j = JSON.parse(text);
  return { ok: status === 200 && j.exists === true && (j.conflicts || 0) === 0, detail: `exists=${j.exists} conflicts=${j.conflicts} drift=${j.drift}` };
});

// 9. eCym dependency — the OpenAI-compatible surface eCym CLIs call.
await check("ecym:v1", async () => {
  const { status } = await req(`${BASE}/v1/models`);
  return { ok: status === 200, detail: `/v1/models status=${status}` };
});

const green = checks.every((c) => c.ok);
const out = { green, ts: Date.now(), iso: new Date(Date.now()).toISOString(), red: checks.filter((c) => !c.ok).map((c) => c.name), checks };
console.log(JSON.stringify(out, null, 2));
process.exit(green ? 0 : 1);

export {};
