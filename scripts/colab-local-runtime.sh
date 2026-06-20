#!/usr/bin/env bash
# colab-local-runtime.sh — Bring up a Google Colab local runtime for ollamas
#
# WHY: Colab's "Connect to a local runtime" requires a running kernel server
# that speaks the Jupyter server protocol AND exposes jupyter_http_over_ws.
# A bare `jupyter server` does NOT work; that extension is mandatory.
# Docker image us-docker.pkg.dev/colab-images/public/runtime is the cleanest
# path — it embeds everything. The jupyter fallback is for environments where
# Docker is unavailable.
#
# Usage:
#   colab-local-runtime.sh [up] [--jupyter] [--port N]
#   colab-local-runtime.sh stop
#   colab-local-runtime.sh status
#   colab-local-runtime.sh url
#   colab-local-runtime.sh -h|--help

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CONTAINER_NAME="ollamas-colab-runtime"
COLAB_IMAGE="us-docker.pkg.dev/colab-images/public/runtime"
RUNTIME_DIR="${HOME}/.ollamas"
JUPYTER_PID_FILE="${RUNTIME_DIR}/colab-jupyter.pid"
JUPYTER_LOG_FILE="${RUNTIME_DIR}/colab-jupyter.log"
JUPYTER_TOKEN_FILE="${RUNTIME_DIR}/colab-jupyter.token"
JUPYTER_PORT_FILE="${RUNTIME_DIR}/colab-jupyter.port"

# Candidate ports (in priority order). 3100/8080/3000 are known busy.
PORT_CANDIDATES=(3100 9000 8888 8890 8899)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '[colab-rt] %s\n' "$*" >&2; }
die()  { printf '[colab-rt] ERROR: %s\n' "$*" >&2; exit 1; }

# resolve_workspace — find the git root of the ollamas project
resolve_workspace() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # OLLAMAS_WORKSPACE env override takes priority
  if [[ -n "${OLLAMAS_WORKSPACE:-}" ]]; then
    echo "${OLLAMAS_WORKSPACE}"
    return
  fi
  # Walk up from the scripts/ directory to find git root
  git -C "${script_dir}/.." rev-parse --show-toplevel 2>/dev/null || pwd
}

# pick_port [override] — print first free port from candidates, or validate override
pick_port() {
  local override="${1:-}"
  if [[ -n "${override}" ]]; then
    if lsof -ti:"${override}" >/dev/null 2>&1; then
      die "Port ${override} is already in use. Choose a different port with --port."
    fi
    echo "${override}"
    return
  fi
  for p in "${PORT_CANDIDATES[@]}"; do
    if ! lsof -ti:"${p}" >/dev/null 2>&1; then
      echo "${p}"
      return
    fi
  done
  die "All candidate ports (${PORT_CANDIDATES[*]}) are in use. Free a port or specify one with --port N."
}

