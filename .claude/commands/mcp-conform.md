---
description: MCP conformance — mcp-inspector (local dep) ile /mcp + stdio uyum testi ($0)
allowed-tools: Bash(npx mcp-inspector:*), Bash(npm run conformance:stdio), Bash(node dist/mcp-stdio.cjs:*)
---

ollamas MCP yüzeyini resmi inspector ile (CLI modu) doğrula. mcp-inspector LOCAL devDependency (node_modules/.bin) — indirme yok.

1. stdio transport: `npm run conformance:stdio` (= `mcp-inspector --cli node dist/mcp-stdio.cjs --method tools/list`) veya doğrudan `npx mcp-inspector --cli node dist/mcp-stdio.cjs --method tools/list`. dist yoksa `npm run build` gerekebilir — uyar.
2. (opsiyonel) HTTP transport: server up ise `--method tools/list` http `:8090/mcp`'ye.
3. Çıktı: tools/resources/prompts listesi + şema-uyum (eksik/hatalı alan) + transport OK mi.

Kural: CLI modu (UI portu açma). read-only. Evidence-first: gerçek inspector çıktısı. Hata → tam mesaj + olası fix (build/transport).
