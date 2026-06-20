# colab-local-runtime.sh — Usage Guide

Bring up a Google Colab local runtime on your M4 Mac, wired for the ollamas project.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Docker** (running) | Path A (default). Pulls `us-docker.pkg.dev/colab-images/public/runtime`. |
| **Python <3.12 + pip** | Path B (`--jupyter`). `jupyter_http_over_ws` is auto-installed. Requires Python <3.12 — `jupyter_http_over_ws` needs `distutils` which was removed in Python 3.12. On Python ≥3.12 use the Docker path (default). |
| **lsof, curl** | Port probing and startup health-check. Pre-installed on macOS. |
| **git** | Workspace auto-detection via `git rev-parse --show-toplevel`. |
| **Ollama on host :11434** | `OLLAMA_HOST` is pre-configured for both paths. |

---

## Quickstart

```bash
# Default — Docker, auto port
./scripts/colab-local-runtime.sh up

# Jupyter fallback (no Docker needed)
./scripts/colab-local-runtime.sh up --jupyter

# Force a specific port
./scripts/colab-local-runtime.sh up --port 9000
```

After `up` completes, copy the **Connect URL** printed at the end.

---

## How to paste into Colab

1. Open your Colab notebook.
2. Click **Runtime → Connect ▾ → Connect to a local runtime**.
3. Paste the URL (e.g. `http://localhost:9000/?token=abc123...`).
4. Click **Connect**.

Your notebook now runs on your M4. The ollamas workspace is mounted at `/content/ollamas`
and `OLLAMA_HOST=http://host.docker.internal:11434` points at the host Ollama daemon.

---

## All subcommands

```
up       Start the runtime (default). Idempotent.
run      Execute the dev-loop notebook headless; prints PASS/FAIL per gate.
         Starts the runtime first if needed. Exits nonzero on gate failure.
stop     Stop Docker container and/or Jupyter server.
status   Show running state + connect URL for all runtimes.
url      Print just the connect URL (useful for scripts/clipboard).
-h/--help  Full help text.
```

---

## Port selection

Ports tried in order: `3100 → 9000 → 8888 → 8890 → 8899`.
The first port with no listener wins. `3100/8080/3000` are skipped early because
they are known busy in this environment.

Override: `--port 9001` (errors clearly if that port is also in use).

---

## Troubleshooting

### Docker image pull is slow

The Colab runtime image is ~3 GB. Run once on a good connection; subsequent `up`
calls reuse the cached image.

### Container starts but Colab won't connect

- Run `docker logs ollamas-colab-runtime` to see the printed token/URL.
- Confirm the port matches what the script printed (`status` shows it).
- Ensure your browser isn't blocking `http://localhost:...` (non-HTTPS is required by the Colab dialog).

### `--jupyter` path: Python ≥3.12 — distutils removed

`jupyter_http_over_ws` 0.0.8 (last release, unmaintained) imports `distutils` at
load time. `distutils` was removed from the standard library in Python 3.12.
Even with a `setuptools<81` shim the import may fail on some setups.

The script checks importability **before launching the server** and exits with a
clear message rather than printing a false READY. Use the Docker path instead:

```bash
./scripts/colab-local-runtime.sh up          # Docker (default) — works on any Python
```

### `--jupyter` path: extension not found

If `jupyter server extension enable` fails, check which Python environment is active:

```bash
which python3 && python3 -m jupyter --version
```

The extension must be installed in the same environment that `jupyter` resolves to.

### Port already in use

```
[colab-rt] ERROR: Port 9000 is already in use.
```

Either `--port N` to a free port, or `./scripts/colab-local-runtime.sh stop` to
clean up a previous runtime.

### Reset everything

```bash
./scripts/colab-local-runtime.sh stop
docker rmi us-docker.pkg.dev/colab-images/public/runtime   # optional: purge image
```

---

## Environment override

```bash
OLLAMAS_WORKSPACE=/path/to/my/checkout ./scripts/colab-local-runtime.sh up
```

Useful when running the script from outside the git tree.

## Apple Silicon (M4) note

The Colab runtime image `us-docker.pkg.dev/colab-images/public/runtime` is **amd64-only** — on
Apple Silicon it runs under emulation. The script passes `--platform linux/amd64` so Docker does
not print a platform-mismatch warning; the first kernel call is slightly slower (expected, inherent
— there is no arm64 image).

## Port note

Do NOT hardcode `--port 3100` if a jupyter/server already holds it (the bare `jupyter server` command
binds 3100). The script auto-picks the first free port (3100 → 9000 → 8888 …); use `up` / `url`.
