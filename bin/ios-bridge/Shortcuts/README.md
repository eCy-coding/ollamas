# ollamas — Apple Shortcuts Recipe (iOS consumer)

iOS is a **consumer-only** surface. A Shortcut talks to the ollamas **app
gateway** over HTTPS (`/api/generate`, `/api/health`, `/mcp`) — never to the
host terminal bridge (port 7345 is `127.0.0.1`-only and host-exec; unreachable
and out of scope for a device).

> A `.shortcut` file is a **signed binary plist** — it cannot be hand-authored
> as text or committed meaningfully. This is the manual build recipe instead.
> The Swift CLI (`ollamas-ios`) is the testable reference implementation of the
> same HTTP contract.

## Prerequisites
- Gateway reachable from the phone: `http://<mac-lan-ip>:3000` on the same LAN,
  or a tunnel (ngrok/reverse proxy) for remote. App binds `0.0.0.0:3000`.
- API key only if the gateway runs `SAAS_ENFORCE=1`. Dev (`SAAS_ENFORCE=0`)
  needs no auth.

## Recipe A — "Ask ollamas" (text generation)
Shortcuts app → new Shortcut → add these actions:

1. **Ask for Input** — Prompt: "Ask ollamas", Input type: Text → variable `Prompt`.
2. **Text** — store your gateway base, e.g. `http://192.168.1.20:3000` → `Gateway`.
3. **Get Contents of URL**
   - URL: `[Gateway]/api/generate`
   - Method: **POST**
   - Headers:
     - `Content-Type` = `application/json`
     - `Authorization` = `Bearer olm_…`   *(only in SaaS mode; omit otherwise)*
   - Request Body: **JSON**
     ```json
     {
       "messages": [{ "role": "user", "content": "[Prompt]" }],
       "stream": false
     }
     ```
     (`[Prompt]` = the variable from step 1.)
4. **Get Dictionary Value** — Key: `text` → from the previous result.
5. **Show Result** (or **Speak Text**).

## Recipe B — "ollamas health"
1. **Get Contents of URL** — `GET [Gateway]/api/health` (no auth needed).
2. **Show Result**.

## Recipe C — MCP tool call (advanced)
POST `[Gateway]/mcp` with JSON-RPC 2.0:
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```
Read `result.tools[]`. For a call use `method: "tools/call"`,
`params: { "name": "<tool>", "arguments": { … } }`. Bearer required in SaaS mode.

## Secret handling
Do **not** paste the API key into a shared Shortcut. Prefer a per-device Text
action or, in a future native build, the iOS Keychain (tracked for ROADMAP v9).

## Parity with the CLI
The body shapes above are exactly what `OllamasClient.generateBody` /
`OllamasClient.mcpEnvelope` produce (`Sources/OllamasKit/Client.swift`), so
`swift run ollamas-ios generate "hi"` is a faithful dry-run of Recipe A.
