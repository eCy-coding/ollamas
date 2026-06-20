# mcp — teşhis notları

> Hedef: tool-registry, ToolRegistry.execute choke-point, modelcontextprotocol. Makine `mcp.detected.json` (vO4.1): 2.

## 1. DesktopCommander.execute doğrudan çağrı (diagnostic.ts + orchestrator.ts)

scan.ts 2 yerde `DesktopCommander.execute(...)` doğrudan çağrısı buldu — kanonik
`ToolRegistry.execute` choke-point'i atlıyor (ERR-ORCH-007 ile kanonik çağrı muaf tutuldu, bunlar gerçek).
Choke-point dışı host-komut yürütme = metering/allowlist/redaction atlanır (AGENTS §0-§6 güvenlik).

```note
{
  "id": "mcp-integrations-1",
  "persona": "mcp", "targetLane": "integrations",
  "targetPath": "server/diagnostic.ts", "severity": "med", "confidence": "asserted",
  "finding": "DesktopCommander.execute doğrudan (diagnostic.ts+orchestrator.ts) — ToolRegistry choke-point dışı host-exec",
  "evidence": [{ "path": "server/orchestrator.ts", "lineHint": "-", "fact": "DesktopCommander.execute(payload) doğrudan" }],
  "solution": {
    "summary": "Host-komut yürütmeyi ToolRegistry.execute üzerinden geçir (tek choke-point → per-tenant allowlist + metering + redaction). Meşru sistem-içi çağrıysa AGENTS'e açık istisna + audit-log ekle. MCP server referans deseni: tüm tool dispatch tek registry'den.",
    "refs": [
      { "repo": "modelcontextprotocol/servers", "license": "MIT", "url": "https://github.com/modelcontextprotocol/servers", "kind": "ref-only" },
      { "repo": "ollamas npm run conformance", "license": "internal", "url": "local", "kind": "idea" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "sistem-içi meşru mu yoksa gerçek bypass mı — backend persona ile teyit" },
  "source": "authored"
}
```
