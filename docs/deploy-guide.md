# Deploy Guide — pick your path

ollamas deploys four ways: **local (npm)**, **Docker**, **docker-compose**, and **Helm/Kubernetes**.
The split that decides everything is *host tools*: `macos_terminal`, `write_host_file`, `run_tests`,
`build_app`, … execute on a **macOS host** via the host-bridge (`bin/host-bridge`, port 7345), which
drives iTerm2/Terminal.app through AppleScript. They cannot run in a cloud pod.

## Decision tree

```
Do you need host tools (macos_terminal, build_app, …)?
├── YES → you must run on the macOS host
│   ├── fastest dev loop, hot reload        → Path A: Local (npm)
│   └── hardened, self-healing, one command → Path C: docker-compose (`./install.sh` or `make up`)
└── NO  → gateway / SaaS API only (works on Linux)
    ├── single server                       → Path B/C: Docker or docker-compose
    └── cluster, autoscaling, migrations    → Path D: Helm (preferred) or raw k8s manifests
```

## Path A — Local (npm / node)

The no-docker fallback in `install.sh` uses exactly this path.

```bash
npm install
npm run ready        # preflight: pulls the default ollama model if missing
npm run dev          # tsx server.ts — dev server on :3000
```

Production-style local run:

```bash
npm run build        # vite build + esbuild → dist/server.cjs
npm start            # node dist/server.cjs
```

Verify: `curl -fs http://localhost:3000/api/health`. Data lives in `~/.llm-mission-control/`.

## Path B — Docker (single container)

`Dockerfile` is dual-stage (node:24-slim builder → slim runtime with system Chromium for puppeteer),
runs as non-root `nodeapp`, and ships a `HEALTHCHECK` against `/api/health`.

> **Known issue (verified 2026-07-10, fix pending):** the runtime stage copies
> `dist/ server/ backend/ tools.json` but **not** `cli/ contract/ bin/`, while
> `server/providers.ts` and `server.ts` import from all three at runtime — a freshly built
> image crash-loops with `ERR_MODULE_NOT_FOUND: /app/cli/lib/remote`. Adding
> `COPY --from=builder /app/cli ./cli` (plus the same for `contract` and `bin`) was verified
> to produce a healthy container end-to-end (drill build, `/api/health` 200,
> `masterKeySource: "env"`).

```bash
docker build -t ollamas .
docker run -d --name llm-mission-control \
  -p 127.0.0.1:3000:3000 --env-file .env \
  -v ~/.llm-mission-control:/home/nodeapp/.llm-mission-control \
  ollamas
```

Plain `docker run` skips the compose hardening (read-only rootfs, tmpfs, `no-new-privileges`,
resource limits) — prefer Path C unless you have a reason not to.

## Path C — docker-compose (recommended single-node)

One command, end-to-end:

```bash
./install.sh         # build → up → health poll → (macOS) host-bridge LaunchAgent
# or, equivalent orchestration:
make up              # runs ./start.sh: bridge + container + health
make down            # runs ./stop.sh
```

Manual equivalent:

```bash
docker compose build
docker compose up -d --wait     # --wait blocks on the /api/health healthcheck
```

Notes:
- A `.env` file is **required** (`env_file: .env` in `docker-compose.yml`); `./install.sh`
  bootstraps it (copies `.env.example` when present, and mints a stable `MASTER_KEY_B64` if
  missing). It also feeds `HOST_BRIDGE_TOKEN` and `HOST_TOOLS_DIR` (unset → compose warns and
  defaults to blank).
- **Master key is fail-closed in containers** (`server/db.ts`, M-020): a cloud/Linux boot with
  no `MASTER_KEY_B64`, no keychain key and no persisted `.master_key` **refuses to start**
  instead of minting an ephemeral key that would orphan every encrypted secret on the next
  restart/replica. `install.sh` satisfies this automatically; for Helm/K8s put `MASTER_KEY_B64`
  (base64 of exactly 32 raw bytes, e.g. `head -c 32 /dev/urandom | base64`) in `ollamas-secrets`.
  `GET /api/health` reports the active `masterKeySource` + a remediation hint when weak.
- Port binds to `127.0.0.1:3000` only; data persists via the `~/.llm-mission-control` bind mount.
- Container is hardened: `read_only: true` rootfs, tmpfs `/tmp`, `no-new-privileges`, cpu/mem limits,
  `stop_grace_period: 30s` matching the server's shutdown drain.
