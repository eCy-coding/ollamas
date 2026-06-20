# backend — teşhis notları

> Hedef: server/, backend/ orphan, observability. Makine bulgusu `backend.detected.json`.

## 1. prom-client bağlı ama dashboard/tüketici yok (observability boşluğu)

`scan.ts` `prom-client`in 4 kullanımını buldu ama hiçbir grafana/dashboard tüketicisi yok.
`/metrics` endpoint + `prom-client` var; metrikler dışa akıyor ama görselleştiren/alert eden katman yok.

```note
{
  "id": "backend-backend-1",
  "persona": "backend", "targetLane": "backend",
  "targetPath": "server/metrics.ts", "severity": "med", "confidence": "asserted",
  "finding": "prom-client bağlı (4 kullanım) ama tüketici/dashboard yok — observability boşluğu",
  "evidence": [{ "path": "server/metrics.ts", "lineHint": "-", "fact": "prom-client producer=4, consumer(grafana)=0" }],
  "solution": {
    "summary": "Prometheus scrape + Grafana dashboard JSON repo'ya ekle (deploy/). MCP tarafında trace için OpenTelemetry MCP server consume edilebilir → AI ajan distributed trace okur. Önce /metrics'i bir dashboard'a bağla, sonra logSeyir.jsonl'i de aynı panele besle.",
    "refs": [
      { "repo": "traceloop/opentelemetry-mcp-server", "license": "Apache-2.0", "url": "https://github.com/traceloop/opentelemetry-mcp-server", "kind": "ref-only" },
      { "repo": "prometheus/client_nodejs", "license": "Apache-2.0", "url": "https://github.com/siimon/prom-client", "kind": "idea" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": ["fullstack-backend-9"], "verdict": "" },
  "source": "authored"
}
```
