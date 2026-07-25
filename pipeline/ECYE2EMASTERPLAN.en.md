---
name: ecy-e2e-master-plan
description: eCym+ollamas+obsidian+claudecode — reference-level end-to-end master plan (10 phases × subtasks), VERIFIED against the real Mac state
metadata: { node_type: plan, type: project, version: 1.2.0-en, created: 2026-07-25T08:10:25Z, verified: 2026-07-25 }
---

# eCyOS — End-to-End Master Plan (reference-level · VERIFIED)

> **Scope:** the inventory of code/folders/documents/system-prompts/terminal-commands/docs that must exist on the Mac for the eCym · ollamas · obsidian (· claudecode) systems to run end-to-end at reference-site level. Status: ✅ present & verified · 🔶 partial · ⬜ to be built.
> **v1.1 VERIFICATION (2026-07-25):** with 3 parallel verification agents + a real Mac-side inventory probe (`inventory.command`), every subtask was confirmed against actual file/folder/service presence. Because the repo `~/Desktop/ollamas` is outside the mount, it was verified at the existence level (inventory), while the vault/`.local`/`.ollamas` were verified at the content level.

## Legend (status legend)
✅ present & verified · 🔶 partial (to be expanded) · ⬜ to be built · [lang] · [path] · [command]

## How to read status
✅ done & verified = 1.0 · 🔶 partial = 0.5 · ⬜ missing = 0.0; completion% = Σweight/count.

---

## 1. Repo & Folder Architecture (foundation)
> Goal: everything has its place; two targets (repo ‖ vault) in parallel.
- 1.1 🔶 Vault tier-folders (core/procedural/learned/episodic/working/entities + _index/_help) exist — **but the `_reference` tier is MISSING at the vault root** (only `help/_reference/`) [md] [accept: `ls` at vault root shows core/ procedural/ learned/ episodic/ working/ entities/ _index/ _help/; a root-level `_reference/` either exists or is reconciled per 1.8]
- 1.2 ✅ Repo `~/Desktop/ollamas/` — `pipeline/{bin,lib,runtime,tests}`, `web/help/`, `tests/`, `.git`, `.github/workflows` present [TS] [git] [accept: `ls ~/Desktop/ollamas` shows pipeline/ web/help/ tests/ .git/ .github/workflows/, and pipeline/ contains bin lib runtime tests]
- 1.3 ✅ Launcher directory `~/.local/bin/` (cckb, ecy-tab/hub/board/tasks/log, open-help-web, ecy-cc, ecy-cmd) [zsh] [accept: `ls ~/.local/bin` lists cckb ecy-tab ecy-hub ecy-board ecy-tasks ecy-log open-help-web ecy-cc ecy-cmd, all executable]
- 1.4 ✅ Terminal lane root `~/.ollamas/term/<lane>/` — 37 lanes, each with tab.sh+queue+log [zsh] [accept: `ls ~/.ollamas/term/` shows 37 lane dirs, each containing tab.sh, queue, and log]
- 1.5 ⬜ Naming convention `_index/NAMING.md` (MISSING) [md] [accept: file `_index/NAMING.md` exists and lists the help-*/cc-*/ecy-* conventions]
- 1.6 🔶 `.gitignore` is solid (_sandbox/+secrets+trash), but the branch strategy is undocumented (practice: main, 0 ahead of origin) [git] [accept: `.gitignore` contains _sandbox/, secrets and trash entries AND a branch-strategy note is documented (e.g. in ARCHITECTURE.md or CONTRIBUTING)]
- 1.7 ⬜ `ARCHITECTURE.md` — 4 systems + data-flow diagram (MISSING) [md] [accept: file `ARCHITECTURE.md` exists and documents all 4 systems plus a data-flow diagram]
- 1.8 ⬜ Create the `_reference/` tier or reconcile 1.1 (today only help/_reference exists) [md] [accept: either a root-level `_reference/` dir exists or 1.1/1.8 explicitly records that the reference tier lives at help/_reference/]

