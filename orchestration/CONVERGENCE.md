# CONVERGENCE — landing lanes onto the trunk (v1.30.2)

How many long-lived lane branches converge onto the trunk through a single
`integration/all-lanes` staging branch, with an encoded conflict policy and a
strict "planner never writes a ref" safety contract.

Tool: `orchestration/bin/converge.ts` (planner). Real execution is **deferred to
v1.30.3** and is **[T0]-gated** (Emre approves the ref advance).

## Merge order — security FIRST, key-autonomy LAST

`mergeOrder()` sorts lanes deterministically:

| rank | class | lanes | why |
| ---: | --- | --- | --- |
| 0 | security | `fix/audit-security`, any `*security*` | the security posture lands first so later lanes inherit the hardened baseline |
| 1 | feature/chore | everything else (alphabetical) | ordinary lanes, stable order |
| 2 | trunk / final | `feat/key-autonomy` | the trunk itself re-integrates last, after every lane has landed |

## Per-lane plan (`planLane`)

For one lane, converge produces the ordered sequence:

1. `merge trunk → lane` — bring the lane current (✎ref)
2. **gate lane** — `tsc --noEmit` + `vitest` + security-gate (no ref)
3. `merge --no-ff lane → integration/all-lanes` (✎ref)
4. **gate integration** — same gate on the staging branch (no ref)
5. `[T0] fast-forward trunk → integration` — human-approved ref advance (✎ref)
6. `re-merge remaining lanes` onto the advanced trunk, in convergence order (✎ref)

Steps marked ✎ref mutate a git ref. In v1.30.2 **none of them run** — see below.

## Conflict-zone policy (`classifyConflict`)

When a path changed on both the trunk and the lane since their merge-base, the
resolution is decided by policy, never ad hoc:

| zone | matcher | policy | meaning |
| --- | --- | --- | --- |
| security | `.github/workflows/security.yml`, `.semgrep/**`, `docs/audit/SEC-BASELINE.md` | **security-wins** | take the security lane's version verbatim; never hand-merge |
| generated | `orchestration/out/**`, `CRITIC*`, `COUNCIL*`, `DOD_LANES*`, `TASKS*`, `BUILD_PLAN*`, `ALIGN*`, `AUTOMATOR_*` | **regenerate** | do NOT merge artifacts — re-run their generator after the merge |
| manifest | `package.json`, `package-lock.json`, `.gitignore` | **union** | take the union of both sides |
| code / other | everything else | **hand-merge** | `[T0]` resolves manually |

`git add -A` is **never** used — staging is always path-scoped.

## Dry-run (default, safe) vs execute (deferred, [T0])

- **`--dry-run` (default):** READ-ONLY. Uses `git merge-base --is-ancestor`,
  `git diff --name-only`, `git rev-list` to print the plan + conflict forecast.
  Writes **no ref** — `git rev-parse HEAD` and `git status` are invariant before
  and after. This is the only mode shipped in v1.30.2.
- **`--execute`:** in v1.30.2 this only PREVIEWS the git argv the executor would
  run (labelled `[NOT-RUN]`) via `buildExecuteCommands()` and still writes no ref.
  Actual `git merge` / `push` / `branch -f` execution — and the step-5 `[T0]`
  fast-forward — land in **v1.30.3**, gated on explicit Emre approval.

### Usage

```bash
tsx orchestration/bin/converge.ts --dry-run feat/orchestra-conductor
tsx orchestration/bin/converge.ts --dry-run feat/orchestra-conductor --json
tsx orchestration/bin/converge.ts --dry-run <lane> --trunk=main --integration=integration/all-lanes
```
