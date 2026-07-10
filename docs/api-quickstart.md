# API Quickstart

Talk to an ollamas gateway from `curl` (or any HTTP client) in three steps:
**get a key → list tools → call a tool**. The gateway exposes an MCP Streamable
HTTP endpoint at **`POST /mcp`** (JSON-RPC 2.0) plus a REST surface under `/api/*`.
Full schema: `GET /api/openapi.json` (source: [`server/openapi.ts`](../server/openapi.ts)).

The gateway defaults to `http://localhost:3000` (`PORT` in `.env`). Start one with
`npm run dev` (or `make up`).

## Step 0 — do you even need a key?

Auth on `/mcp` depends on `SAAS_ENFORCE` (see `.env.example`):

- **`SAAS_ENFORCE=0` (default, single-user localhost):** no key required. `/mcp` is
  open to localhost callers (Origin is still checked for DNS-rebinding protection).
- **`SAAS_ENFORCE=1` (multi-tenant):** every `/mcp` request needs a
  `Authorization: Bearer olm_<key>` header, and admin routes require an admin token.

## Step 1 — get an API key (enforced mode)

Keys are issued by the admin route `POST /api/saas/keys`, guarded by the
`X-Admin-Token` header (set `SAAS_ADMIN_TOKEN` in your env — mandatory when
`SAAS_ENFORCE=1`). The plaintext key is returned **once**.

```bash
curl -sS http://localhost:3000/api/saas/keys \
  -H "X-Admin-Token: $SAAS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenantId": "acme", "label": "my-first-key"}'
# → { "key": "olm_xxxxxxxxxxxxxxxx", ... }   ← copy this, it is shown only once
```

Save it:

```bash
export OLLAMAS_API_KEY="olm_xxxxxxxxxxxxxxxx"
```

> The `ollamas` CLI reads `OLLAMAS_API_KEY` for tenant calls and `OLLAMAS_SAAS_ADMIN`
> for admin calls — so `ollamas saas keys …` and `ollamas mcp …` do all of this for
> you. This doc shows the raw HTTP so you can wire your own client.

## Step 2 — first `/mcp` call: `tools/list`

`/mcp` is a **stateless** JSON-RPC endpoint — there is no `initialize` handshake and
no session id. It replies as Server-Sent Events (`text/event-stream`), so you must
send an `Accept` header that allows both JSON and SSE.

```bash
curl -sS -N http://localhost:3000/mcp \
  -H "Authorization: Bearer $OLLAMAS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

In single-user mode (`SAAS_ENFORCE=0`) drop the `Authorization` line — the rest is
identical.

The response is an SSE frame whose `data:` line holds the JSON-RPC result — a list of
tools, each with `name`, `title`, `description`, `inputSchema`, and `annotations`:

```
event: message
data: {"jsonrpc":"2.0","id":1,"result":{"tools":[
        {"name":"read_file","title":"read file","description":"Read full contents…",
         "inputSchema":{"type":"object","properties":{"path":{"type":"string"}}},
         "annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false}},
        … ],"nextCursor":"…"}}
```

The `annotations` tell you how dangerous a tool is (they map from its security tier —
`readOnlyHint` = safe, `destructiveHint` = non-safe, `openWorldHint` = upstream; see
[adding-a-tool.md](./adding-a-tool.md)). Results are paginated — follow `nextCursor`
with `"params": {"cursor": "…"}` to get the next page.

## Step 3 — call a tool: `tools/call`

```bash
curl -sS -N http://localhost:3000/mcp \
  -H "Authorization: Bearer $OLLAMAS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": { "path": "README.md" }
    }
  }'
```

Result:

```
event: message
data: {"jsonrpc":"2.0","id":2,"result":{
        "content":[{"type":"text","text":"# ollamas …"}],
        "isError":false}}
```

- `content[0].text` is the tool output (a string, or JSON-stringified object).
- `isError: true` means the call failed — read `content` for the reason.
- Tools that declare an output schema also return `structuredContent` (the typed
  object) alongside the text block.
- A tool your plan/scope can't run comes back as an error like
  `Tool 'x' (tier=privileged) not permitted for this plan` or `insufficient_scope`.

## Other MCP methods

The same envelope works for `resources/list`, `resources/read`, and `prompts/list`
(see the `/mcp` summary in `server/openapi.ts`). Discovery for third-party MCP
clients lives at `GET /.well-known/mcp.json`.

## Common errors

| HTTP | Meaning | Fix |
|------|---------|-----|
| `401` | Missing/invalid credential (enforced mode) | Send a valid `Authorization: Bearer olm_…` |
| `403` | Origin not allowed (DNS-rebinding guard) | Call from localhost, or set `ALLOWED_ORIGINS` |
| `406` | `Accept` header doesn't allow SSE | Add `Accept: application/json, text/event-stream` |

See also: [adding-a-tool.md](./adding-a-tool.md) · [extension-guide.md](./extension-guide.md) ·
[troubleshooting.md](./troubleshooting.md).
