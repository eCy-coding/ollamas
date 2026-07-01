# CODE_PLAN.md — Hangi dil ile neyi kodlamalı (KESİN CEVAP)

> Oto-üretim: `tsx orchestration/bin/council.ts --debate` · 2026-07-01T10:08:59Z
> Kaynak: 170 model-bulgu (7 lane) + ground-truth dil-sayımı. Öncelik: güvenlik/risk > çok-model-uzlaşı > öneri.

## TL;DR
**TypeScript birincil dil (2395 dosya); en öncelikli iş: security (12 bulgu, 6 lane).**

## 1. Hangi dil (ground-truth dosya-sayımı + karar)
| Dil | Dosya | Bahsedilme | Karar |
|-----|-------|-----------|-------|
| TypeScript | 2395 | 117 | **BİRİNCİL** — tüm yeni mantık |
| JavaScript | 490 | 28 | → TypeScript'e taşı (.mjs) |
| Shell | 110 | 18 | sağlamlaştır (env-guard, exit-code) |
| Rust | 14 | 2 | uzman/perf — mevcut, yeni-öğrenme yok |
| Go | 7 | 3 | uzman/perf — mevcut, yeni-öğrenme yok |
| Python | 38 | 0 | ikincil |

## 2. Neyi kodla — tema-kümeleri (öncelik-sıralı)

### P1 · Güvenlik (input-validation, injection)  ·  12 bulgu · 6 lane · 7 model uzlaşı · ⚠️ 4 risk
- Lane: backend, frontend, cli, scripts, integrations, orchestration
- Fix tool implementation validation logic in `server/analyzer.ts` to correctly check entryPoint existence
- Add unit tests for `analyzer.ts` tool validation logic to reduce false positives in missing implementation detection
- Update `useAuth.ts`, `useLogbook.ts`, etc., hooks with type-safe TypeScript interfaces and enhance error handling for better robustness.
- Potential security vulnerabilities if Node.js built-ins are not properly polyfilled when compiling to native binaries

### P1 · Eşzamanlılık (race condition, senkronizasyon)  ·  7 bulgu · 4 lane · 5 model uzlaşı · ⚠️ 4 risk
- Lane: backend, frontend, scripts, integrations
- Quiescence-based session completion detection may cause race conditions or missed updates under high load
- Potential race condition in `host-bridge.ts` when handling concurrent MCP client connections leading to message loss
- Implement error boundaries for health badge in web/landing.js to handle API failures gracefully
- Potential race conditions in agent-fleet.mjs when aggregating results from multiple sub-agents without proper synchronization

### P1 · Hata yönetimi + exit-code + logging  ·  32 bulgu · 7 lane · 7 model uzlaşı · ⚠️ 9 risk
- Lane: backend, frontend, cli, scripts, integrations, bench, orchestration
- Add error handling and timeout logic for SSE stream in `server/agent-events.ts`
- Implement structured logging for agent sessions in `agent-events.ts` to support better observability and debugging
- Refactor `mcp/server.ts` to improve error handling and response formatting for MCP protocol compliance
- Improve error handling in SSE streaming to prevent client disconnections and data loss.

### P1 · Tip-güvenliği (.mjs→.ts, tip-defs)  ·  16 bulgu · 6 lane · 5 model uzlaşı · ⚠️ 3 risk
- Lane: frontend, cli, scripts, integrations, bench, orchestration
- Current use of vanilla JavaScript in `web/landing.js` introduces inconsistencies compared to the rest of the project's React/TypeScript stack, potentially causing maintenance issues.
- Add TypeScript type safety checks to App.tsx component imports to enforce proper typing
- Refactor WorkspaceTree component to use TypeScript interfaces for better type safety and code clarity
- Enhance the TelemetryCockpit component with TypeScript types for metrics and visualization

### P1 · Refactor / yapısal (shared util, migrasyon)  ·  61 bulgu · 7 lane · 8 model uzlaşı · ⚠️ 8 risk
- Lane: backend, frontend, cli, scripts, integrations, bench, orchestration
- Implement proper session status tracking in `server/db.ts` to replace quiescence-based detection
- Add dedicated `steps[]` array support in `ChatSession` model for better step-level tracking
- Refactor `server/agent-events.ts` to emit structured step events instead of relying on message index polling
- Extend `server/ai.ts` facade to support explicit model selection and configuration beyond ollama-local

### P2 · Test coverage (vitest)  ·  8 bulgu · 6 lane · 6 model uzlaşı
- Lane: frontend, cli, scripts, integrations, bench, orchestration
- Add unit tests for critical components such as `WorkspaceTree` and `ReactAgentTab` to ensure functionality remains stable during future changes.
- Add unit tests for cli/lib/client.ts and cli/lib/config.ts
- Implement unit tests for agent-dispatch.mjs using a testing framework like Jest to ensure deterministic output across various tasks.
- Add unit tests for error paths in tunnel/src/transport.ts and tunnel/src/transports/caddy-tls.test.ts

### P2 · Performans (async, lazy-load)  ·  10 bulgu · 4 lane · 4 model uzlaşı
- Lane: backend, frontend, cli, bench
- Enhance `ai.ts` to support dynamic model selection based on resource availability and performance metrics
- Optimize `ecysearcher.ts` indexing performance by implementing batch processing for large document sets
- Optimize memory usage when processing large model outputs in the AI provider chain.
- Optimize state management in MultiAgentPipeline component to reduce unnecessary re-renders

> Öncelik motoruyla çapraz: `tsx orchestration/bin/conduct.ts` (RED-lane > eksik > bayat).
