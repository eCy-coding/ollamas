# CLAUDE_DISPATCH.md — otonom Claude Code conductor zinciri (vO41)

> Auto: `tsx orchestration/bin/claude-dispatch.ts [--go] [--app iterm2]` · dry-run DEFAULT ·
> aktivasyon: `touch orchestration/.claude-dispatch-enabled` (tek sefer) · kill-switch: `.claude-dispatch-off` ·
> zincir: done → anında sıradaki; stale → 4h backoff; 2× stale → blocked (insan)

## ⏭ SKIP — aktif oturum limiti dolu (1/1)

- ts: 2026-07-03T14:05:35.545Z · app: Terminal.app · go-enabled: ❌ · kill-switch: off
- 24h bütçe: 1/6 spawn
- top requirement: **CRITICAL:red:colab** — tsc 2 hata (fingerprint 585874ff190c)

## Oturumlar
| fingerprint | task | app | started | status |
|---|---|---|---|---|
| d54a73f349ac | CRITICAL:red:integration/v17-core | Terminal.app | 2026-07-03T13:35:59.654Z | active |
