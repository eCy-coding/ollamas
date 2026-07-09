#!/usr/bin/env node
// @ts-check
// scripts/gemini-lane.mjs — boot a DEDICATED ollamas gateway for gemini-cli work, on its OWN
// port + an ISOLATED data dir, CONCURRENT with the main stack on :3000 (it NEVER kills it).
//
// Why: the gemini-cli provider/dispatch can run heavy on a separate lane so it doesn't contend
// with the main server. A 2nd `tsx server.ts` binds cleanly on a new PORT; the only shared state
// is the file DBs under ~/.llm-mission-control → isolated here via MISSION_CONTROL_DATA_DIR.
//
//   npm run gemini:lane                 # boots on :3011 (or the next free port)
//   OLLAMAS_GEMINI_PORT=3022 npm run gemini:lane
// Then point work at it:
//   OLLAMAS_GATEWAY=http://127.0.0.1:3011 ollamas gemini status
//   OLLAMAS_GATEWAY=http://127.0.0.1:3011 ollamas agent --provider gemini-cli "<task>"
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const WANT = Number(process.env.OLLAMAS_GEMINI_PORT || 3011);

function portFree(p) {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.once("listening", () => s.close(() => res(true)));
    s.listen(p, "127.0.0.1");
  });
}
async function pickPort(start) {
  for (let p = start; p < start + 25; p++) if (await portFree(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 25})`);
}

const port = await pickPort(WANT);
if (port !== WANT) console.error(`[gemini-lane] :${WANT} busy → using :${port} (existing servers left untouched)`);

const dataDir = join(homedir(), ".llm-mission-control", "gemini-lane");
const env = { ...process.env, PORT: String(port), MISSION_CONTROL_DATA_DIR: dataDir, VITE_HMR: "false", DISABLE_HMR: "1" };
// The @google/genai SDK honors HTTP(S)_PROXY (but NOT NO_PROXY) — a dead/blocking corporate proxy
// strangles its transport with a bare "fetch failed" while every other provider (raw fetch) reaches
// its host. This lane is DEDICATED to Google/gemini work, so strip the proxy vars for the child so
// gemini reaches Google directly (proven: proxy-set→fetch failed; proxy-free→real cloud:gemini).
// The main :3000 stack keeps its proxy untouched. Opt out with OLLAMAS_KEEP_PROXY=1.
if (process.env.OLLAMAS_KEEP_PROXY !== "1") {
  for (const v of ["HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","FTP_PROXY","GRPC_PROXY","http_proxy","https_proxy","all_proxy","ftp_proxy","grpc_proxy","GLOBAL_AGENT_HTTP_PROXY","GLOBAL_AGENT_HTTPS_PROXY"]) delete env[v];
}
// vNEXT-C3: single-lane reaper — kill the PREVIOUS gemini-lane (this lineage only, via its recorded
// PID; NEVER :3000) so repeated boots don't pile up orphan `tsx server.ts` lanes on a loaded box.
mkdirSync(dataDir, { recursive: true });
const pidFile = join(dataDir, "lane.pid");
try {
  const prior = Number(String(readFileSync(pidFile, "utf8")).trim());
  if (prior && prior !== process.pid) {
    try { process.kill(prior, "SIGTERM"); console.error(`[gemini-lane] reaped stale lane pid ${prior}`); } catch { /* already gone */ }
  }
} catch { /* no prior pid file */ }

console.error(`[gemini-lane] booting a dedicated ollamas gateway on :${port}  (data: ${dataDir})`);

const child = spawn("./node_modules/.bin/tsx", ["server.ts"], { cwd: process.cwd(), env, stdio: "inherit" });
try { writeFileSync(pidFile, String(child.pid)); } catch { /* best-effort */ }
child.on("error", (e) => { console.error(`[gemini-lane] spawn failed: ${e?.message || e}`); process.exit(1); });
child.on("exit", (c) => process.exit(c ?? 0));

// Health-gate (best-effort): announce the lane URL once /api/health responds.
(async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const h = await res.json().catch(() => ({}));
        console.error(`[gemini-lane] READY → http://127.0.0.1:${port}  (mode=${h?.mode ?? "?"})`);
        console.error(`[gemini-lane] use it:  OLLAMAS_GATEWAY=http://127.0.0.1:${port} ollamas gemini status`);
        return;
      }
    } catch { /* not up yet */ }
  }
  console.error(`[gemini-lane] WARN: health did not come up in 40s — check the server output above.`);
})();

// Forward Ctrl-C to the child only (we never touch other servers).
for (const sig of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) process.on(sig, () => { child.kill(sig); });
