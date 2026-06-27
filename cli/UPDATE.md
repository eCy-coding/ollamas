# Self-update & plugins (v10)

## `ollamas update`

Self-updates a **binary** install from a release manifest, verifying the download
before it touches the running binary.

```sh
ollamas update --check                       # show current vs latest, no download
ollamas update --manifest https://…/latest.json
OLLAMAS_UPDATE_MANIFEST=https://…/latest.json ollamas update
```

- The manifest URL is **explicit** (`--manifest` or `OLLAMAS_UPDATE_MANIFEST`) —
  nothing is hardcoded and there is no background update check.
- The asset is **sha256-verified against the manifest**; a mismatch aborts and the
  live binary is never modified.
- Replacement is atomic: download → verify → `chmod +x` → drop macOS quarantine →
  `rename` over the running file (the open inode survives, so it's safe).
- A **node-run install** (`node …/index.cjs`, e.g. `npm link`) is updated via your
  package manager, not self-replace — the command says so and exits.

### Manifest format (`latest.json`)

```json
{
  "version": "10.1.0",
  "assets": [
    { "target": "darwin-arm64", "url": "https://…/ollamas-darwin-arm64", "sha256": "<64-hex>" },
    { "target": "linux-x64",    "url": "https://…/ollamas-linux-x64",    "sha256": "<64-hex>" }
  ]
}
```

`target` is `${process.platform}-${process.arch}`. Host `latest.json` anywhere over
HTTPS (a GitHub release asset is fine). `.github/workflows/release-binary.yml`
(draft) builds per-arch binaries + checksums + this manifest on a `vX.Y.Z` tag.

> Integrity tier: v10 verifies sha256-over-HTTPS (zero-dep). **v18** adds detached
> **minisign** signatures verified against a compile-time pinned public key — see below.

## Detached signatures (minisign, v18)

Each release asset can carry a detached minisign signature. When a pinned public key
exists (`cli/lib/pubkey.ts` `PINNED_PUBKEYS`) and the manifest asset has a `minisig`,
`ollamas update` verifies the Ed25519 signature against the pinned key **before** the
binary touches disk (in addition to sha256). Verification is pure + zero-dep
(`cli/lib/minisign-verify.ts`). With no pinned key the CLI runs in bootstrap mode
(sha256-only + a loud warning); a pinned key + present `minisig` is a hard gate.

In the manifest, `minisig` is either the signature text body **or** a URL to the
`.minisig` file; `keyId` is the informational 16-hex key id:

```json
{
  "target": "darwin-arm64",
  "url": "https://…/ollamas-darwin-arm64",
  "sha256": "<64-hex>",
  "minisig": "https://…/ollamas-darwin-arm64.minisig",
  "keyId": "E839E6F0EF25E6B7"
}
```

### Sign + verify flow

1. **Operator keygen (one-time, OUTSIDE CI — never commit the `.key`):**
   ```sh
   minisign -G -s ~/.minisign/ollamas.key -p ~/.minisign/ollamas.pub
   ```
   Paste the `.pub`'s **two lines** into `cli/lib/pubkey.ts` `PINNED_PUBKEYS`, e.g.
   `"untrusted comment: minisign public key …\nRWS…<base64>",` — ship that build.

2. **CI secret:** generate an **unencrypted** CI key with `minisign -G -W`, then store
   the whole key-file contents as the repo secret **`MINISIGN_SECKEY`**. The
   `release-binary` workflow writes it to a temp keyfile, runs `cli/sign-release.sh`,
   uploads `<binary>.minisig`, and embeds `minisig`/`keyId` in `latest.json`. The
   signing step **no-ops gracefully** if the secret is absent (forks build unsigned).
   No real key is ever committed.

3. **User (automatic):** `ollamas update` fetches the manifest, verifies sha256 + the
   minisign signature against the pinned key, and only then installs. Tamper or a
   wrong key → refused.

Local manual signing mirrors CI:
```sh
MINISIGN_SECKEY=~/.minisign/ollamas.key cli/sign-release.sh dist/ollamas-darwin-arm64
```

## `ollamas plugin` — external subcommands

A plugin is an executable run as `ollamas <name>`. It is **checksum-gated**: it
runs only while its file still matches the sha256 recorded at install time. We do
not scan `$PATH` or auto-install — installing is the explicit trust step.

```sh
ollamas plugin install ./ollamas-deploy      # copy → ~/.ollamas/plugins/deploy, record sha256
ollamas plugin list                          # name · ✓ ok / ✗ tampered · path
ollamas deploy --env prod                     # runs the plugin (args + stdio inherited)
ollamas plugin remove deploy
```

- Registry: `~/.ollamas/plugins.json` (`{name, path, sha256, installed}`), files in
  `~/.ollamas/plugins/`.
- A **tampered or replaced** plugin file fails verification and is refused (exit 1)
  — reinstall to re-trust.
- Plugin names are a single safe segment (`a-z 0-9 -`); no path traversal.

**Plugins run arbitrary code.** Install only what you trust, exactly as you would a
shell script.