# wait_http PORT TIMEOUT_SECS — poll until HTTP responds (any code) or timeout
wait_http() {
  local port="${1}" timeout="${2}" elapsed=0
  log "Waiting for http://127.0.0.1:${port}/ to respond (timeout ${timeout}s)..."
  while [[ "${elapsed}" -lt "${timeout}" ]]; do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/" 2>/dev/null || true)
    if [[ "${code}" != "000" && -n "${code}" ]]; then
      log "Runtime is responding (HTTP ${code})."
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

# docker_token PORT — extract jupyter token from container logs
docker_token() {
  local port="${1}"
  # The Colab runtime image prints a line like:
  #   http://127.0.0.1:8080/?token=<hex>
  local token
  token=$(docker logs "${CONTAINER_NAME}" 2>&1 \
    | grep -oE 'token=[a-f0-9]+' \
    | head -1 \
    | sed 's/token=//')
  echo "${token}"
}

# colab_url PORT TOKEN — print the URL to paste into Colab's "local runtime" dialog
colab_url() {
  local port="${1}" token="${2}"
  if [[ -n "${token}" ]]; then
    echo "http://localhost:${port}/?token=${token}"
  else
    echo "http://localhost:${port}/"
  fi
}

# print_guide PORT TOKEN — end-of-up instructions
print_guide() {
  local port="${1}" token="${2}"
  local url
  url=$(colab_url "${port}" "${token}")
  printf '\n'
  printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  printf '  Colab local runtime is READY\n'
  printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  printf '  URL to paste: %s\n' "${url}"
  printf '\n'
  printf '  Steps:\n'
  printf '    1. In your Colab notebook: Runtime → Connect ▾ → Connect to a local runtime\n'
  printf '    2. Paste the URL above into the dialog and click Connect\n'
  printf '    3. Workspace is mounted at  /content/ollamas\n'
  printf '    4. Ollama (host) available as  OLLAMA_HOST=http://host.docker.internal:11434\n'
  printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
}

# ensure_runtime_dir — create ~/.ollamas if needed
ensure_runtime_dir() {
  mkdir -p "${RUNTIME_DIR}"
}

# ---------------------------------------------------------------------------
# Path A — Docker (default)
# ---------------------------------------------------------------------------
cmd_up_docker() {
  local port="${1}"
  local workspace
  workspace=$(resolve_workspace)
  log "Workspace: ${workspace}"
  log "Port: ${port}"

  # Check existing container state
  local state
  state=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)

  if [[ "${state}" == "running" ]]; then
    log "Container '${CONTAINER_NAME}' is already running — reusing."
  elif [[ "${state}" == "exited" || "${state}" == "stopped" || "${state}" == "created" ]]; then
    log "Container '${CONTAINER_NAME}' exists but is stopped — starting it."
    docker start "${CONTAINER_NAME}" >/dev/null
  else
    log "Starting new container '${CONTAINER_NAME}'..."
    docker run -d \
      --name "${CONTAINER_NAME}" \
      -p "127.0.0.1:${port}:8080" \
      -v "${workspace}:/content/ollamas" \
      -e "OLLAMA_HOST=http://host.docker.internal:11434" \
      "${COLAB_IMAGE}"
  fi

  # Wait for runtime to respond
  if ! wait_http "${port}" 60; then
    log "Runtime did not respond within 60s. Check logs: docker logs ${CONTAINER_NAME}"
    log "Printing last 20 log lines:"
    docker logs --tail 20 "${CONTAINER_NAME}" 2>&1 >&2 || true
    die "Runtime startup timed out."
  fi

  # Extract token
  local token
  token=$(docker_token "${port}")
  if [[ -z "${token}" ]]; then
    log "Warning: could not extract token from container logs. Runtime may not require one."
  fi

  print_guide "${port}" "${token}"
}

