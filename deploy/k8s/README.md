# Kubernetes deploy — ollamas gateway

`kubectl apply -f deploy/k8s/ollamas.yaml`

Deploys the **gateway / SaaS API** (MCP `/mcp`, `/api/saas/*`, `/api/billing/*`,
`/metrics`, `/api/health`, `/api/ready`). Image published to GHCR by
`.github/workflows/publish.yml` on a `v*` tag.

## ⚠️ Host-bridge does NOT run in K8s
The host tools (`macos_terminal`, `write_host_file`, `run_tests`, `build_app`, …)
execute on a **macOS host** via the local host-bridge (`bin/host-bridge`, port 7345),
which drives iTerm2/Terminal.app through AppleScript. Cloud Kubernetes has no macOS
host, so:
- These tools (tier `host`/`privileged`) **will fail** in a cloud pod.
- `MCP_EXPOSE_TIERS` defaults to `safe` here — host/privileged tools are not advertised.
- Consumed upstream MCP servers (`mcp__*`) and `safe` workspace tools still work.

To use host tools, run ollamas **on the macOS host** (`./start.sh` / docker-compose),
not in cloud K8s. A future option is a host-bridge sidecar/tunnel (backlog).

## Production notes
- Replace `ollamas-secrets` values with a real secret manager (Sealed Secrets, ESO).
- Multi-instance: set `REDIS_URL` so rate-limiting is shared (else per-pod in-memory).
- Stripe webhook needs a public Ingress to `/api/billing/webhook` + `STRIPE_WEBHOOK_SECRET`.
- Persistence: the SaaS store is `node:sqlite` (`~/.llm-mission-control/saas.db`). For
  multi-replica, mount a shared volume or migrate to Postgres (backlog).
