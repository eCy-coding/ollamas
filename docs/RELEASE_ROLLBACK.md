# Release Rollback Runbook

Procedures for pulling back a bad `ollamas` release across every distribution channel:
npm, Homebrew, and the GitHub binary releases (with signed manifest). Run these when a
shipped version breaks users and a forward fix cannot land fast enough.

**Golden rule:** never delete a published artifact silently — *deprecate / yank / re-point*
so already-installed clients keep working while new installs stop landing on the bad build.
Every step ends with a **verify** so you have evidence the rollback took effect.

Fill in the placeholders before running (values verified in the 2026-07-10 dry drill):

- `BAD` — the broken version being rolled back (e.g. `1.24.0`).
- `GOOD` — the last known-good version to fall back to (e.g. `1.23.0` — the current
  `Latest` GitHub release at drill time).
- `PKG` — the npm package name: `ollamas`. **Note:** not yet published to npm (registry
  returns 404), so section 2 stays drill-only until the first `npm publish`.
- `TAP` — the Homebrew tap/formula (e.g. `ollamas/tap/ollamas`; no tap published yet —
  drill-only until it exists).
- `REPO` — the GitHub `owner/name` that hosts the releases: `eCy-coding/ollamas`.

---

## 1. Decide & freeze

Before touching any channel, stop the bleeding and record the decision.

1. Confirm the failure is release-wide (not a local/env issue) with at least one reproduction.
2. Freeze the pipeline so no new release can race the rollback:
   - Do **not** push new `v*` tags until the rollback is verified.
   - If a release run is in flight, cancel it: `gh run cancel <run-id> -R "$REPO"`.
3. Announce `BAD` is being rolled back and name the `GOOD` fallback (issue / status page).
4. Capture the current state for the post-mortem:
   ```sh
   npm view "$PKG" dist-tags --json
   gh release view "v$BAD" -R "$REPO" --json tagName,assets,isPrerelease
   ```
   (`isLatest` is not a `gh release view` field — use `gh release list` to see which
   release carries the `Latest` marker.)

**Verify:** the pipeline is quiet (no running release workflow) and `GOOD` is identified.

```sh
gh run list -R "$REPO" --workflow=release-binary.yml --limit 5
```

---

## 2. npm — deprecate, then yank if needed

Prefer **deprecate** (non-destructive, keeps the version resolvable) over `unpublish`.
Unpublish is only allowed within 72h and breaks anyone pinned to `BAD` — avoid unless legally
required.

> **Tatbikat-only (2026-07-10):** `PKG` is not on the registry yet (`npm view ollamas
> dist-tags --json` → E404), so steps 1–3 and the verify block cannot run until first publish.
> Dry part verified: `npm pack --dry-run` → exit 0 (5.5 MB tarball, 4794 files).

1. Deprecate the bad version with a message pointing at `GOOD`:
   ```sh
   npm deprecate "$PKG@$BAD" "Broken release — use $PKG@$GOOD. See docs/RELEASE_ROLLBACK.md"
   ```
2. Re-point the `latest` dist-tag back to the known-good version so `npm i $PKG` is safe again:
   ```sh
   npm dist-tag add "$PKG@$GOOD" latest
   ```
3. Only if the build is actively harmful and still inside the 72h window:
   ```sh
   npm unpublish "$PKG@$BAD"   # destructive — last resort
   ```

**Verify:**

```sh
npm view "$PKG" dist-tags          # latest → $GOOD
npm view "$PKG@$BAD" deprecated    # prints the deprecation message
```

---

## 3. Homebrew — revert the formula

The tap formula points at a specific version + URL + sha256. Roll it back to `GOOD`.

> **Tatbikat-only (2026-07-10):** no tap is published yet, so the `brew` verify block cannot
> run. The revert flow itself was drilled in a sandbox tap repo: `git revert --no-edit
> <bump-sha>` → exit 0, formula `version`/`url`/`sha256` restored to `GOOD` (1.31.0 → 1.30.4).