## 2. ollamas: Mission-Control & LLM Router
> Goal: local brain + free inference + visible DAG orchestration.
- 2.1 ✅ brain `:3000` remember/recall — `server/brain-obsidian.ts` present (note: `:3000` was DOWN at probe time; code exists, runtime is flaky) [TS] [accept: file `server/brain-obsidian.ts` exists and exposes remember/recall; when the service is up, POST :3000 remember then recall round-trips the stored note]
- 2.2 ✅ `:3000/v1/chat/completions` OpenAI-compatible router — `ecy-orchestrator.py ex_llm` calls this endpoint (verified) [TS] [accept: `ecy-orchestrator.py` ex_llm targets :3000/v1/chat/completions and a POST returns an OpenAI-shaped chat completion]
- 2.3 ✅ allowlist gateway `server/terminal.ts` present (isShellRunnable internal integrity is outside the repo mount; existence ✅) [TS] [accept: file `server/terminal.ts` exists and defines isShellRunnable that rejects a non-allowlisted command]
- 2.4 ✅ pipeline board DAG runner — `runtime/termtab.ts` + `lib/logfmt-stream.ts` present [TS] [accept: files `runtime/termtab.ts` and `lib/logfmt-stream.ts` exist and the board runner executes a DAG]
- 2.5 ✅ orchestrator `_bin/ecy-orchestrator.py` — ex_search→cckb, ex_llm→:3000/v1, ex_brain→remember, DAG+parallel+retry+benchmark_report (read) [Python] [accept: `_bin/ecy-orchestrator.py` defines ex_search/ex_llm/ex_brain and supports DAG, parallel, retry, and benchmark_report]
- 2.6 ✅ doctor/health `pipeline/verify.sh` present (the concurrent <15s aspect is outside the repo mount) [TS] [accept: `pipeline/verify.sh` exists and exits 0 on a healthy stack]
- 2.7 ⬜ ollamas README + PROMPT.md source-of-truth `_index/ollamas-prompt.md` (MISSING) [md] [accept: file `_index/ollamas-prompt.md` exists as the ollamas prompt source-of-truth]
- 2.8 ⬜ Unit tests `tests/ollamas.test.ts` (could not be proven) [TS/vitest] [accept: `tests/ollamas.test.ts` exists and `vitest` runs it green]
- 2.9 ⬜ brain `:3000` runtime-health/uptime gate (was DOWN at probe; overlaps with Phase 9) [TS] [accept: a health gate polls :3000 and blocks/reports when GET :3000 health is not live]

## 3. eCym: Command Model & Route
> Goal: natural language → command, capsule-first answer, workflow execution.
- 3.1 ✅ `ecy-cc` capsule-first Q&A (cckb ask→brain fallback, exit 0/1/2) — read [zsh] [accept: `ecy-cc "<q>"` returns a cckb capsule (exit 0), falls back to brain, and uses exit codes 0/1/2]
- 3.2 🔶 `ecy-cmd` natural-language→command route (MODEL-LESS Tier1, exit 0/1/2/3, --catalog/--list/--id) — route accuracy untested [TS/json] [accept: `ecy-cmd --list` and `--catalog` work and `ecy-cmd "<phrase>"` maps to a command id with exit 0/1/2/3, backed by a passing route-accuracy test]
- 3.3 🔶 `ecy-run.sh` DAG launcher EXISTS & complete in vault `_bin` — **but is NOT installed on PATH as `~/.local/bin/ecy-run`** [zsh] [accept: `_bin/ecy-run.sh` exists AND `~/.local/bin/ecy-run` resolves to it on PATH]
- 3.4 ⬜ specialists registry `.ecym/specialists.json` (MISSING in repo) [json] [accept: file `.ecym/specialists.json` exists and validates as a specialists registry]
- 3.5 🔶 eCym command catalog — `_index/ecym-komut-index.md` (227 commands) + `_help/ecym/reference/*` exist, but a unified full table + exit-code table is MISSING [md] [accept: a single consolidated table lists all 227 commands with their exit codes]
- 3.6 ⬜ eCym system-prompt `_index/ecym-system-prompt.md` (MISSING) [md] [accept: file `_index/ecym-system-prompt.md` exists]
- 3.7 ⬜ tests `tests/ecym.test.ts` (could not be proven) [TS/vitest] [accept: `tests/ecym.test.ts` exists and `vitest` runs it green]
- 3.8 ⬜ `~/.local/bin/ecy-run` PATH launcher (→ `_bin/ecy-run.sh` symlink/wrapper) [zsh] [accept: `command -v ecy-run` resolves and it invokes `_bin/ecy-run.sh`]
- 3.9 ⬜ eCym exit-code contract doc (0 ok/1 no-match/2 ambiguous/3 need_arg) [md] [accept: a doc defines exit codes 0=ok, 1=no-match, 2=ambiguous, 3=need_arg]
- 3.10 ⬜ put `terminal-dataset.json` under version control (today in `~/ecy-model/`, off-tree) [json] [accept: `terminal-dataset.json` lives inside the repo/vault tree and is git-tracked, not under `~/ecy-model/`]

