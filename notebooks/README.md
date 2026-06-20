# ollamas — Colab Local-Runtime Dev Notebook

Runs the full ollamas dev+quality loop (lint → build → test → local-model code review) inside a Google Colab notebook connected to the local Docker runtime on your Mac — zero API cost, M4 GPU.

## Run it

1. Start the local runtime:
   ```
   scripts/colab-local-runtime.sh up
   ```
2. Get the connection URL:
   ```
   scripts/colab-local-runtime.sh url
   ```
3. In Colab: **Runtime → Connect to a local runtime** → paste the URL.
4. Open / upload `notebooks/ollamas-colab-dev.ipynb`.
5. **Runtime → Run all**.

## Zero-manual run

Instead of opening Colab and clicking "Run all", you can execute the entire notebook headless from the terminal:

```
./scripts/colab-local-runtime.sh run
```

This starts the runtime if it is not already running, executes `notebooks/ollamas-colab-dev.ipynb` via `jupyter nbconvert` inside the container, then inspects the captured outputs and prints a PASS/FAIL table for each quality gate (lint, build, test, local-model review, /api/health). The command exits nonzero if any gate fails — scriptable and CI-friendly.

The interactive "Run all" steps above remain the alternative when you want to observe cell-by-cell output in the Colab UI.

## Notes

- **Node 24**: the Colab image ships Node 20, but ollamas' store uses `node:sqlite` (`DatabaseSync`, stable in Node 24). The notebook provisions Node 24 (pinned to the host's `v24.16.0`) into `/opt` before installing — without it the store and server-boot tests fail with `No such built-in module: node:sqlite`.
- **Sequential tests** (`--no-file-parallelism`): the test cell runs suites sequentially so the emulated runtime's limited CPU/RAM isn't swamped by parallel server-boot e2e tests.
- **amd64 emulation**: the Docker image runs under Rosetta on Apple Silicon; the first `npm ci` and test runs will be noticeably slower than native — this is expected.
- **`PUPPETEER_SKIP_DOWNLOAD=1`**: skips the Chromium download that would otherwise fail or bloat the install.
- **`MISSION_CONTROL_DATA_DIR=/content/ollamas/.colab-data`**: persists state to the repo mount; without this, all state lives in the container and is lost on restart.
- **Repo mount**: `/content/ollamas` is the read-write mount of your local repo; edits made inside the container are reflected on disk immediately.
- **Local Ollama**: reached via `OLLAMA_HOST=http://host.docker.internal:11434` — the Mac host's Ollama daemon is visible to the container through Docker's host gateway.
