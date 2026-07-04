# ollamas — Lane Durum Matrisi

> READ-ONLY. `tsx orchestration/bin/status.ts` ile üretilir. 12 worktree, 10 canlı dev-server.
> Sekmeler: beklenen 8 vs canlı 26 (lane'e eşlenen 18).
> Ana-repo son commit: 2026-07-04 14:00:42 +0300

| Lane (branch) | HEAD | Yaş | Dirty | ↑/↓ | DevSrv | Tab | Idle | Roadmap sinyali | Hatalar |
|---|---|---|---|---|---|---|---|---|---|
| chore/p1-hardening | ed9c6c4 | 0 seconds ago | 78 | n/a | :54172(1591) | 18 | ✓ | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| feat/colab-gpu | e1d1952 | 2 hours ago | 13 | n/a | — | 0 | ✓ | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| fix/audit-security | 0b57d99 | 9 days ago | 3 | 0/0 | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| verify/gwv2-all-lanes | f8a65a3 | 2 weeks ago | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| fix/binary-architecture-calibration | 3fb5391 | 13 days ago | 12 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| fix/audit-cont | 5f41efc | 2 hours ago | 1 | n/a | — | 0 | ✓ | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| claude/cool-cohen-b245ee | f777c22 | 10 days ago | 1 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| claude/determined-bartik-0090ba | 3e6599d | 9 days ago | 4 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |
| claude/loving-varahamihira-77d4a9 | c19a0b6 | 2 weeks ago | 1 | n/a | — | 0 | 💤 | ✅ Faz 12 v1.3 (Postgres + async stor | — |
| claude/naughty-kowalevski-2ccc35 | 992454d | 2 weeks ago | 566 | n/a | — | 0 | 💤 | ✅ Faz 12 v1.3 (Postgres + async stor | — |
| req-sweep | 8a16f63 | 39 minutes ago | 31 | n/a | — | 0 | ✓ | P4 Migration drift fix — migrations. | 20 (ERR-CONTRACT-020) |
| (detached) | f777c22 | 10 days ago | 0 | n/a | — | 0 | 💤 | P4 Migration drift fix — migrations. | 5 (ERR-ORCH-005) |

**Lejant:** DevSrv `:port(pid)`=cwd ile lane'e atanmış çalışan server, `—`=yok (port-tahmini değil, ERR-ORCH-001). Tab=bu lane'e eşlenen Terminal sekmesi (`?`=keşif atlandı). Idle=💤 (>3 saat commit yok) / ✓. ↑/↓=upstream ahead/behind.
