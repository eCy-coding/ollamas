# Secrets & profiles (v7)

The CLI stores your gateway API key (`apiKey`) and admin token (`saasAdminToken`)
**encrypted at rest** (AES-256-GCM) instead of plaintext. It also supports
multiple named **profiles** so one machine can target localhost, a tailscale box,
and a remote tenant with separate keys.

## Threat model — read this, it's honest

Encryption-at-rest with a local key file defeats **casual disclosure**:
- an accidental `git commit` of `~/.ollamas/cli.json`
- a backup, log, or screen-share that captures the file
- `cat ~/.ollamas/cli.json` over someone's shoulder

It does **NOT** stop a local attacker who can already read both the key file
(`~/.ollamas/.cli_master_key`, mode 0600) and the encrypted blob. That's the same
boundary `aws`, `gh`, and `stripe` CLIs accept for file-based credential storage.
For stronger isolation use a passphrase (below) or, when it lands (v11), the macOS
Keychain backend.

We do not oversell this: the win is "your key won't leak by accident", not
"your key is safe from a compromised account".

## Key sources

Pick **one** and stick with it — switching makes already-sealed secrets
un-openable (you'll get a clear warning + recovery steps, not a crash).

1. **Key file (default)** — `~/.ollamas/.cli_master_key`, 32 random bytes, 0600,
   created lazily the first time you store a secret. Zero friction. Works
   everywhere including headless SSH.
2. **Passphrase** — set `OLLAMAS_PASSPHRASE`. The key is derived via scrypt from
   your passphrase + a persisted random salt (`~/.ollamas/.cli_salt`); the key
   itself never touches disk. Best for CI / shared machines. The same passphrase
   must be set on every run.

`open()` **throws** on a wrong key or tampered blob — the CLI never silently
sends an empty key as auth. A command that needs a secret it can't decrypt fails
with the normal `OLLAMAS_API_KEY` hint.

## Recovery

If you lose the key file (or change passphrase) the sealed secrets can't be read.
The CLI warns and ignores them; just re-set:
```sh
ollamas config apiKey <your-key>
```
A pre-v7 plaintext config is migrated automatically on first run, and the
original is kept as `~/.ollamas/cli.json.bak.<timestamp>` (0600) — restore from
there if needed.

## Profiles

```sh
ollamas config profiles                 # list (active marked *)
ollamas config use box                  # switch / create the "box" profile
ollamas config gateway https://box.ts.net
ollamas config apiKey olm_xxx           # sealed into the box profile
ollamas --profile box chat "hi"         # one-shot override, any command
```

- `default` profile lives in `~/.ollamas/cli.json`; named profiles in
  `~/.ollamas/profiles/<name>.json`.
- Each profile seals its own secrets — keys never bleed between profiles.
- Selection precedence: `--profile` flag > `OLLAMAS_PROFILE` env >
  active profile (`config use`) > `default`.

## Environment overrides (never persisted)

`OLLAMAS_API_KEY` / `OLLAMAS_SAAS_ADMIN` win over the stored value for that run
and are **never written to disk**. Use them for ephemeral / CI auth.
