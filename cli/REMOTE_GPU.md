# Remote GPU backend — use a Windows PC's GPU for ollamas inference

The Mac runs the **control plane** (gateway, CLI, agents, UI); a second machine
with a real GPU (a Windows PC) runs **ollama** and does the heavy inference. The
gateway points `OLLAMA_HOST` at the remote daemon, so every model call lands on
the remote GPU. Sibling of `REMOTE_EXPOSURE.md` (that doc is the reverse — exposing
the gateway to a phone; this one is pulling a remote GPU *into* the gateway).

```
┌─ Mac (control) ──────────┐   Tailscale mesh (WireGuard, $0)   ┌─ Windows (GPU worker) ─┐
│ ollamas gateway :3000    │ ── OLLAMA_HOST=http://win:11434 ─▶ │ ollama serve :11434     │
│ CLI / agents / UI        │                                    │ 0.0.0.0 bind, GPU all  │
│ npm start (reads .env)   │ ◀─ Syncthing (project folder) ───▶ │ Syncthing               │
│ ssh win                  │ ── OpenSSH ──────────────────────▶ │ OpenSSH server          │
└──────────────────────────┘                                    └────────────────────────┘
```

Why this beats the Colab T4 offload: an owned, persistent, faster GPU; no
ephemeral `trycloudflare` URL that churns on every restart; no Chrome-driven
notebook to babysit.

## TL;DR

```sh
# Windows (operator): install Tailscale + Ollama; set system env OLLAMA_HOST=0.0.0.0:11434;
#   ollama pull qwen3:8b ; allow TCP 11434 on the Tailscale interface.
# Mac:
echo 'OLLAMA_HOST="http://<win-host>.<tailnet>.ts.net:11434"' >> .env
npm start                  # node path — reads .env (NOT docker; see gotcha)
ollamas remote check       # → PASS when mode=live and qwen3:8b is served by the remote
```

## Connection layer — Tailscale (recommended, even LAN-only)

Tailscale is already this project's chosen remote tool (see `REMOTE_EXPOSURE.md`).
Use it even if both machines are on the same Wi-Fi:

| | Tailscale MagicDNS | raw LAN IP (`192.168.x`) |
|---|---|---|
| Address stability | **stable hostname** — survives reboots / DHCP lease changes | breaks when the IP changes → re-wire `OLLAMA_HOST` every time |
| Reach | home + anywhere (free) | same Wi-Fi only |
| Encryption | WireGuard end-to-end | none on the wire |
| Setup | one-time account login on both | zero install |
| Cost | $0 (personal: 100 devices) | $0 |

1. **Windows:** download from tailscale.com → install → sign in (Google/Microsoft SSO).
2. **Mac:** `brew install --cask tailscale` (or App Store) → `tailscale up` → **same account**.
3. MagicDNS is on by default. Get the Windows hostname: `tailscale status`.

**LAN-only fallback:** skip Tailscale, use the Windows LAN IP. Find it on Windows
with `ipconfig`; set `OLLAMA_HOST="http://192.168.x.y:11434"`. Re-set it whenever
the IP changes — that recurring re-wire is exactly what Tailscale removes.

## Windows = GPU inference worker (operator steps)

Claude Code runs on the Mac and cannot touch Windows — do these on the PC.

1. **Detect the GPU first** (it determines model size). PowerShell:
   ```powershell
   wmic path win32_VideoController get name      # any GPU
   nvidia-smi                                    # if NVIDIA: VRAM + driver
   ```
   Rough model fit by VRAM: 8 GB → `qwen3:8b`, 12–16 GB → `qwen3:14b`,
   24 GB → `qwen3:32b`. (CPU-only/integrated works but is slow.)
2. **Install Ollama** (ollama.com/download/windows). NVIDIA gets CUDA automatically.
3. **Bind to all interfaces** — by default ollama listens on `127.0.0.1`, unreachable
   over the tailnet/LAN. Add a **system** environment variable
   `OLLAMA_HOST=0.0.0.0:11434`, then restart Ollama (quit from the tray + relaunch,
   or `Restart-Service` if installed as a service).
