# Master-key storage & the macOS Keychain (v11)

The CLI seals `apiKey` / `saasAdminToken` on disk with AES-256-GCM (v7). That sealing
needs a **32-byte master key**. v11 adds the **macOS login keychain** as a place to
keep that key — it does **not** put the individual secrets in the keychain, only the
master key. The on-disk `*Enc` sealing is unchanged; only *where the key lives* moves.

## Sources & precedence

`loadMasterKey()` resolves the key from exactly one source, in this order:

1. **`OLLAMAS_PASSPHRASE`** → scrypt-derived, key never on disk (headless/CI-friendly). Always wins.
2. **Explicit choice** — `--insecure-storage` / `OLLAMAS_KEYSTORE=file|keychain`, or the persisted `.keystore` marker from a `config keystore` switch.
3. **Existing keyfile** (`~/.ollamas/.cli_master_key`) → **file** — a v7 user is *never* silently moved.
4. **New macOS user, no keyfile** → **keychain** (the v11 default).
5. else → **file**.

```sh
ollamas config keystore                # show the current source + where the key lives
ollamas config keystore keychain       # migrate the master key INTO the login keychain
ollamas config keystore file           # migrate it back to the 0600 keyfile
ollamas --insecure-storage <cmd>       # force the file keystore for one run (skip keychain)
```

Migration carries the **same key bytes**, so every already-sealed secret stays
openable. The keychain switch **verifies the read-back before removing the keyfile**
(verify-before-destroy); the file switch drops the keychain copy so the move is clean.

## Always degrades — never throws

Every keychain call returns `null`/`false` on **any** failure — non-macOS, SSH, a
locked keychain, a not-found item, a 5 s timeout, or a stored value that isn't 32
bytes — and the CLI falls back to the keyfile. A hung keychain prompt can't block the
CLI (5 s cap). You can always opt out with `--insecure-storage`.

## Honest security note (no over-claim)

- **What improves:** the key moves from a static 0600 file (readable whenever the
  account is active, captured by backups) into the login keychain — encrypted at
  rest, locked when the Mac sleeps/locks, ACL-scoped.
- **argv leak on WRITE:** `security add-generic-password -w <base64key>` makes the key
  briefly visible in `ps` (~100 ms) **once**, at write time — `/usr/bin/security` has
  no stdin/file input for the value. This is the accepted trade-off of staying
  zero-dep (a native-framework binding would avoid it, but that needs a native addon
  we don't add — `keytar` is archived). **READ (`find -w`) does not expose the key.**
- **ACL:** items added via the CLI may prompt on access depending on the keychain ACL.
  We **don't** force `-A` (allow-any-app), which would let any process read the key
  silently — a weaker posture we deliberately avoid.
- The key-source choice lives in a plain `~/.ollamas/.keystore` marker, **not** inside
  the sealed config (it must be readable before the key exists).

## Non-breaking guarantee

Existing keyfile / passphrase users are unaffected until they explicitly run
`config keystore keychain`. The keychain backend is macOS-only; everywhere else the
keyfile is used exactly as in v7.

## Adoption (license-disciplined, zero npm dep)

Pattern-only (no vendored source): **99designs/aws-vault** + **sorah/envchain** +
**r-lib/keyring** (MIT) for the `security` generic-password recipe and the
always-degrade contract; **kishikawakatsumi/KeychainAccess** (MIT) for ACL semantics
(idea-only). `atom/node-keytar` is archived + a native addon → we shell out instead.
