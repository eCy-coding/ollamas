# CLAUDE_DISPATCH.md — otonom Claude Code conductor zinciri (vO41)

> Auto: `tsx orchestration/bin/claude-dispatch.ts [--go] [--app iterm2]` · dry-run DEFAULT ·
> aktivasyon: `touch orchestration/.claude-dispatch-enabled` (tek sefer) · kill-switch: `.claude-dispatch-off` ·
> zincir: done → anında sıradaki; stale → 4h backoff; 2× stale → blocked (insan)

## ⏭ SKIP — churn-guard: hedef stabilite bekliyor (crit:roadmap-drift:v1.25 birkaç bağımsız değerlendirmede kalıcı olmalı)

- ts: 2026-07-12T07:52:39.859Z · app: Terminal.app · go-enabled: ❌ · kill-switch: off
- 24h bütçe: 0/6 spawn
- top requirement: **COMPLETENESS:crit:roadmap-drift:v1.25** — v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç kapanı) 'planned' ama eşleşen araç/arte (fingerprint 8271362850b0)
- 🎯 hedef stabilite (churn-guard): 1 gözlem / 0 dk → ⏳ bekliyor
- 🛑 blocked (insan gerekli): stale:claude/cool-cohen-b245ee (f9a75edd31e5)

## Oturumlar
| fingerprint | task | app | started | status |
|---|---|---|---|---|
| d54a73f349ac | CRITICAL:red:integration/v17-core | - | 2026-07-03T14:05:41.000Z | done |
| d2f5ae3bf993 | COMPLETENESS:crit:done-no-evidence:vO16 | - | 2026-07-03T14:55:07.000Z | done |
| ff70564a1393 | COMPLETENESS:crit:duplication:automator-probe.ts↔chrome-probe.ts | - | 2026-07-04T01:01:15Z | done |
| d2e3910e008d | COMPLETENESS:crit:duplication:dispatchdoctor.ts↔doctor.ts | - | 2026-07-04T01:05:00.000Z | done |
| 9244c75cafde | COMPLETENESS:crit:duplication:fleet-conduct.ts↔fleet-launch.ts | - | 2026-07-04T09:14:48Z | done |
| 6a8f18cded6c | COMPLETENESS:dod:done-without-governance:vO44 | - | 2026-07-04T13:44:24.000Z | done |
| 678e382a385e | COMPLETENESS:dod:uncommitted-green:2 dosya | - | 2026-07-04T14:56:37.000Z | done |
| 917e9ee83258 | STALE:stale:(detached) | - | 2026-07-04T22:14:57.000Z | done |
| f9a75edd31e5 | STALE:stale:claude/cool-cohen-b245ee | - | 2026-07-05T19:59:49.212Z | blocked |
| 40e0a590cdd5 | COMPLETENESS:dod:code-without-test:lib/orchestra-fsm.ts | Terminal.app | 2026-07-05T21:11:03.958Z | done |
| 449f700a6bbd | COMPLETENESS:crit:duplication:autofix.ts↔orchestra.ts | - | 2026-07-06T00:24:01.000Z | done |
