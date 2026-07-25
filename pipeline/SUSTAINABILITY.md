# Sustainability & Autonomous-Loop Runbook (eCym · ollamas · obsidian)

> Living doc (H10.5). The four-party council (claudecode/ollamas/eCym/obsidian) runs the roadmap
> autonomously; this is the self-audit checklist, the "what would break" runbook, and the live
> efficiency scorecard. Kept honest: MISS ≠ PASS.

## Autonomous council loop
`council decides next ROI item → build in visible Terminal.app tabs, repo web/help ‖ vault _help →
verify (validateHelpSite / verify.sh / vitest) → teach-loop on failure → re-run parallel planner AIs
for touched systems → commit (pre-commit gate) → push fork → update GAPS.md/memory → next.`
Pauses only for: brand-new outward-facing actions (npm publish/brew/deploy/new remotes), irreversible
deletes, or anything touching `com.ecy*`.

## Self-audit checklist (run before declaring a cycle done)
- [ ] Source-truth: every new page/table/claim cites a real source; hand-prose bound to a source.
- [ ] Both targets advanced: repo `web/help/` AND vault `~/ollamas-vault/_help/` re-rendered.
- [ ] Gate green: `zsh pipeline/verify.sh` → FAIL=0; `npx vitest run --project pipeline` green; `tsc` clean.
- [ ] Coded site: `help-site --verify` PASS (0 dangling links, search non-empty, llms.txt, refs).
- [ ] Prompt-lint: `promptlint.ts` → 0 fiction on eCym.md + eCym2.md (block 24).
- [ ] Gaps: `GAPS.md` bekleyen 0 (every gap dispatched to a planner); new gaps logged.
- [ ] Delivery: commit both repos (pre-commit gate), push `fork`; vault local-only.
- [ ] No deletion outside `_sandbox/`; `com.ecy*` untouched; leftover Terminal tabs swept.

## "What would break" runbook (known failure modes → fix)
| Symptom | Root | Fix |
|---|---|---|
| pre-commit blocks on 3 failing tests | flaky `:11434`/firebase tests (env-dependent, not our code) | re-run suite; 2nd independent run is 0-fail → retry commit (never bypass) |
| leak-check FAIL "artık sekme" | live `board` left Terminal tabs open | `pkill -9 -f '\.ollamas/term'` then re-gate |
| coverage reporter omits a new lib file | vitest text `all`-mode skips mid-session files | trust the JSON summary (`--coverage.reporter=json-summary`) |
| `grep wikilink-broken` false positive | matches the CSS class `.wikilink-broken` | `--include='*.html'` only |
| `search-index.js` throws in node | file assigns `window.__HELP_INDEX__` | shim `global.window={}` before require |
| vault commit prints a cert/key | secret-scanner walks a pre-existing Excalidraw file | confirm your commit is `_help/`-only, no secret in YOUR diff |
| `p95(think) ≤ 350ms` gate fails | provably unreachable on free LLMs (566–1991ms) | keep the correction visible in the MEASURED block; do not fake |

## Live efficiency scorecard (updated per cycle)
Rubric: Efficiency = V ÷ max(1, E×(1−Done%)). Higher = more value per remaining work.

| # | Heading | Done% | V | Eff | Recent cycle |
|---|---------|------:|--:|----:|------|
| H1 | Foundation & layout | 55% | 7 | 1.9 | — |
| H2 | Prompts & contracts | **85%** | 9 | 6.0 | **C3: prompt-lint gate (block 24)** |
| H3 | eCym e2e | **80%** | 7 | 3.5 | C1: exec_loop guide |
| H4 | ollamas e2e | **70%** | 9 | 3.0 | C1: E-xxx FAQ · C2: `plan` in CLI table |
| H5 | obsidian e2e | **90%** | 8 | 8.0 | C1: real schema descriptions |
| H6 | Coded website | 75% | 10 | 4.0 | — |
| H7 | Gates & observability | **75%** | 8 | 3.2 | C3: block 24 |
| H8 | Orchestration/planning | **90%** | 8 | 8.0 | **C2: headless `pipeline plan`** |
| H9 | Terminal UX | 60% | 7 | 2.2 | C2: `plan` self-documents |
| H10 | Verify/deliver/sustain | **95%** | 8 | 12 | **C4: this doc** |

**Overall Done ≈ 78%** (was 71%). Remaining bulk: H4.4 (40+ docs consolidation), H6.2/6.3 (site depth + optional deploy), H7.4 (CI YAML), H1 (layout map + `.bak` policy), H9.3/9.4 (shortcuts + one-command). Outward-facing (deploy/CI/publish) stay gated on Emre's explicit call.

## Cycle log (autonomous)
- **C1** `dc13008`/`fbec6e7` — closed 3 planner follow-ups (obsidian schema-desc · ollamas E-xxx · eCym exec_loop).
- **C2** `003e32d`/`288b337` — headless `pipeline plan` autonomous-loop spine.
- **C3** `4553a53` — prompt-lint gate (fiction=error), verify.sh block 24. Gate PASS=61.
- **C4** (this) — sustainability runbook + live scorecard.