1. In the tap repo, revert the formula bump commit that introduced `BAD`:
   ```sh
   git -C "<tap-checkout>" revert --no-edit <formula-bump-sha>
   git -C "<tap-checkout>" push
   ```
   Or edit the formula by hand so `url`, `version`, and `sha256` match `GOOD` again.
2. If a bottle was published for `BAD`, delete that bottle asset from the release so Homebrew
   falls back to source/`GOOD`.
3. Ask users on the bad build to `brew update && brew upgrade $PKG` (they will now get `GOOD`).

**Verify:**

```sh
brew update
brew info "$TAP"          # stable version → $GOOD
brew install "$TAP" && ollamas --version   # prints $GOOD
```

---

## 4. GitHub binary release — re-point, don't delete

The `release-binary.yml` workflow publishes per-arch binaries, `.sha256`, `.minisig`
signatures, and a `latest.json` manifest that `ollamas update` consumes. Rolling back the
**manifest that `latest.json` advertises** is what actually moves clients off `BAD`.

> **Tatbikat-only (2026-07-10):** `gh release edit/download` against the real `REPO` is an
> outward step (no rollback was actually needed). Manifest re-point was drilled in a sandbox
> repo with `v1.30.4`/`v1.31.0` tags: after revert, `jq .version latest.json` → `"1.30.4"`.

1. Mark the bad release so it stops being served as newest:
   ```sh
   gh release edit "v$BAD" -R "$REPO" --prerelease --latest=false
   gh release edit "v$GOOD" -R "$REPO" --latest=true
   ```
2. Re-point the update channel. `ollamas update --manifest <url>` reads the newest
   `latest.json`; make the advertised manifest URL resolve to `GOOD`'s `latest.json`
   (set `v$GOOD` as `--latest`, or re-upload `GOOD`'s manifest to the channel's stable URL):
   ```sh
   gh release download "v$GOOD" -R "$REPO" -p latest.json -O latest.json
   ```
3. Confirm the served manifest still carries a valid **minisig signature + keyId** — signing
   is mandatory (see `.github/workflows/release-binary.yml`), so a `GOOD` manifest that is
   missing `minisig`/`keyId` must not be used.
4. Do **not** delete the `BAD` assets; leaving them (as prerelease) keeps existing pinned
   installs working and preserves forensic evidence.

**Verify:**

```sh
gh release list -R "$REPO" --limit 5                    # `Latest` marker → v$GOOD
gh release download "v$GOOD" -R "$REPO" -p latest.json -O - | jq .version   # == $GOOD
# End-to-end: a client update lands on GOOD and verifies its signature
ollamas update --manifest "https://github.com/$REPO/releases/download/v$GOOD/latest.json"
ollamas --version    # prints $GOOD
```

---

## 5. Post-rollback verification & close-out

A rollback is not done until a clean-room install of each channel lands on `GOOD`.

- [ ] npm: fresh `npm i $PKG` (no cache) installs `GOOD`; `BAD` shows deprecated.
- [ ] Homebrew: `brew install $TAP` on a clean prefix reports `GOOD`.
- [ ] Binary: `ollamas update` on a machine pinned to `BAD` moves to `GOOD` and the signature
      verifies (bad signature must abort the update).
- [ ] The always-running server survives the downgrade — run `ops/launchd/verify.sh` to confirm
      the launchd agent respawns and `/api/health` returns 200 after the rollback.
      *(Drilled 2026-07-10: `RESPAWN OK (label=com.ollamas.server old_pid=10865 new_pid=41137
      health=200)`, exit 0.)*
- [ ] Status page / issue updated: rollback complete, `GOOD` is the safe version.

Only after all boxes are checked, unfreeze the pipeline and open the forward-fix tracking issue
so `BAD`'s root cause is fixed before the next tag is pushed.
