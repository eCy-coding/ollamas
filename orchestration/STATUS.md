# ollamas — Lane Durum Matrisi

> READ-ONLY. `tsx orchestration/bin/status.ts` ile üretilir. 8 worktree, 5 canlı dev-server.
> Sekmeler: beklenen 8 vs canlı 46 (lane'e eşlenen 3).
> Ana-repo son commit: 2026-06-24 11:44:48 +0300

| Lane (branch) | HEAD | Yaş | Dirty | ↑/↓ | DevSrv | Tab | Idle | Roadmap sinyali | Hatalar |
|---|---|---|---|---|---|---|---|---|---|
| chore/p1-hardening | 4c9e7d0 | 2 hours ago | 27 | n/a | :7345(18629) | 3 | ✓ | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| verify/gwv2-all-lanes | f8a65a3 | 4 days ago | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| integration/v17-core | 6215f4f | 4 days ago | 35 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| fix/binary-architecture-calibration | 3fb5391 | 3 days ago | 12 | n/a | :24678(99560) | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| feat/updown-combo | cef26bd | 21 minutes ago | 1 | n/a | — | 0 | ✓ | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| claude/loving-varahamihira-77d4a9 | c19a0b6 | 6 days ago | 1 | n/a | — | 0 | 💤 | ✅ Faz 12 v1.3 (Postgres + async stor | — |
| claude/naughty-kowalevski-2ccc35 | 992454d | 4 days ago | 559 | n/a | — | 0 | 💤 | ✅ Faz 12 v1.3 (Postgres + async stor | — |
| route/scan-test | 3f31c8a | 2 hours ago | 1 | n/a | — | 0 | ✓ | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |

**Lejant:** DevSrv `:port(pid)`=cwd ile lane'e atanmış çalışan server, `—`=yok (port-tahmini değil, ERR-ORCH-001). Tab=bu lane'e eşlenen Terminal sekmesi (`?`=keşif atlandı). Idle=💤 (>3 saat commit yok) / ✓. ↑/↓=upstream ahead/behind.
