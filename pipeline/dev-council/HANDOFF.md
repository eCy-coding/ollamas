# Handoff — RESUME + AUDIT (dc-10.7/10.9)

> How to pause and resume the autonomous dev-council loop without losing context. Regenerate the
> live numbers with the commands below; the prose is the durable part.

## RESUME — pick up here
1. `cd ~/Desktop/ollamas && git log --oneline -5` — see the latest cycle.
2. `npx tsx pipeline/bin/devcouncil.ts status` — pool: how many todo/in_progress/done.
3. `npx tsx pipeline/bin/devcouncil.ts next code` (or `next bench`) — the next claimable card for SESSION-A.
4. Read `~/ollamas-vault/orchestra/dev-council/INBOX-A.md` — SESSION-B's latest findings + recommended cards.
5. Loop (SESSION-A): claim → build (repo `web/help/` ‖ vault `_help/` where a help artifact) →
   `zsh pipeline/verify.sh` (FAIL=0) → commit (pre-commit gate) → `git push fork feat/claudecode-vault` →
   mark the card done + append a WHY line to `LOG.md` → next.
6. Every few cycles: spawn a fresh SESSION-B reviewer (review the new commits, file FINDINGS/SUGGESTIONS).

## AUDIT — how to verify the state is real (not claimed)
```bash
zsh pipeline/verify.sh                       # expect FAIL=0 (26 blocks incl. site/a11y/prompt-lint/dev-council)
npx vitest run --project pipeline            # pure-core suite green
npx tsx pipeline/bin/help-site.ts all --verify   # coded site: 0 dangling, search non-empty, llms.txt
npx tsx pipeline/bin/htmllint.ts             # 0 a11y errors over web/help
npx tsx pipeline/bin/promptlint.ts           # prompts 0 fiction
git log --oneline @{u}..HEAD                 # empty = pushed/synced to fork
```

## Standing rules (never bend)
- **Green-gate to ship** · **source-truth** · **MISS ≠ PASS** · **two targets** (repo ‖ vault) ·
  **role-scoped lanes** (A code, B review) · **justified LOG** · no delete outside `_sandbox/` ·
  never touch `com.ecy*` · outward-facing (deploy/publish/CI) is Emre's explicit call.
- Roles/principles are operator-editable: `pipeline/dev-council/ROLES.md` + `PRINCIPLES.md`.

## What's shipped (cycle log lives in `pipeline/CHANGELOG.md`, regenerate with `bin/changelog.ts`)
The autonomous loop has delivered the coded help website (4 systems, both targets, a11y-clean,
llms.txt), the verified 87-task backlog on-tree, the dev-council two-session protocol, and the
quality gates (verify.sh blocks 22–26). Remaining backlog: run `devcouncil status` + read
`pipeline/ECYE2EMASTERPLAN.en.md` for the ⬜/🔶 items; outward-facing ones stay gated.
