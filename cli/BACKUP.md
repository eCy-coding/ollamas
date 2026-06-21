# `ollamas backup` — encrypted config backup (v15)

Manage the gateway's **encrypted config backup** from the terminal — for CI, cron,
and disaster recovery. The CLI is a thin client over the gateway's `/api/backup/*`
group (choke-point HTTP, no registry import). The backup blob is **AES-GCM
ciphertext** (the gateway holds the key); the CLI never decrypts it.

```sh
ollamas backup config                     # show settings (accessKey masked)
ollamas backup config --type s3 --endpoint https://… --bucket b \
  --access-key AKIA… --secret-key … --interval 120 --enabled
ollamas backup trigger                    # run a backup now (to the configured S3/WebDAV)
ollamas backup download --out today.enc   # save the encrypted blob (0600)
ollamas backup restore today.enc --yes    # restore config from a blob — DESTRUCTIVE
```

## Notes (correctness + safety)

- **`download` is binary.** The gateway sends raw `application/octet-stream`
  ciphertext; the CLI reads the bytes verbatim (`arrayBuffer`) and writes a **0600**
  file. It refuses to dump the blob to an interactive TTY (it is not human-readable);
  pass `--out <file>`. Default name `backup-<time>.enc`.
- **`restore` is destructive** — it overwrites the live gateway config. It prompts
  for confirmation; `--yes` skips the prompt, and `--json` (non-interactive) **requires
  `--yes`** (no silent destructive op). The CLI hex-encodes the file bytes (the
  gateway's restore expects hex) — the exact inverse of `download`, so a
  `download → restore` round-trips byte-for-byte.
- **Secrets.** `config` shows the `accessKey` **masked** (the gateway returns
  `sk-***`); `secretKey` is never returned and never printed. Set credentials only
  via the explicit `--access-key`/`--secret-key` flags.
- **Auth.** On a SAAS-enforced gateway set `OLLAMAS_SAAS_ADMIN` (sent as
  `X-Admin-Token`); on a local gateway no auth is needed.

## Automation (cron)

```sh
# nightly encrypted backup, kept 0600
ollamas backup download --out "$HOME/backups/ollamas-$(date +%F).enc"
```

The blob is encrypted at rest, so it is safe to store off-box. Restore on a fresh
gateway with `ollamas backup restore <file> --yes`.
