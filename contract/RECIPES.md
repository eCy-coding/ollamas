# Contract Lane Recipes

Concrete runbooks. See `README.md` for the overview, `errors_registry.json` for gotchas.

## Recipe 1 — Real 2-device compute pool (tailscale mesh)

Goal: two Macs (or a Mac + Linux box) run one big model split across both, reached
over a private tailnet. No accounts beyond tailscale/headscale.

### Both machines (one time)
```bash
# mesh: tailscale (or headscale) — gives each machine a 100.64.x address
brew install tailscale && sudo tailscale up      # macOS
tailscale ip -4                                   # note the 100.64.x address
# RPC-enabled llama.cpp (brew bottle lacks GGML_RPC):
bash contract/scripts/build-llamacpp.sh           # → ~/.ollamas/bin/{rpc-server,llama-server}
```

### Operator machine (holds the pool + launches shards)
```bash
contract server install          # launchd com.ollamas.server → pool always up (reboot-safe)
export SAAS_ADMIN_TOKEN=…         # if SAAS_ENFORCE=1; else admin routes are open on localhost
```

### Member machine (contributes its GPU, permanently)
```bash
contract join --email you@example.com     # apply; key saved 0600
# operator approves (gets a notification): contract approve <m_id>
contract offer --model qwen3:4b           # ONE command: node-config + rpc daemon + heartbeat daemon
#   → auto-advertises this machine's 100.64.x:50052 over the mesh; survives reboot
```

### Operator launches the shard
```bash
export CONTRACT_API_KEY=olm_…             # any member key, to read the pool
contract doctor                           # cross-host step: confirms member rpc reachable over mesh
contract shard up --from-pool qwen3:4b    # head over member endpoints (preflight-probed)
curl -s $OLLAMAS_URL/api/pool/generate -H "Authorization: Bearer olm_…" \
  -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'
#   → {"source":"shard:head", ...}  = one big model split across both machines
contract watch                            # live liveness monitor (member drop → re-run shard up)
```

## Recipe 2 — Single-machine split proof (no 2nd device)
```bash
contract shard proof qwen3:4b   # 2 local rpc-servers + head; BOTH rpc logs grow = split live
```

## Recipe 3 — Tear down a member
```bash
contract offer stop             # removes both daemons (rpc + heartbeat)
# operator: contract revoke <m_id>   (permanent)  |  contract suspend <m_id> (temporary; resume later)
```

## Troubleshooting (see errors_registry.json)
- Member `fresh` but shard drops it → operator can't reach its rpc inbound: ERR-CONTRACT-011
  (serve-rpc bound loopback not mesh, or tailscale ACL blocks 50052). Fix: `contract offer` on the
  member (auto-mesh-host), open the port in the tailnet ACL, re-check `contract doctor`.
- Head hangs on model load → MTU/firewall on the rpc port: ERR-CONTRACT-012.
- Build fails `No rule to make target rpc-server` → target is `ggml-rpc-server`: ERR-CONTRACT-003.
