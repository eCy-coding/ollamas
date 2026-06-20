# prompt-engineer — teşhis notları

> Hedef: AGENTS.md, SEYIR_DEFTERI.md, server.ts system-prompt string'leri.
> Makine `logSeyir.jsonl` literal'ini bulamadı (0 bulgu) → bu notlar asserted (Explore teşhisi).

## 1. project_cortex.md failure-sink boş + SEYIR_DEFTERI manuel-only

`project_cortex.md` ~465 byte, yalnız INITIALIZED + 1 ilke. `logSeyir` çalışma-anında jsonl
yazıyor ama hiçbir dashboard/okuyucu yok → öğrenme döngüsü kapalı (hata tekrarını önleyemez).

```note
{
  "id": "prompt-engineer-repo-1",
  "persona": "prompt-engineer", "targetLane": "repo",
  "targetPath": "project_cortex.md", "severity": "med", "confidence": "asserted",
  "finding": "Failure-sink (project_cortex.md) boş + SEYIR manuel-only → hata-öğrenme döngüsü kapalı",
  "evidence": [{ "path": "project_cortex.md", "lineHint": "1", "fact": "~465B, yalnız INITIALIZED" }],
  "solution": {
    "summary": "logSeyir.jsonl'i prompt-context'e besleyen bir 'don't-repeat' enjeksiyonu kur (orchestration plan-next.ts errors_registry deseni). System-prompt'a son N hata + prevention_rule otomatik eklensin. Reflexion/self-refine deseni: ajan hatasını sink'e yazsın, sonraki turda okusun.",
    "refs": [
      { "repo": "noahshinn/reflexion", "license": "MIT", "url": "https://github.com/noahshinn/reflexion", "kind": "idea" },
      { "repo": "spencermarx/open-code-review", "license": "Apache-2.0", "url": "https://github.com/spencermarx/open-code-review", "kind": "ref-only" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": [], "verdict": "" },
  "source": "authored"
}
```

## 2. (consensus) observability gap'i bağımsız teyit — backend ile

Aynı kök: metrikler/log üretiliyor ama tüketici yok. backend-backend-1 ile aynı bulgu →
panel consensus boost uygulamalı (multi-agent redundancy).

```note
{
  "id": "fullstack-backend-9",
  "persona": "fullstack", "targetLane": "backend",
  "targetPath": "server/metrics.ts", "severity": "med", "confidence": "asserted",
  "finding": "prom-client bağlı (4 kullanım) ama tüketici/dashboard yok — observability boşluğu",
  "evidence": [{ "path": "server/metrics.ts", "lineHint": "-", "fact": "fullstack bağımsız teyit: /metrics expose ama UI tüketicisi yok" }],
  "solution": {
    "summary": "backend-backend-1 ile aynı çözüm; ek olarak frontend SaaSAdmin.tsx'e canlı /metrics widget'ı bağlanabilir (cockpit deseni).",
    "refs": [
      { "repo": "traceloop/opentelemetry-mcp-server", "license": "Apache-2.0", "url": "https://github.com/traceloop/opentelemetry-mcp-server", "kind": "ref-only" },
      { "repo": "grafana/grafana", "license": "AGPL-3.0", "url": "https://github.com/grafana/grafana", "kind": "ref-only" }
    ]
  },
  "minRefs": 2, "status": "open",
  "debate": { "challenges": [], "support": ["backend-backend-1"], "verdict": "" },
  "source": "authored"
}
```