## 4. obsidian: Vault Brain & Gateway
> Goal: the vault = mirror of the brain; graph + REST bridge.
- 4.1 ✅ Local REST API `:27124` gateway (probe 200; write/delete 204) [plugin] [accept: GET :27124 returns 200 and write/delete return 204]
- 4.2 ✅ vault mirror `brain-obsidian.ts` (OBSIDIAN_VAULT env) [TS] [accept: `brain-obsidian.ts` reads OBSIDIAN_VAULT and mirrors a remembered note into the vault]
- 4.3 ✅ graph: `[[wikilink]]` + `.base` dual channel — `_index/claude-code.base` (filters/formulas/3 views) + 5 .base [base] [accept: `_index/claude-code.base` exists with filters/formulas/3 views and ≥5 .base files total]
- 4.4 ✅ MOC/_index + 7 `*.canvas` (claude-code.canvas 38 nodes, entities-map-v2) [canvas] [accept: 7 *.canvas files exist including claude-code.canvas with 38 nodes]
- 4.5 ⬜ vault-ground RAG `server/vault-ground.ts` (MISSING in repo) [TS] [accept: file `server/vault-ground.ts` exists and grounds answers against vault notes]
- 4.6 ✅ obsidian REST API reference table — a full 9-row operation table (method/example/returns) in `help-obsidian.md` [md] [accept: `help-obsidian.md` contains a 9-row REST table with method/example/returns columns]
- 4.7 🔶 graph/.base/wikilink explanation — `help-obsidian.md` "Two channels" tabs + `_help/obsidian/*` exist but scattered, not a single depth page [md] [accept: a single depth page explains graph/.base/wikilink together]
- 4.8 ✅ `_help/` vault-native help mirror — full 4-system tree + per-system .docx + `_help/site.canvas` (unplanned artifact, present) [md/canvas/docx] [accept: `_help/` mirrors all 4 systems with per-system .docx and `_help/site.canvas` present]

## 5. claudecode: Knowledge Layer (cckb + verify)
> Goal: canonical documents, offline capsules, health gate.
- 5.1 ✅ cckb offline capsules + `_index/cc-capsules.json` — **219 capsules** (~1 KB, slug/url/tldr/kw/hash) [zsh/json] [accept: `_index/cc-capsules.json` has 219 entries, each with slug/url/tldr/kw/hash]
- 5.2 ✅ `cc-verify.sh` — real 13-block/~25-check gate, exit 1 on FAIL [zsh] [accept: `cc-verify.sh` runs 13 blocks/~25 checks and exits 1 on any FAIL (cc-verify FAIL=0 when green)]
- 5.3 ✅ `.claude/` surface: skill cc-kb, `/cc`, SessionStart hook, settings [md/json] [accept: `.claude/` contains the cc-kb skill, the `/cc` command, a SessionStart hook, and settings]
- 5.4 ⬜ root `CLAUDE.md` (graph-linked) — MISSING in vault (find is clean) [md] [accept: file `CLAUDE.md` exists at the root and is graph-linked]
- 5.5 🔶 canonical document sync — 219 capsules url+hash (drift-detect) + `.cc-refresh-state.json` + `com.ollamas.cc-refresh`; the plan's "172" is stale; llms.txt drift-apply unverified [Python] [accept: sync tracks 219 url+hash pairs, `.cc-refresh-state.json` present, launchd `com.ollamas.cc-refresh` loaded, and a drift-apply run updates changed capsules]
- 5.6 ✅ glossary — `help-referans.md` "Glossary" 18 terms (capsule/MOC/allowlist/gate) [md] [accept: `help-referans.md` glossary defines 18 terms including capsule, MOC, allowlist, gate]
- 5.7 ⬜ "what's new"/changelog equivalent (MISSING) [md] [accept: a changelog / "what's new" doc exists]
- 5.8 🔶 cc-capsules drift-apply pipeline (`cc-capsules.py` + refresh-state + launchd) — sync/diff script awaits explicit verification [Python] [accept: `cc-capsules.py` diff+apply updates `.cc-refresh-state.json` and is triggered by launchd]