# ---------------------------------------------------------------------------
# Path B — Jupyter fallback
# WHY: jupyter_http_over_ws 0.0.8 (last release, unmaintained) uses
# `from distutils import version`, but distutils was removed in Python ≥3.12.
# The extension is unimportable on modern Python, so we must verify import
# BEFORE launching — otherwise the server starts (HTTP 200) but Colab cannot
# connect, silently. Only print READY when the extension is confirmed loaded.
# ---------------------------------------------------------------------------
cmd_up_jupyter() {
  local port="${1}"
  ensure_runtime_dir

  log "Installing/upgrading jupyter_http_over_ws (required for Colab)..."
  python3 -m pip install --quiet --upgrade jupyter_http_over_ws 2>/dev/null \
    || die "pip install jupyter_http_over_ws failed. Check your Python environment."

  # Attempt a distutils shim for Python ≥3.12: setuptools<81 still vendors distutils.
  # WHY: jupyter_http_over_ws 0.0.8 imports distutils at load time; without this
  # the extension is unimportable on Python ≥3.12 (distutils removed in 3.12).
  log "Attempting setuptools distutils shim (needed on Python ≥3.12)..."
  python3 -m pip install --quiet 'setuptools<81' 2>/dev/null || true

  # Verify the extension is actually importable BEFORE launching anything.
  # WHY: `jupyter server extension enable` does NOT validate the import; it only
  # writes config. A failed import means the server will start but Colab can't
  # connect — a silent false-READY that wastes time and misleads the user.
  if ! python3 -c 'import jupyter_http_over_ws' 2>/dev/null; then
    die "jupyter_http_over_ws is unmaintained and incompatible with Python ≥3.12 (distutils removed); even with a setuptools shim it cannot be imported on this Python. Use the Docker path instead (run without --jupyter)."
  fi
  log "jupyter_http_over_ws import OK."

  log "Enabling jupyter_http_over_ws server extension..."
  jupyter server extension enable --py jupyter_http_over_ws --user \
    || die "Failed to enable jupyter_http_over_ws extension."

  # Stop any stale instance first
  _kill_jupyter_pid 2>/dev/null || true

  # Generate a cryptographically random token
  local token
  token=$(python3 -c 'import secrets; print(secrets.token_hex(24))')

  # Persist token and port for `url`/`status` subcommands
  echo "${token}" > "${JUPYTER_TOKEN_FILE}"
  echo "${port}"  > "${JUPYTER_PORT_FILE}"

  log "Launching jupyter server on port ${port}..."
  # shellcheck disable=SC2094
  nohup jupyter server \
    --ServerApp.allow_origin='https://colab.research.google.com' \
    --ServerApp.allow_origin_pat='https://.*\.googleusercontent\.com' \
    --ServerApp.port="${port}" \
    --ServerApp.port_retries=0 \
    --no-browser \
    --IdentityProvider.token="${token}" \
    >> "${JUPYTER_LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${JUPYTER_PID_FILE}"
  log "Jupyter server started (PID ${pid}). Log: ${JUPYTER_LOG_FILE}"

  # Wait for it to bind
  if ! wait_http "${port}" 30; then
    log "Jupyter did not respond within 30s. Tail of log:"
    tail -20 "${JUPYTER_LOG_FILE}" >&2 || true
    _kill_jupyter_pid 2>/dev/null || true
    die "Jupyter server startup timed out."
  fi

  # Verify the extension actually registered in the running server.
  # WHY: HTTP 200 only means the server is up; Colab also needs the
  # /http_over_websocket handler. Grep the log for the extension's registration
  # message as evidence it loaded in the live process.
  if ! grep -qiE 'jupyter_http_over_ws|http_over_websocket' "${JUPYTER_LOG_FILE}" 2>/dev/null; then
    log "Extension load NOT confirmed in server log. Tail of log:"
    tail -20 "${JUPYTER_LOG_FILE}" >&2 || true
    _kill_jupyter_pid 2>/dev/null || true
    die "jupyter_http_over_ws did not register in the running server. Use the Docker path instead (run without --jupyter)."
  fi
  log "jupyter_http_over_ws extension confirmed loaded in server."

  print_guide "${port}" "${token}"
}

# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------
_kill_jupyter_pid() {
  if [[ -f "${JUPYTER_PID_FILE}" ]]; then
    local pid
    pid=$(cat "${JUPYTER_PID_FILE}")
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" && log "Jupyter server (PID ${pid}) stopped."
    else
      log "Jupyter PID ${pid} is not running (stale pidfile)."
    fi
    rm -f "${JUPYTER_PID_FILE}" "${JUPYTER_TOKEN_FILE}" "${JUPYTER_PORT_FILE}"
  fi
}

