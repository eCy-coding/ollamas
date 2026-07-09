# Concurrency Audit — v1.28.2

Static sweep for 4 classic multi-writer race patterns across `src/ bin/ scripts/ cli/ orchestration/`
(`.ts` + `.mjs`). Each candidate gets a `path:line` and a ruling: **CONFIRMED** (a real cross-process
race that can corrupt shared state) or **FALSE-POS** (single-writer, already-guarded, distinct-path, or
per-slot / idempotent so no interleaving hazard).

**Priority surface — multi-process writers of `~/.llm-mission-control/`.** These files are written by
several fleet dispatch **processes** in parallel (`orchestration/bin/fleet-agent.ts`,
`orchestration/bin/gemini-run.ts`), so they carry the highest blast radius: a lost update or a torn read
under-counts the free-tier daily budget and the fleet over-dispatches past the cap.

- `gemini-quota.json` ← `orchestration/bin/lib/gemini-quota.ts` `noteOutcome` (fleet-agent.ts:104,109;
  gemini-run.ts:86,91)
- `vendor-budget.json` ← `orchestration/bin/lib/vendor-budget.ts` `noteVendorOutcome` (fleet-agent.ts:199,208,218;
  gemini-run.ts:149,152)
- `benchmark.json` ← `bin/host-bridge/benchmark.mjs:157` (single writer — see P3)

**Pre-excluded as already-guarded (marked FALSE-POS where they surface):**
`orchestration/bin/lib/gpu-lock.ts` (Lamport-bakery via `withLock`), `orchestration/bin/lib/claims.ts`
(mkdir-mutex + LWW + fence-TTL), `orchestration/bin/lib/backoff.ts` (pure, no IO).

---

## P1 — Lockless read-modify-write on shared JSON (load → mutate → save)

Pattern: `JSON.parse(readFileSync(f))` … mutate … `writeFileSync(f)` on a file another process also
writes. Two processes read the same old value, both write back → the second clobbers the first (lost
update).

| path:line | shared file | ruling |
|---|---|---|
| `orchestration/bin/lib/vendor-budget.ts:136` `noteVendorOutcome` | `~/.llm-mission-control/vendor-budget.json` | **CONFIRMED → FIXED** |
| `orchestration/bin/lib/gemini-quota.ts:55` `noteOutcome` | `~/.llm-mission-control/gemini-quota.json` | **CONFIRMED → FIXED** |
| `scripts/audit-fleet.mjs:78,100` (`existsSync`→`writeFileSync`) | `raw/<unit>.json` (per-unit, distinct path per worker) | FALSE-POS (no shared key; idempotent skip) |
| `scripts/system-monitor.mjs:133` (read ledger tail) | append-only ledger, read-only here | FALSE-POS (reader only) |
| `cli/lib/config.ts:159/233`, `cli/lib/modelcache.ts:65` | user config (interactive, single CLI process) | FALSE-POS (not fleet-concurrent) |
| `bin/host-bridge/tools/model_select.mjs:32` | `benchmark.json` (read-only) | FALSE-POS (reader only) |

**Blast radius (CONFIRMED):** `noteVendorOutcome` / `noteOutcome` are called from every fleet dispatch
process on success/exhaustion. Concurrent processes lose each other's `+1` → the daily free-tier counter
under-counts → the pool keeps dispatching after the real cap is spent → wasted/over-spent quota, the exact
failure the budget gate exists to prevent.

**Fix:** wrap the whole `load → mutate → save` in `withLock(`${path}.lock`, …)` (the mkdir(2) mutex +
stale-TTL takeover primitive from `claims.ts`), serializing the RMW across processes. See P3 for the
matching atomic-write half. Regression: `tests/race-vendor-budget.test.ts`.

---

## P2 — `Promise.all` over shared mutable state

Pattern: `Promise.all([...])` whose tasks mutate a variable captured from the enclosing closure.

| path:line | ruling |
|---|---|
| `scripts/agent-fleet.mjs:66` `Promise.all(FLEET.map(runWorker))` | FALSE-POS (each worker returns its own result; no shared mutable) |
| `scripts/audit-fleet.mjs:122` `Promise.all(len CONC worker)` | FALSE-POS (workers pull from a queue, write distinct per-unit files) |
| `bin/host-bridge/tools/lib/web-extract.mjs:119` | FALSE-POS (bounded worker pool, per-index result slots, no overlap) |
| `cli/commands/remote.ts:89` `Promise.all(pool.map(probeBackend))` | FALSE-POS (pure map → array; no in-place mutation) |

No confirmed in-process shared-mutable race. Node's single-threaded event loop plus per-task-local results
means these are safe; the real hazard in this codebase is cross-**process**, covered by P1/P3.