- **Optional Postgres** (multi-replica async store): `docker compose --profile postgres up -d`, then
  set `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ollamas` in `.env`. Run the one-shot
  migrator before first Postgres boot:
  ```bash
  docker compose --profile postgres run --rm mission-control tsx server.ts --migrate-only
  ```
- The host-bridge LaunchAgent step runs only when `launchctl` exists — on Linux it is skipped with a
  notice (`install.sh` handles this automatically).

## Path D — Helm / Kubernetes (cluster)

Deploys the **gateway / SaaS API only** (`/mcp`, `/api/saas/*`, `/api/billing/*`, `/metrics`,
`/api/health`, `/api/ready`). Host tools do **not** run in K8s — `MCP_EXPOSE_TIERS` defaults to
`safe` there. Image: `ghcr.io/ecy-coding/ollamas`, published by `.github/workflows/publish.yml` on
`v*` tags.

Helm (preferred — migration Job runs as a pre-install/upgrade hook when `migration.enabled=true`):

```bash
helm install ollamas deploy/helm/ollamas
kubectl get pods -l app=ollamas
kubectl port-forward svc/ollamas 8080:80
```

Raw manifests:

```bash
kubectl apply -f deploy/k8s/ollamas.yaml
```

Production checklist (see [deploy/k8s/README.md](../deploy/k8s/README.md)):
- Replace `ollamas-secrets` values with a real secret manager (Sealed Secrets, ESO).
- `DATABASE_URL` is **mandatory when replicas > 1** (empty → per-pod sqlite, not shared).
- Set `REDIS_URL` for shared rate-limiting across pods.
- Stripe webhooks need a public Ingress to `/api/billing/webhook` + `STRIPE_WEBHOOK_SECRET`.

## Stack update flow

| Path | Update steps |
|---|---|
| Local (npm) | `git pull` → `npm install` → restart (`npm run dev`, or `npm run build` + `npm start`) |
| docker-compose | `git pull` → `docker compose build` → `docker compose up -d --wait` (or just `make up`). On Postgres: run the `--migrate-only` one-shot **first** (command above). |
| Helm | Bump `image.tag` / chart → `helm upgrade ollamas deploy/helm/ollamas` — the migration Job hook completes before pods roll. |
| Raw k8s | `kubectl apply -f deploy/k8s/migration-job.yaml` (wait for completion) → `kubectl apply -f deploy/k8s/ollamas.yaml` (new image tag). |
| CLI binary | `ollamas update --check`, then `ollamas update --manifest https://…/latest.json` — sha256 + (v18) minisign verified, atomic replace. Full details: [cli/UPDATE.md](../cli/UPDATE.md). |

Health after any update: `curl -fs http://localhost:3000/api/health` (or `/api/ready` in K8s), and
`ollamas doctor` (or `npx tsx cli/index.ts doctor` from the repo) for a full stack probe.

## Linux

**Docker/compose is the supported Linux path.** `install.sh` is already Linux-tolerant: the only
macOS-specific step (host-bridge LaunchAgent) is gated on `command -v launchctl` and skipped with a
notice on other hosts. Host tools (`macos_terminal`, …) are unavailable off-macOS by design — the
gateway, MCP `safe`-tier tools, and consumed upstream MCP servers all work.

```bash
# any Linux box with docker + compose plugin:
./install.sh
```

Validated on this repo: `docker compose config -q` exits 0 (compose file is well-formed; expect a
warning if `HOST_TOOLS_DIR` is unset and a note that the top-level `version:` attribute is obsolete).

Executed proof (2026-07-10, Docker Desktop → linux/arm64 container): a clean-dir `./install.sh`
run built the image and — with the Dockerfile `COPY` fix from Path B applied — booted a **healthy**
Linux container (`/api/health` 200, `masterKeySource: "env"`), while the same image without
`MASTER_KEY_B64` exited at boot with the fail-closed master-key error, as designed. Continuous
proof on real ubuntu runners: `.github/workflows/install-smoke.yml` (⚠ added in this change,
runs on future pushes — not yet executed in CI).

A native apt/systemd install path is intentionally not provided: `install.sh` is a docker/npm
bootstrapper, not a system package installer. Use Docker on Linux servers.