cmd_stop() {
  local stopped=0

  # Stop Docker container
  local state
  state=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
  if [[ -n "${state}" ]]; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 && log "Docker container '${CONTAINER_NAME}' removed." && stopped=$((stopped + 1))
  else
    log "No Docker container '${CONTAINER_NAME}' found."
  fi

  # Stop Jupyter
  if [[ -f "${JUPYTER_PID_FILE}" ]]; then
    _kill_jupyter_pid
    stopped=$((stopped + 1))
  else
    log "No Jupyter PID file found (${JUPYTER_PID_FILE})."
  fi

  if [[ "${stopped}" -eq 0 ]]; then
    log "Nothing was running."
  else
    log "Done. Stopped ${stopped} runtime(s)."
  fi
}

# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------
cmd_status() {
  local any=0

  # Docker
  local state
  state=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
  if [[ -n "${state}" ]]; then
    any=1
    local port_line
    port_line=$(docker port "${CONTAINER_NAME}" 2>/dev/null | grep '8080/tcp' | head -1 || true)
    local host_port
    host_port=$(echo "${port_line}" | grep -oE '[0-9]+$' || true)
    log "Docker container '${CONTAINER_NAME}': ${state}"
    if [[ -n "${host_port}" && "${state}" == "running" ]]; then
      local token
      token=$(docker_token "${host_port}")
      local url
      url=$(colab_url "${host_port}" "${token}")
      log "  Connect URL: ${url}"
    fi
  fi

  # Jupyter
  if [[ -f "${JUPYTER_PID_FILE}" ]]; then
    any=1
    local pid
    pid=$(cat "${JUPYTER_PID_FILE}")
    if kill -0 "${pid}" 2>/dev/null; then
      local jport="" jtoken=""
      [[ -f "${JUPYTER_PORT_FILE}" ]]  && jport=$(cat "${JUPYTER_PORT_FILE}")
      [[ -f "${JUPYTER_TOKEN_FILE}" ]] && jtoken=$(cat "${JUPYTER_TOKEN_FILE}")
      log "Jupyter server: RUNNING (PID ${pid})"
      if [[ -n "${jport}" ]]; then
        local url
        url=$(colab_url "${jport}" "${jtoken}")
        log "  Connect URL: ${url}"
      fi
    else
      log "Jupyter server: STOPPED (stale PID file for PID ${pid})"
    fi
  fi

  if [[ "${any}" -eq 0 ]]; then
    log "No runtimes found (Docker container absent, no Jupyter PID file)."
    log "Run 'colab-local-runtime.sh up' to start."
  fi
}