4. **Pull the model** — `ollama pull qwen3:8b` is **mandatory**: the gateway's
   selftest gates (`server.ts /api/selftest` G2/G3/G8) hardcode `qwen3:8b`; without
   it the gateway falls back to demo. Pull any larger model your VRAM allows too.
5. **Firewall** — allow inbound TCP 11434, scoped to the Tailscale (or LAN) interface,
   not the public internet.
6. **Verify locally (Windows):**
   ```powershell
   curl http://localhost:11434/api/version
   curl http://localhost:11434/api/ps        # the model should show 100% GPU
   ```

## Mac = control plane (wire + launch)

1. Point the gateway at the remote daemon in `.env`:
   ```sh
   OLLAMA_HOST="http://<win-host>.<tailnet>.ts.net:11434"   # MagicDNS
   # LAN fallback: OLLAMA_HOST="http://192.168.x.y:11434"
   ```
2. **Launch the node path, not Docker:**
   ```sh
   npm start                # or: PORT=8090 npm run dev
   ```
   `server.ts` loads `.env` via `dotenv/config` (line 1), so the var is picked up.
3. Confirm the binding:
   ```sh
   ollamas remote check          # human table
   ollamas remote check --json   # machine-readable; exit 0=PASS 1=FAIL
   ```

### ⚠️ Gotchas (verified)

- **Do NOT use the Docker path for a remote backend.** `docker-compose.yml` hardcodes
  `OLLAMA_HOST=http://host.docker.internal:11434` (line 17), which overrides `.env`
  and always points at the Mac-local daemon. Use the node path (`npm start`). If you
  must use Docker, add a `docker-compose.override.yml` that sets the remote
  `OLLAMA_HOST`, or edit line 17.
- **Model parity** — the remote must have `qwen3:8b` pulled (selftest gates). Verify
  with `ollamas remote check` (it flags a missing required model).
- **`detectMode` caches at boot** — `CURRENT_MODE` is set once on startup
  (`server.ts`). If you start the Windows daemon *after* the gateway, restart the
  gateway so it re-probes.
- **Binding proof** — `GET /api/models/ollama-local` returns *only the remote's*
  models. The Mac-local daemon typically has ~17 models; a short/different list is
  how you know inference is coming from the Windows GPU. `ollamas remote check`
  surfaces this count.

## File sync — Syncthing ($0 P2P) or git

Edit on either machine and keep the project folder in sync.

- **Syncthing (live, recommended):** install on both (Mac `brew install syncthing`,
  Windows installer). Open the web UI on `:8384`, pair the two devices, share the
  project folder. **A `.stignore` is mandatory** — without it Syncthing will try to
  mirror `node_modules`, `.git`, `dist`, build artifacts and thrash. Copy
  `.stignore.example` (repo root) to `.stignore` inside the shared folder on both
  machines.
- **git (simpler, async):** just `git fetch`/`push` between the two checkouts. No
  live mirroring, but zero extra software and no ignore-file footguns.

## Remote shell — OpenSSH

1. **Windows:** Settings → System → Optional features → add **OpenSSH Server**, then:
   ```powershell
   Start-Service sshd
   Set-Service  sshd -StartupType Automatic
   ```
2. **Mac:** `ssh-copy-id <user>@<win-host>` (key auth), then `ssh <win-host>`.
   Over the tailnet the session is WireGuard-encrypted.
   Example: `ssh <win-host> "ollama list"` should print the remote's models.

## End-to-end verification

| Check | Command | Expect |
|---|---|---|
| Reachable | `curl http://<win-host>:11434/api/version` | `200` + version JSON |
| Bound | `ollamas remote check` | `mode=live`, qwen3:8b ✓, **PASS** |
| GPU placement | (Windows) `ollama ps` | model `100% GPU` |
| Real inference | `ollamas agent run "..."` or `POST /api/generate` | `source: ollama_local`, faster than Mac Metal |
| File sync | edit on Mac → appears on Windows | seconds (Syncthing) or `git pull` |
| Shell | `ssh <win-host> "ollama list"` | remote model list |
