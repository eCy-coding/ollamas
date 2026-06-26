# Agent protokol registry (harness)

Harness'in konuştuğu/keşfedilebilir olduğu protokoller. Durum + entegrasyon + kalan iş.

## Aktif (entegre)
| protokol | ne | nerede | durum |
|---|---|---|---|
| **MCP** (Model Context Protocol) | tool/context server | `.mcp.json` (ollamas/context7/deepwiki) + server `/mcp` | ✓ e2e doğrulandı (2026-06-27): http `/mcp` 200 + stdio `dist/mcp-stdio.cjs` **20 tool** (list_tree/read_file/write_file/run_command/grep_search/run_tests/git_ops/web_search/rag_search…), mcp-inspector --cli tools/list geçer |
| **OpenAPI** | `/api/*` makine-keşfi | `server.ts` → `/api/openapi.json` | ✓ (server lane) |
| **LSP** | inline TS tanı | `.lsp.json` | ✓ (binary: npm i -g typescript-language-server) |
| **A2A** (Agent2Agent) | agent discovery | `.well-known/agent-card.json` (v0.3.0 Agent Card) | ✓ statik (lokal url) |
| **llms.txt** | agent-readable repo index | kök `llms.txt` | ✓ |

## ACP (Agent Client Protocol — Zed) — OPERATÖR
Editör↔agent (Zed/Neovim/Emacs). Claude Code'u editöre açar. Apache-lisanslı adapter, npx (zero-dep dışı → cli/'e koyulmaz). Operatör kurar:

**Zed** — `settings.json`:
```json
{
  "agent_servers": {
    "Claude Code": {
      "command": "npx",
      "args": ["-y", "@zed-industries/claude-code-acp"]
    }
  }
}
```
Sonra Zed Agent Panel → "Claude Code". (Neovim: CodeCompanion ACP adapter; Emacs: agent-shell.)

## SKIP (kanıtlı alakasız)
- **AG-UI** — web frontend↔agent (CLI/TTY harness için yanlış katman).
- **ACP (IBM/BeeAI Agent Communication Protocol)** — A2A ile birleşti, adoption yok.
- **Agentic Commerce Protocol** — ödeme, alakasız.

## Kalan iş — KOD LANE (bu sekme değil; ilgili lane uygular)
- **cli/** ACP-agent: ollamas CLI'ı native ACP-agent yapmak (`initialize`/`session.new`/`session.prompt`) — TS library gerektirir (zero-dep ihlali) → ayrı karar.
- **server/** MCP resources + prompts: `/mcp` şu an yalnız tools; resources/prompts eklenebilir.
- **A2A JSON-RPC task endpoint**: agent-card statik var; `tasks/send` JSON-RPC çalıştırma ucu server lane'de.
- **Dışa-publish**: agent-card lokal url (127.0.0.1) → public tunnel/domain = Emre kararı.

Kaynaklar: agentclientprotocol.com · agent2agent.info/docs/concepts/agentcard · npmjs.com/package/@zed-industries/claude-code-acp
