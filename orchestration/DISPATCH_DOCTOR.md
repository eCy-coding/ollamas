# DISPATCH_DOCTOR — fleet dispatch readiness (vO21)
<!-- AUTO dispatchdoctor.ts · 2026-06-28T17:26:52.761Z · gerekli model qwen3:8b · regenerate: tsx orchestration/bin/dispatchdoctor.ts -->

> Read-only fleet probe. Her worker'ın Hybrid-dispatch yeteneğini sınıflar + mod-başı GO/NO-GO + remediation.

## Worker'lar (gerekli model: `qwen3:8b`)
| | Worker | URL | Yetenek | Mode | Model'ler |
|---|--------|-----|---------|------|-----------|
| 🔴 | mac (control) | http://127.0.0.1:8090 | down | — | — |
| 🟡 | win | http://desktop-ert7724:11434 | inference-only | — | qwen3:8b |
| 🟡 | mac | http://localhost:11434 | inference-only | — | qwen3-coder-64k:latest, qwen3:8b-16k, ollamas-reviewer:latest, qwen2.5vl:32b, qwen2.5vl:7b, qwen3:8b, qwen3:30b-a3b, deepseek-r1:32b, qwen3-coder:30b, qwen3:4b, gpt-oss:20b, phi4:latest, kimi-k2.5:cloud, nomic-embed-text:latest, gpt-oss:20b-cloud, gpt-oss:120b-cloud, qwen3-coder:480b-cloud, llama3.3:70b |

## Hybrid mod hazırlığı
### ✅ GO · inference-offload (gateway Mac'te, inference remote GPU'da)
GO — 2 worker 'qwen3:8b' ile erişilebilir (win, mac)

### ⛔ NO-GO · full-remote-dispatch (ReAct loop desktop-ert7724 ÜZERİNDE)
NO-GO — 'qwen3:8b' ile remote ollamas gateway yok
- win: ollamas gateway server'ı çalıştır (scripts s.1) — şu an yalnız ollama-native; FULL remote dispatch için `/api/agent/chat` gerekir
- mac: ollamas gateway server'ı çalıştır (scripts s.1) — şu an yalnız ollama-native; FULL remote dispatch için `/api/agent/chat` gerekir