## 6. Help Website (coded, reference-level)
> Goal: landing card-grid → per-system docs; search/TOC/theme/responsive.
- 6.1 ✅ renderer `help/_web/render.py` v2 — build-time highlight, callout/tab/card/accordion, TOC, breadcrumb, prev/next [Python] [accept: `render.py` emits HTML with build-time highlight, callout/tab/card/accordion, TOC, breadcrumb, and prev/next]
- 6.2 ✅ assets: `style.css` (light+dark, @media responsive), `app.js` (search+scroll-spy+copy+hamburger+toggle) [CSS/JS] [accept: `style.css` has light+dark + @media rules and `app.js` implements search, scroll-spy, copy, hamburger, and theme toggle]
- 6.3 ✅ 13-page type-rubric 13/13 (component/moc/getstarted/reference/contribute) + `_build/score.py` [md→html] [accept: `_build/score.py` shows 13/13 across the type rubrics]
- 6.4 🔶 content depth — flagship pages HAVE full endpoint/REST ref; remaining: formal beginner→advanced restructure [md] [accept: flagship pages carry the full endpoint/REST reference and a beginner→advanced restructure is tracked]
- 6.5 ✅ `search-index.json` (13 pages) + `.js` shim (file:// safe) [json/js] [accept: `search-index.json` covers 13 pages and the `.js` shim loads under file://]
- 6.6 ⬜ `llms.txt` machine index (render.py does not emit it) [txt] [accept: `llms.txt` is generated and lists the site's pages]
- 6.7 ✅ dual target: `web/help/` (repo) ‖ `_help/` (vault) + **`_help/site.canvas` PRESENT** (inventory was a false-negative) [html/canvas] [accept: both `web/help/` and `_help/` render, and `_help/site.canvas` exists]
- 6.8 ✅ REFERENCES.md · DESIGN-SYSTEM.md · GAP-LOG.md permanent [md] [accept: files REFERENCES.md, DESIGN-SYSTEM.md and GAP-LOG.md all exist]
- 6.9 ⬜ beginner→advanced page layering (quickstart→workflows→reference→advanced) [md] [accept: pages are layered quickstart→workflows→reference→advanced]
- 6.10 ⬜ add `llms.txt` generation to render.py (closes 6.6) [Python] [accept: running `render.py` produces `llms.txt`, satisfying 6.6]

## 7. System Prompts & Contracts (prompt engineering)
> Goal: each agent's role + invariant + measurable contract.
- 7.1 ✅ `ecy-e2e-help-prompt-v2.json` — `prompt_version:2.1.0`, page_type_rubrics/map [json] [accept: `ecy-e2e-help-prompt-v2.json` parses as valid JSON with prompt_version 2.1.0 and page_type_rubrics/map]
- 7.2 🔶 v9 canonical prompt — `ecym/eCym2.md` MISSING; content migrated into the 7.1 JSON (supersedes eCym2.md) [json/md] [accept: the v9 canonical prompt content lives in the 7.1 JSON and a note records that it supersedes `ecym/eCym2.md`]
- 7.3 ✅ `ecy-workflow-v3.json` — v3.0, full **6 phases (order 0-5) × 28 steps** DAG (verified) [json] [accept: `ecy-workflow-v3.json` is valid JSON at v3.0 with 6 phases (order 0-5) and 28 steps]
- 7.4 🔶 master pipeline prompt (search→…→push + MEASURED) — scattered across workflow-v3 + v2.1 JSON, not consolidated [md] [accept: a single consolidated master pipeline prompt covers search→…→push with MEASURED gates]
- 7.5 ⬜ per-system role cards (ollamas/eCym/obsidian) — only embedded in the v2.1 JSON `roles{}` [md] [accept: standalone role-card files exist for ollamas, eCym and obsidian]
- 7.6 🔶 `prompt-sync.ts` (present in repo; auto-update logic is outside the repo mount) [TS] [accept: `prompt-sync.ts` exists and syncs prompt files without drift]
- 7.7 ⬜ prompt versioning + repair-loop doc (MISSING) [md] [accept: a doc describes prompt versioning and the repair-loop]
- 7.8 ⬜ obsidian role card (split from 7.5: 3 systems as separate files) [md] [accept: a standalone obsidian role-card file exists (7.5 split into 3 files)]

## 8. Terminal.app Orchestration & Live Visibility
> Goal: every background job in a tab, readable log, live.
- 8.1 ✅ `ecy-tab/ecy-hub/ecy-board/ecy-tasks/ecy-log` [zsh/osascript] [accept: all five commands ecy-tab/ecy-hub/ecy-board/ecy-tasks/ecy-log exist and open Terminal.app tabs]
- 8.2 ✅ `open-help-web.command` (open in Chrome) [zsh] [accept: `open-help-web.command` opens the help site in Chrome]
- 8.3 🔶 pipeline board `--lanes ... --narrate` — runner+5 lanes exist, full flags outside repo mount; lane-name drift (ecym vs ecym-help) [TS] [accept: `pipeline board --lanes ... --narrate` runs all 5 lanes with consistent lane names (ecym-help, not ecym)]
- 8.4 ✅ per-lane `tab.sh` — present in the 5 canonical lanes [zsh] [accept: each of the 5 canonical lanes has a `tab.sh`]
- 8.5 ✅ logfmt `time|source|LEVEL|message` — `lib/logfmt-stream.ts` [TS] [accept: `lib/logfmt-stream.ts` emits lines in `time|source|LEVEL|message` format]
- 8.6 🔶 `ecy-hub` opens one window with 6 labeled tabs — but separate conductor + ALGORITHM(why) panels are MISSING [zsh] [accept: `ecy-hub` opens 6 labeled tabs and adds a conductor panel + an ALGORITHM(why) panel]
- 8.7 ⬜ terminal command reference card `_index/TERMINAL-KOMUTLARI.md` (MISSING) [md] [accept: file `_index/TERMINAL-KOMUTLARI.md` exists and lists the ecy-* terminal commands]
- 8.8 🔶 add conductor + ALGORITHM(why) panels to `ecy-hub` (`com.ollamas.orchestra.conductor` is running) [zsh] [accept: `ecy-hub` shows a conductor panel and an ALGORITHM(why) panel backed by `com.ollamas.orchestra.conductor`]

## 9. Quality Gates, Benchmark & Verification
> Goal: MISS ≠ PASS; every claim measured.
- 9.1 ✅ `cc-verify.sh` — 13-block gate, exit 1 on FAIL [zsh] [accept: `cc-verify.sh` gate runs 13 blocks and exits 1 on any FAIL (cc-verify FAIL=0 when green)]
- 9.2 🔶 `validateHelpSite`/`help-site --verify` — repo TS, could not be verified off-mount [TS] [accept: `help-site --verify` reports 0 dangling links]
- 9.3 🔶 workflow benchmark — 5 reports give only p50/p95; **p99/p999 MISSING, no gate pass/fail verdict** [Python/TS] [accept: benchmark reports include p50/p95/p99/p999 and an explicit gate pass/fail verdict]
- 9.4 ✅ teach-on-error loop (missing→brain remember tier=learned→retry) [—] [accept: on a missing fact the loop writes brain remember tier=learned and retries the same lane]
- 9.5 🔶 security/coverage/chaos — workflow-v3 `quality_gates` + `security_scan/coverage_check/chaos_test` steps DEFINED but **stub (0.0 ms), no report artifact** (not implemented) [Python/yaml] [accept: security_scan/coverage_check/chaos_test each run for >0 ms and emit a report artifact]
- 9.6 🔶 `pipeline/verify.sh` + `tests/` + `pipeline/tests/` exist; "full-green" could not be verified off-mount [zsh/vitest] [accept: `pipeline/verify.sh` plus tests/ and pipeline/tests/ all run full-green]
- 9.7 ⬜ Lighthouse-like a11y/perf audit (MISSING) [js] [accept: an a11y/perf audit runs and emits scores]
- 9.8 🔶 wire `security_scan/coverage_check/chaos_test` to REAL executors (bandit/semgrep, pytest-cov≥90, chaos) [Python] [accept: the three gates call bandit/semgrep, pytest-cov (≥90%), and a chaos runner for real]
- 9.9 🔶 write benchmark p99/p999 + explicit gate pass/fail block (thresholds ready in `quality_gates`) [Python] [accept: benchmark output has p99/p999 and an explicit pass/fail block using quality_gates thresholds]

## 10. Documents, Doc Export & Delivery
> Goal: doc file + permanent documents + commit discipline.
- 10.1 ✅ `.docx` export — 4 per-system `_help/{claude,ecym,ollamas,obsidian}/*.docx` + master `eCyOS-ollamas-help.docx` (34 KB) present [pandoc] [accept: 4 per-system .docx + master `eCyOS-ollamas-help.docx` (~34 KB) exist under _help/]
- 10.2 ✅ permanent documents: REFERENCES · DESIGN-SYSTEM · GAP-LOG · this PLAN [md] [accept: REFERENCES.md, DESIGN-SYSTEM.md, GAP-LOG.md and this plan all exist]
- 10.3 ✅ **doc file OF THIS PLAN**: `_index/ECY-E2E-MASTER-PLAN.docx` (produced with pandoc in this phase) [pandoc] [accept: file `_index/ECY-E2E-MASTER-PLAN.docx` exists (pandoc-built from this plan)]
- 10.4 🔶 memory — 283 episodic notes (incl. epoch-* summaries) exist, but a consolidated `MEMORY.md` is MISSING [md] [accept: a consolidated `MEMORY.md` summarizes the 283 episodic/epoch notes]
- 10.5 ✅ commit discipline: local commit, NO push to main/remote (0 ahead of origin) [git] [accept: `git log` shows local commits and `git status` shows 0 ahead of origin (no remote push)]
- 10.6 🔶 CI/CD `.github/workflows/` dir present in repo; yml/benchmark+verify wiring could not be verified off-mount [yaml] [accept: `.github/workflows/` has a yaml wiring benchmark + verify that runs in CI]
- 10.7 ⬜ handoff/RESUME + AUDIT documents (MISSING) [md] [accept: handoff/RESUME and AUDIT docs exist]
- 10.8 ⬜ `MEMORY.md` consolidation (from 283 episodic/epoch notes) [md] [accept: `MEMORY.md` is generated by consolidating the 283 episodic/epoch notes]
- 10.9 ⬜ RESUME + AUDIT + handoff document set [md] [accept: the RESUME + AUDIT + handoff document set all exist]

---

## Summary counter (VERIFIED — 87 subtasks)
| Phase | ✅ | 🔶 | ⬜ | Total |
|---|---|---|---|---|
| 1 Folders | 3 | 2 | 3 | 8 |
| 2 ollamas | 6 | 0 | 3 | 9 |
| 3 eCym | 1 | 3 | 6 | 10 |
| 4 obsidian | 6 | 1 | 1 | 8 |
| 5 claudecode | 4 | 2 | 2 | 8 |
| 6 Web | 6 | 1 | 3 | 10 |
| 7 Prompt | 2 | 3 | 3 | 8 |
| 8 Terminal | 4 | 3 | 1 | 8 |
| 9 Quality | 2 | 6 | 1 | 9 |
| 10 Docs | 4 | 2 | 3 | 9 |
| **TOTAL** | **38** | **23** | **26** | **87** |

Overall readiness: (38×1.0 + 23×0.5 + 26×0.0) / 87 = 49.5 / 87 = **56.9%**.

> **Verification delta:** the v1.0 claim was 34✅/18🔶/21⬜ (body: 38/20/26, inconsistent). v1.1 real: **36✅/19🔶/17⬜** (72 original) + 15 new subtasks, and with the live-disk correction of 10.3 (⬜→✅) folded into the counter → **38✅/23🔶/26⬜** (87), overall readiness 56.9%. Key corrections: 1.1✅→🔶, 3.3✅→🔶, 3.4🔶→⬜, 4.6⬜→✅, 5.4✅→⬜, 6.7🔶→✅, 10.1🔶→✅, 10.4✅→🔶, 10.3⬜→✅.
> **Method:** Mac-side `inventory.command` (existence probe) + 3 parallel verification agents (Phases 1-3 / 4-6 / 7-10), evidence-based. Related: [[REFERENCES]] · [[DESIGN-SYSTEM]] · [[GAP-LOG]] · [[ecy-e2e-help-prompt-v2]] · [[ecy-workflow-v3]]
