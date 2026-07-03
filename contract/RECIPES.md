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

## Recipe 4 — Turnkey 2-command onboarding (vK17, minimum-manual)

The fastest path: an operator-signed invite pre-authorizes the device, so it
auto-activates (no async manual approve). TWO commands total.

### Operator (one command → a token)
```bash
contract server install                      # pool always-up (once)
contract invite --model qwen3:4b --ttl 15    # → prints a single-use, 15-min invite token
# (mesh) run headscale + mint a tailnet authkey for the device:
headscale preauthkeys create --user ollamas --reusable --expiration 1h
```
Hand the device: the invite token + the headscale URL + the tailnet authkey.

### Device (one command → contributing)
```bash
export CONTRACT_HEADSCALE_URL=http://<operator>.local:8080
export CONTRACT_TAILSCALE_AUTHKEY=<authkey>        # omit both if already on the mesh
contract bootstrap <invite-token>
#   → mesh-join → build-check (RPC llama.cpp) → apply-with-invite (AUTO-approved,
#     key saved 0600) → offer (rpc + heartbeat daemons) → permanent pool member
```
The device is now active in the pool immediately — no operator approve step. The
operator then `contract shard up --from-pool` includes it.

### Kill switch (operator)
```bash
contract invite rotate    # new operator key + epoch → ALL outstanding invites invalid at once
contract revoke <m_id>    # revoke a specific member
```

## Recipe 5 — One-click (one-paste) device onboarding (vK19)

The fewest-steps path: the operator emits a single command line; the device pastes it
once and ends up meshed + contributing. A signed CLI bundle is verified before it runs.

### Operator (once)
```bash
contract server install                       # pool always-up
bash contract/scripts/build-cli.sh            # bundle + sign the CLI (dist/contract-cli.mjs + .sig)
export CONTRACT_HEADSCALE_URL=http://<mac>.local:8080   # if running headscale
contract invite --oneclick --model qwen3:4b   # → prints ONE curl|bash line (10-min, single-use)
```
The one-liner embeds everything (server URL, fresh headscale authkey, operator pubkey,
signed invite). Send it to the device (paste/AirDrop/message).

### Device (one paste)
```bash
curl -fsSL "http://<mesh-ip>:3000/api/contract/install.sh?t=<token>" | bash
#   installs node≥24 + cmake → joins the mesh (authkey) → fetches the signed CLI →
#   VERIFIES the operator signature → bootstrap (build + auto-approve + offer)
#   → permanent pool member, immediately contributing
```

Honesty: this is **one paste** (open Terminal, paste, Return), not literally "zero-click".
A macOS `.command` file would be a double-click but can't cleanly carry a fresh authkey.

Security: the device runs operator-served code, verified against the operator's pubkey
(carried in the invite). Safe when operator == device owner (sovereign). See RISK-K21.

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
