# Troubleshooting

Common failures and how to resolve them. Each entry is **symptom → diagnosis →
fix**. Start with the deep health check — it names most of these for you:

```bash
npm run doctor    # node / ollama / bridge / app-health audit
npm run ready     # instant-on gate: detect + safe auto-fix prerequisites
```

---

## 1. Ollama daemon is down (local models fail)

**Symptom.** Chat/agent calls fail or fall back to a demo provider; errors like
`no local ollama model available` or connection-refused to `:11434`.

**Diagnosis.** The gateway talks to a local ollama engine at `OLLAMA_HOST`
(default `http://localhost:11434`, see `.env.example`). Check it's up and has a model:

```bash
curl -sS http://localhost:11434/api/tags     # should list models
ollama list
```

**Fix.**
```bash
ollama serve &                 # start the daemon if it isn't running
ollama pull qwen3:8b           # pull the default champion model
```
If ollama runs on another machine (remote GPU), point `OLLAMA_HOST` at it
(`OLLAMA_HOST="http://<host>:11434"`) and re-run `npm run doctor`.

---

## 2. Port 3000 already in use

**Symptom.** `npm run dev` / `make up` exits with `EADDRINUSE: address already in
use :::3000`, or the app never comes up on `http://localhost:3000`.

**Diagnosis.** The backend binds `PORT` (default **3000**, `.env.example`). Something
else already holds it — often a previous ollamas process that didn't exit, or an
unrelated dev server.

```bash
lsof -i :3000                  # who owns the port
```

**Fix.** Kill the stale process, or run on another port:
```bash
kill <pid>                     # from lsof output
# or:
PORT=3001 npm run dev
```
Note: in the AI Studio/Cloud Run deployment only port 3000 is externally served
(`.env.example`), so prefer freeing 3000 there rather than remapping.

---

## 3. Out-of-memory / Metal GPU thrash (OOM)

**Symptom.** Model load crashes, the machine swaps hard, or throughput collapses to
~0 tok/s when a large model loads. On Apple silicon you may see Metal OOM.

**Diagnosis.** Context length dominates KV-cache memory. The default context is
capped by `OLLAMA_NUM_CTX` (ships at **8192** in `.env.example`) precisely to bound
Metal GPU memory. A too-large context — or a model too big for your unified memory —
spills and thrashes. ollamas is single-GPU: it runs **one** model at a time
(`MAX_LOADED_MODELS=1`).

**Fix.**
- Lower the context bound:
  ```bash
  OLLAMA_NUM_CTX=4096 npm run dev
  ```
- Pick a model that fits your RAM (rule: `size ≤ total × 0.7`) — see
  [model-guide.md](./model-guide.md). On 18–24 GB, `qwen3:8b` is the safe default.
- Don't run multiple large models concurrently; sequence local LLM calls.

---

## 4. Health / readiness returns 503

**Symptom.** `GET /api/ready` returns **503**, load balancer marks the instance
unhealthy, or `npm run doctor` reports the app as not-ready.

**Diagnosis.** `/api/ready` (`server.ts:143`) is a *dependency* check: it returns
`200` only when the store answers a query, else **503** with `{ ready:false, db }`
(e.g. a Postgres replica is down). `/api/health` (`server.ts:188`) is the lighter
liveness probe and self-heals its mode on a re-probe.

```bash
curl -sS http://localhost:3000/api/ready     # { ready, mode, db }
curl -sS http://localhost:3000/api/health
```

**Fix.** Read the `db` field — a `down` store is the usual cause; bring the database
back and readiness flips to `200` on the next probe (no restart needed). If health is
green but ready is red, it's a dependency, not the app process.

---

## 5. Vite HMR fails / dev UI won't hot-reload

**Symptom.** The frontend loads but never hot-reloads; console shows a WebSocket
error to the HMR port (Vite's default HMR WebSocket is **24678**), or the UI flickers
during rapid file edits.

**Diagnosis.** HMR is controlled by the `DISABLE_HMR` env var (`vite.config.ts:97`).
When agents are editing files rapidly, HMR file-watching can flicker; when the HMR
WebSocket port is blocked/taken the client can't connect.

**Fix.**
- To stop flicker during heavy agent edits, disable HMR (also stops file watching):
  ```bash
  DISABLE_HMR=true npm run dev
  ```
  Then do a manual browser refresh to see changes.
- If the HMR socket is the problem, ensure the HMR port isn't held by another process
  (`lsof -i :24678`) or firewalled, then restart the dev server.

---

## 6. `/mcp` returns 401 / 403 / 406

**Symptom.** JSON-RPC calls to `/mcp` are rejected before any tool runs.

**Diagnosis + fix.**
- **401** — enforced mode (`SAAS_ENFORCE=1`) requires a key. Send
  `Authorization: Bearer olm_<key>` (issue one via `POST /api/saas/keys`).
- **403** — Origin blocked by the DNS-rebinding guard. Call from
  `localhost`/`127.0.0.1`, or set `ALLOWED_ORIGINS` in `.env`.
- **406** — your `Accept` header doesn't permit SSE. Send
  `Accept: application/json, text/event-stream`.

See [api-quickstart.md](./api-quickstart.md) for full working requests.

---

## Still stuck?

```bash
npm run doctor        # deep audit — node, ollama, bridge, ready, agent
npm run monitor       # deterministic invariant ledger (ground truth)
```

`doctor` prints a readiness table and the exact next command for anything still
blocking.
