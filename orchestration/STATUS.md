# ollamas — Lane Durum Matrisi

> READ-ONLY. `tsx orchestration/bin/status.ts` ile üretilir. 7 worktree, 3 canlı dev-server.
> Sekmeler: beklenen 8 vs canlı 13 (lane'e eşlenen 0).
> Ana-repo son commit: 2026-06-20 00:26:48 +0300

| Lane (branch) | HEAD | Yaş | Dirty | ↑/↓ | DevSrv | Tab | Idle | Roadmap sinyali | Hatalar |
|---|---|---|---|---|---|---|---|---|---|
| feat/v1.8-mcp-interceptors | 818eff6 | 13 minutes ago | 1 | n/a | — | 0 | ✓ | ✅ ~~Gateway hardening~~ — Faz 17 v1. | — |
| feat/cli-v2-clean | ffd24fd | 9 minutes ago | 1 | n/a | :61619(54095) | 0 | ✓ | v7 — DONE (kanıt) → v8 Observability/TUI ollamas top can | — |
| feat/frontend-vf3 | 569a62b | 6 minutes ago | 0 | n/a | — | 0 | ✓ | ✅ Faz 13 v1.4 (Production Operations | — |
| feat/gateway-v2 | a2bbfee | 12 minutes ago | 2 | n/a | — | 0 | ✓ | ✅ Gateway hardening (Faz 17 / v2.0'd | — |
| feat/orchestration-v3 | c19a0b6 | 23 hours ago | 1 | n/a | — | 0 | 💤 | vO2 — Live Discovery (DONE 2026 06 2 → vO3 planned Per lane sıradaki versiy | 4 (ERR-ORCH-004) |
| feat/scripts-v1 | 070d5bc | 12 minutes ago | 10 | n/a | — | 0 | ✓ | 4. ✅ DRY_RUN guard (v2 ertelenen) →  → Durum işaretleri: ⬜ planlı · 🔵 deva | 5 (ERR-SCR-005) |
| feat/v1.8-bench | 655084c | 48 seconds ago | 2 | n/a | — | 0 | ✓ | ✅ Faz 15 v1.6 (MCP Ecosystem Interop | — |

**Lejant:** DevSrv `:port(pid)`=cwd ile lane'e atanmış çalışan server, `—`=yok (port-tahmini değil, ERR-ORCH-001). Tab=bu lane'e eşlenen Terminal sekmesi (`?`=keşif atlandı). Idle=💤 (>3 saat commit yok) / ✓. ↑/↓=upstream ahead/behind.