# ---------------------------------------------------------------------------
# url
# ---------------------------------------------------------------------------
cmd_url() {
  # Docker takes priority
  local state
  state=$(docker inspect --format '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)
  if [[ "${state}" == "running" ]]; then
    local port_line host_port
    port_line=$(docker port "${CONTAINER_NAME}" 2>/dev/null | grep '8080/tcp' | head -1 || true)
    host_port=$(echo "${port_line}" | grep -oE '[0-9]+$' || true)
    if [[ -n "${host_port}" ]]; then
      local token
      token=$(docker_token "${host_port}")
      colab_url "${host_port}" "${token}"
      return
    fi
  fi

  # Jupyter fallback
  if [[ -f "${JUPYTER_PID_FILE}" && -f "${JUPYTER_TOKEN_FILE}" && -f "${JUPYTER_PORT_FILE}" ]]; then
    local pid
    pid=$(cat "${JUPYTER_PID_FILE}")
    if kill -0 "${pid}" 2>/dev/null; then
      local jport jtoken
      jport=$(cat "${JUPYTER_PORT_FILE}")
      jtoken=$(cat "${JUPYTER_TOKEN_FILE}")
      colab_url "${jport}" "${jtoken}"
      return
    fi
  fi

  die "No runtime is running. Start one with 'colab-local-runtime.sh up'."
}

# ---------------------------------------------------------------------------
# help
# ---------------------------------------------------------------------------
cmd_help() {
  cat <<'EOF'
colab-local-runtime.sh — Google Colab local runtime manager for ollamas

USAGE:
  colab-local-runtime.sh [up] [--jupyter] [--port N]
  colab-local-runtime.sh stop
  colab-local-runtime.sh status
  colab-local-runtime.sh url
  colab-local-runtime.sh -h|--help

SUBCOMMANDS:
  up       Start the runtime (default if no subcommand given).
           Default method: Docker (us-docker.pkg.dev/colab-images/public/runtime).
           Idempotent: reuses a running container, restarts a stopped one.

  stop     Stop Docker container + Jupyter server (if running).

  status   Show current state of both Docker and Jupyter runtimes.

  url      Print the Colab connect URL for the running runtime.

  -h/--help  Show this help.

FLAGS:
  --jupyter   Force the Jupyter fallback path (installs jupyter_http_over_ws,
              launches jupyter server). Use when Docker is unavailable.
              Requires Python <3.12: jupyter_http_over_ws needs distutils
              (removed in Python 3.12). On Python ≥3.12 use the Docker path.

  --port N    Override automatic port selection. Errors if port is in use.
              Default port candidates (in order): 3100 9000 8888 8890 8899.

ENVIRONMENT:
  OLLAMAS_WORKSPACE   Override the git-root detection for the workspace mount.
                      Default: git root of this script's parent directory.

EXAMPLES:
  colab-local-runtime.sh up                # Docker, auto port
  colab-local-runtime.sh up --port 9000   # Docker, specific port
  colab-local-runtime.sh up --jupyter     # Jupyter fallback, auto port
  colab-local-runtime.sh status
  colab-local-runtime.sh url
  colab-local-runtime.sh stop

HOW TO CONNECT IN COLAB:
  1. Run this script: ./scripts/colab-local-runtime.sh up
  2. Copy the "Connect URL" printed at the end.
  3. In your Colab notebook: Runtime → Connect ▾ → Connect to a local runtime
  4. Paste the URL and click Connect.

WORKSPACE & OLLAMA:
  Docker path mounts <git-root> → /content/ollamas inside the container.
  OLLAMA_HOST is set to http://host.docker.internal:11434 (host Ollama).
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
SUBCOMMAND="up"
USE_JUPYTER=0
PORT_OVERRIDE=""

# First non-flag arg becomes the subcommand
_positional_seen=0

for arg in "$@"; do
  case "${arg}" in
    up|stop|status|url)
      SUBCOMMAND="${arg}"
      _positional_seen=1
      ;;
    -h|--help)
      SUBCOMMAND="help"
      ;;
    --jupyter)
      USE_JUPYTER=1
      ;;
    --port)
      # handled via shift below — need index-based parsing
      ;;
    *)
      # Could be value for --port; handled below
      ;;
  esac
done

# Re-parse with index awareness for --port N
ARGS=("$@")
for i in "${!ARGS[@]}"; do
  if [[ "${ARGS[${i}]}" == "--port" ]]; then
    next=$((i + 1))
    if [[ "${next}" -ge "${#ARGS[@]}" ]]; then
      die "--port requires a numeric argument."
    fi
    PORT_OVERRIDE="${ARGS[${next}]}"
    # Basic numeric check
    case "${PORT_OVERRIDE}" in
      ''|*[!0-9]*) die "--port value must be a positive integer, got: '${PORT_OVERRIDE}'" ;;
    esac
  fi
done

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "${SUBCOMMAND}" in
  help)
    cmd_help
    ;;
  stop)
    cmd_stop
    ;;
  status)
    cmd_status
    ;;
  url)
    cmd_url
    ;;
  up)
    PORT=$(pick_port "${PORT_OVERRIDE}")
    if [[ "${USE_JUPYTER}" -eq 1 ]]; then
      cmd_up_jupyter "${PORT}"
    else
      cmd_up_docker "${PORT}"
    fi
    ;;
  *)
    die "Unknown subcommand: '${SUBCOMMAND}'. Run with -h for help."
    ;;
esac
