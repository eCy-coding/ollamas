# Reaching the ollamas gateway from your iPhone (v6)

The gateway listens on `localhost:3000` — unreachable from a phone. Expose it
**securely** so the Shortcuts pack (`ollamas shortcuts build`) and the POSIX
bridge can call it from anywhere.

## TL;DR

```sh
# on the Mac running the gateway:
tailscale serve --bg 3000                      # private to your tailnet (recommended)
# → https://<your-mac>.<tailnet>.ts.net

# build phone shortcuts pointed at that URL:
ollamas shortcuts build --url https://<your-mac>.<tailnet>.ts.net
```

The gateway's **API key stays the real authentication** — Tailscale only gives
reachability + TLS. Set `OLLAMAS_API_KEY` and send it as `Authorization: Bearer`.

## Why Tailscale Serve (not Funnel, ngrok, raw LAN)

| Option | Exposure | TLS | Verdict |
|--------|----------|-----|---------|
| `tailscale serve` | tailnet-only (your devices) | valid cert, auto | **default** — phone is on the tailnet, nobody else reaches it |
| `tailscale funnel` | **public internet** | valid cert, auto | opt-in only; the gateway runs real host tools — public exposure is a serious boundary. Use a strong key + tier allowlist, or don't. |
| ngrok / cloudflared | public, 3rd-party relay | yes | extra trust + churn; Serve is simpler and stays on your own mesh |
| raw LAN IP (`192.168.x`) | same Wi‑Fi only | **none** — self-signed warnings on iOS | avoid; no TLS, breaks off home Wi‑Fi |

`tailscale serve` terminates TLS with a real cert, so iOS shows no certificate
warnings and the `Bearer` header travels encrypted.

## Auth — the key is the gate

1. Issue a tenant key (admin): `ollamas saas key new --tenant <id>` (printed once).
2. On the phone, the shortcut sends `Authorization: Bearer <key>`.
3. `shortcuts build` leaves `__OLLAMAS_API_KEY__` as a placeholder by default —
   paste your key into each shortcut by hand, or run `--embed-key` (TTY-confirmed,
   writes plaintext 0600 files; never on a shared machine).

Keep the gateway's tier allowlist tight for any internet-facing setup
(`MCP_EXPOSE_TIERS=safe`), so a leaked key can't reach host/privileged tools.

## iOS recipes — always `stream:false`

**Shortcuts cannot read Server-Sent Events.** Every recipe the pack emits uses
non-streaming requests; if you hand-build one, do the same.

Chat — `POST {gateway}/api/generate`
```json
{ "provider": "ollama-local", "model": "qwen3:8b", "stream": false,
  "messages": [ { "role": "user", "content": "<Ask for Input>" } ] }
```

Status — `GET {gateway}/api/health` (header `Authorization: Bearer <key>`).

MCP tool — `POST {gateway}/mcp` (JSON-RPC, no `initialize` handshake — `/mcp` is
stateless):
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "<tool>", "arguments": {} } }
```
The reply is SSE-framed even here; in Shortcuts, read it as text and strip the
`data: ` prefix. (`--stream` progress is a terminal-only feature.)

## Install the pack

macOS re-signs locally (Apple `.shortcut` files are signed — an unsigned file
can't import on iOS):
```sh
ollamas shortcuts build --url https://<mac>.<tailnet>.ts.net --import
```
Then sync each shortcut to the iPhone via iCloud. On a Mac-less phone, open each
`~/.ollamas/shortcuts/<recipe>.card.md` and build it by hand.
