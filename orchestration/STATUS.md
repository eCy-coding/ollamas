# ollamas — Lane Durum Matrisi

> READ-ONLY. `tsx orchestration/bin/status.ts` ile üretilir. 20 worktree, 5 canlı dev-server.
> Sekmeler: beklenen 8 vs canlı 0 (lane'e eşlenen 0).
> Ana-repo son commit: 2026-07-11 23:33:10 +0300

| Lane (branch) | HEAD | Yaş | Dirty | ↑/↓ | DevSrv | Tab | Idle | Roadmap sinyali | Hatalar |
|---|---|---|---|---|---|---|---|---|---|
| feat/v-final-train | 655897d | 11 saat önce | 40 | 0/16 | :49258(60133) | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/odysseus-bridge | ac1d7a4 | 10 saat önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/cockpit-v1 | dabf81b | 3 gün önce | 5 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/colab-gpu | e1d1952 | 8 gün önce | 12 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| integration/all-lanes | 1cca41b | 2 gün önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/cookbook-panel | 274a072 | 34 saat önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/documents-panel | 7ea59fd | 34 saat önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| fix/audit-security | 0b57d99 | 2 hafta önce | 2 | 0/0 | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| feat/fable-do-calibration | 4e2a40f | 5 gün önce | 1 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/flow-v1 | 2629be7 | 8 gün önce | 11 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| verify/gwv2-all-lanes | f8a65a3 | 3 hafta önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| feat/gwv2-cherrypick | 38f0034 | 2 gün önce | 2 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| agent/odysseus-task-1 | 0b8766b | 12 saat önce | 1 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/research-panel | 818a7fc | 34 saat önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/revenue-first-payment | 9761b01 | 3 gün önce | 2 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/shell-s0 | 2c6b4bb | 13 saat önce | 1 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/v2-shipgate | ba5986c | 2 gün önce | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/ux-e2e | 81cbf4f | 2 gün önce | 5 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| feat/ux-quality-v2 | 13ed9e8 | 2 gün önce | 1 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| fix/binary-architecture-calibration | 3fb5391 | 3 hafta önce | 12 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |

**Lejant:** DevSrv `:port(pid)`=cwd ile lane'e atanmış çalışan server, `—`=yok (port-tahmini değil, ERR-ORCH-001). Tab=bu lane'e eşlenen Terminal sekmesi (`?`=keşif atlandı). Idle=💤 (>3 saat commit yok) / ✓. ↑/↓=upstream ahead/behind.
