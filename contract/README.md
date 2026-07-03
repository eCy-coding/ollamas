# ollamas Contract Lane

Machines sign a contract → register by email → the operator (T0) approves locally →
an API key is issued into a pool → all connected machines run big models as **one
machine** (fleet scheduling + real llama.cpp rpc-server layer-split). Sovereign,
zero-account: no SMTP, no third-party auth.

## End-to-end flow

```
  MEMBER machine                         OPERATOR (T0)
  ─────────────                          ────────────
  contract join --email you@x.co  ──▶    (notified) contract approve <m_id>
       │  (key saved 0600)                     │  issues olm_ key → pool
       ▼                                        ▼
  contract offer                          contract server install   (pool always-up)
   ├ node-config (mesh IP auto)                 │
   ├ serve-rpc daemon (launchd)                 ▼
   └ heartbeat daemon (launchd)          contract shard up --from-pool <model>
       │  permanent, reboot-survivable          │  head over member rpc endpoints
       ▼                                        ▼
  advertises 100.64.x:50052  ◀── mesh ──▶  POST /api/pool/generate → source:shard:head
                                            (one big model split across machines)
```

## Operator (0-manual pool)

| Command | Effect |
|---|---|
| `contract server install` | launchd daemon (`com.ollamas.server`) — pool stays up across reboot; persists operator node-config (serverUrl) |
| `contract server status` / `uninstall` | daemon state / remove |
| `contract list` | all members (pending/active/…) |
| `contract approve\|reject\|suspend\|resume\|rotate\|revoke <m_id>` | membership lifecycle (approve issues the key; rotate re-keys; new key via `contract status <id>`) |
| `contract audit [limit]` | governance trail (secret-free, auto-rotated) |
| `contract shard up --from-pool <model>` | launch a shard head over live, reachable pool members (preflight-probed) |
| `contract shard proof <model>` | local 2-rpc split proof (dual rpc-log growth) |
| `contract doctor` | live e2e + env health (ollama/mesh/daemons/pending approvals) |

Approval is intentionally manual (the contract), but no longer silent-poll — a new
applicant fires a local notification (and Slack/Discord if `CONTRACT_NOTIFY_SLACK` /
`CONTRACT_NOTIFY_DISCORD` are set). The cockpit shows an amber "N bekleyen onay" cue.

## Member (permanent contribution)

| Command | Effect |
|---|---|
| `contract join --email you@x.co` | apply → poll → key saved `~/.ollamas/contract-key` (0600) |
| `contract offer [--model M] [--port P]` | ONE command: node-config + rpc daemon + heartbeat daemon → permanent, reboot-survivable pool member (auto-advertises its mesh IP) |
| `contract offer stop` | tear both daemons down |
| `contract quota` | daily request usage |

## Cross-host networking (extensible)

Mesh reachability comes from **tailscale/headscale** (`tailscale ip -4`, 100.64.0.0/10).
`contract offer` auto-detects and advertises this machine's mesh IP. New transports
(WireGuard/manual) plug in via `CONTRACT_RPC_HOST`. `.local` mDNS is deliberately
unsupported (off-mesh resolution + unauthenticated rpc — see ERR-CONTRACT-008).

For real 2-device cross-host: bring up tailscale on both, `contract offer` on members,
`contract shard up --from-pool` on the operator. Everything else (daemons, config,
preflight, mesh discovery) is already in place.

## Security & conventions

- Raw `olm_` key: delivered once (approval/rotation status poll), never persisted or
  logged (ERR-CONTRACT-002). Ledger holds `keyId` only; store keeps a SHA-256 hash.
- rpc-server binds private/mesh only (`isPrivateHost`, RISK-K1); public bind refused.
- Gateway quota is charge-on-success (a failed generate never burns quota).
- Zero-dep, `node --test`, TDD, atomic 0600 state. Gotchas: `errors_registry.json`.
- Roadmap + shipped versions: `ROADMAP.md`. Live self-report: `npm run whoami`.