---

## P3 — Non-atomic `writeFileSync` (another process reads the same file)

Pattern: `writeFileSync(sharedFile, data)` with no tmp+rename. `writeFileSync` truncates then writes, so a
concurrent reader in another process can observe a truncated/partial file → `JSON.parse` throws → the
loader's `catch` silently returns `{}`/fresh → the whole persisted state looks empty → over-dispatch.

| path:line | shared file / reader | ruling |
|---|---|---|
| `orchestration/bin/lib/vendor-budget.ts` `saveBudget` (was line 121) | `vendor-budget.json`, read by `loadBudget`/`guardVendor` in other processes | **CONFIRMED → FIXED** (tmp + `renameSync`) |
| `orchestration/bin/lib/gemini-quota.ts` `saveQuota` (was line 41) | `gemini-quota.json`, read by `loadQuota`/`guardQuota` | **CONFIRMED → FIXED** (tmp + `renameSync`) |
| `bin/host-bridge/benchmark.mjs:157` writes `benchmark.json` | read by `model_select.mjs`, `doctor.mjs` | CONFIRMED (low-freq single writer; readers tolerate stale — NOT fixed this pass, follow-up) |
| `orchestration/bin/status.ts:181`, `panel.ts:171-174`, `quality.ts:87` | `*.md`/`*.json` reports (single conductor writer, human-read) | FALSE-POS (single writer) |
| `contract/src/node-config.ts:58` | already tmp+rename (atomic) | FALSE-POS (guarded) |
| `cli/commands/update.ts:217` | already tmp+rename (atomic) | FALSE-POS (guarded) |
| `bin/siri-ask.mjs:46`, `bin/host-bridge/tools/web_search.mjs:33` | per-key cache file, best-effort | FALSE-POS (distinct paths, disposable) |

**Fix (CONFIRMED, the two budget files):** `saveBudget`/`saveQuota` now write a unique
`${path}.<pid>.<ts>.tmp` sibling then `renameSync` over the target — `rename(2)` is atomic on POSIX, so a
concurrent reader sees either the whole old file or the whole new one, never a torn blob. This closes the
torn-read half; P1's `withLock` closes the lost-update half.

---

## P4 — `existsSync` check-then-act (TOCTOU)

Pattern: `if (existsSync(f)) …` then `writeFileSync(f)` — the file's state can change between the check and
the act.

| path:line | ruling |
|---|---|
| `bin/host-bridge/scaffold.mjs:86` `if (existsSync(abs)) refuse; … writeFileSync` | FALSE-POS (interactive scaffold, single user process; refuse-on-exist is intent, not a race) |
| `orchestration/bin/lib/gemini-quota.ts:44-47` `guardQuota` (load→rollover) then later `noteOutcome` | Was a check-then-act split across two calls; the `noteOutcome` half is now `withLock`-guarded so the durable count is race-free. The guard read stays advisory (pre-flight hint), which is correct. FALSE-POS post-fix |
| `bin/host-bridge/tools/lint_format.mjs:19-27` stamp check→write | FALSE-POS (per-build cache, single process) |
| `scripts/system-monitor.mjs:133`, `scripts/substack-digest.mjs:52` `existsSync(LEDGER)`→read | FALSE-POS (reader only) |
| `bin/host-bridge/lib/siri-log.mjs:73` `existsSync`+`statSync`→`renameSync` rotate | FALSE-POS (best-effort log rotation, wrapped in try/catch) |

No standalone TOCTOU race with a corruption consequence. The one that mattered — the budget guard→note
split — is subsumed by the P1 lock (the note is the authoritative write; the guard is a hint).

---

## Summary

| Pattern | Candidates | CONFIRMED | Fixed this pass |
|---|---|---|---|
| P1 lockless RMW | 6 | 2 | 2 |
| P2 Promise.all shared-mutable | 4 | 0 | 0 |
| P3 non-atomic write | 7 | 3 | 2 (both budget files) |
| P4 existsSync TOCTOU | 5 | 0 | 0 |

**Fixed (highest blast radius):** `orchestration/bin/lib/vendor-budget.ts` `noteVendorOutcome`/`saveBudget`
and `orchestration/bin/lib/gemini-quota.ts` `noteOutcome`/`saveQuota` — `withLock`-serialized RMW +
atomic tmp+rename write. Regression test: `tests/race-vendor-budget.test.ts` (4 concurrent `tsx`
processes, barrier-synchronized, asserts every increment survives).

**Follow-up (out of scope this pass):** `bin/host-bridge/benchmark.mjs:157` `benchmark.json` non-atomic
write (single low-frequency writer, readers tolerate stale — lower blast radius).
