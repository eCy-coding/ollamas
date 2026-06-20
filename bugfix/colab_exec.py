#!/usr/bin/env python3
"""vC2-bridge — run `google.colab.ai.generate_text` on the connected Colab local
runtime and print the result. Lets the (TS) bug-fix triage use the live Colab
kernel as a key-less Gemini engine.

Discovers the active python3 kernel via the Jupyter REST API, then sends one
`execute_request` over the kernel websocket. The prompt/model/system are embedded
into the kernel code as JSON literals (never f-string concatenation) so a prompt
cannot inject Python. Prompt is read from stdin.

Env:
  COLAB_BASE   base URL of the Jupyter server (default http://localhost:9100)
  COLAB_TOKEN  Jupyter auth token (required)
Args:
  --model   default "google/gemini-3.5-flash"
  --system  optional system preamble (prepended to the prompt)
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import uuid

from websocket import create_connection


def _http_get(url: str, token: str) -> bytes:
    # Reject non-HTTP schemes so a misconfigured COLAB_BASE can't turn this into a
    # file:// (or other-scheme) read via urllib.
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"refusing non-http(s) URL: {url[:40]}")
    req = urllib.request.Request(url, headers={"Authorization": f"token {token}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()


def discover_kernel(base: str, token: str) -> str:
    kernels = json.loads(_http_get(f"{base}/api/kernels", token))
    for k in kernels:
        if k.get("name") == "python3":
            return k["id"]
    if kernels:
        return kernels[0]["id"]
    raise RuntimeError("no running kernel at " + base)


def run_generate(base: str, token: str, kernel_id: str, prompt: str, model: str, system: str | None) -> str:
    full_prompt = (system + "\n\n" + prompt) if system else prompt
    # JSON literals are valid Python string literals → safe embedding (no injection).
    code = (
        "from google.colab import ai\n"
        f"print(ai.generate_text({json.dumps(full_prompt)}, model_name={json.dumps(model)}))"
    )
    ws_url = base.replace("http", "ws", 1) + f"/api/kernels/{kernel_id}/channels?token={token}"
    msg_id = uuid.uuid4().hex
    req = {
        "header": {"msg_id": msg_id, "username": "bugfix", "session": uuid.uuid4().hex,
                   "msg_type": "execute_request", "version": "5.3"},
        "parent_header": {}, "metadata": {},
        "content": {"code": code, "silent": False, "store_history": False,
                    "user_expressions": {}, "allow_stdin": False, "stop_on_error": True},
        "channel": "shell",
    }
    ws = create_connection(ws_url, timeout=30)
    try:
        ws.send(json.dumps(req))
        out: list[str] = []
        err: str | None = None
        deadline = time.time() + 120
        while time.time() < deadline:
            msg = json.loads(ws.recv())
            if msg.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            mt, content = msg.get("msg_type"), msg.get("content", {})
            if mt == "stream":
                out.append(content.get("text", ""))
            elif mt in ("execute_result", "display_data"):
                out.append(content.get("data", {}).get("text/plain", ""))
            elif mt == "error":
                err = content.get("ename", "Error") + ": " + content.get("evalue", "")
            elif mt == "status" and content.get("execution_state") == "idle":
                break
        if err:
            raise RuntimeError(err)
        return "".join(out).strip()
    finally:
        ws.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="google/gemini-3.5-flash")
    ap.add_argument("--system", default=None)
    args = ap.parse_args()

    token = os.environ.get("COLAB_TOKEN")
    if not token:
        print("COLAB_TOKEN env is required", file=sys.stderr)
        return 2
    base = os.environ.get("COLAB_BASE", "http://localhost:9100").rstrip("/")
    prompt = sys.stdin.read()
    if not prompt.strip():
        print("empty prompt on stdin", file=sys.stderr)
        return 2

    try:
        kid = discover_kernel(base, token)
        sys.stdout.write(run_generate(base, token, kid, prompt, args.model, args.system))
        return 0
    except Exception as e:  # noqa: BLE001 — surface any bridge failure to the caller
        print(f"colab_exec failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
