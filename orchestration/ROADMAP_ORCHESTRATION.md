# ROADMAP_ORCHESTRATION.md — Orkestrasyon Lane (vO1 → vO10)

> Her versiyon bir **"Next precomputed"** handoff bloğu ile biter (zero-wait sıralama —
> lane ROADMAP'lerinden adopt edilen desen). Tetik: **"sıradaki versiyonu planla"**.
> Branch ≡ versiyon (drift-guard, ERR-SCR-001 dersi): `feat/orchestration-vN`.

| Versiyon | Durum | Kapsam |
|----------|-------|--------|
| **vO1** | ✅ DONE | Bootstrap: master prompt + roadmap + errors_registry + seyir + adoption matris + read-only status.ts |
| **vO2** | ✅ DONE | Live discovery — dev-server cwd-mapping (port-3000 collision çözüldü) + tmux-first/iTerm2/Terminal.app sekme keşfi + busy/idle sinyali + **§3.1 aktif koordinasyon** (nudge/notify, allowlist+dry-run) |
| vO3 | planned | Per-lane sıradaki-versiyon planner otomasyonu (trigger protokolü §4 kodlanır) |
| vO4 | planned | OSS adoption tracker + lisans-disiplini gate |
| vO5 | planned | Cross-lane bağımlılık grafiği (frontend↔backend API gap, scripts↔register-seam) |
| vO6 | planned | Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid-MLX bench adopt) |
| vO7 | planned | Drift-guard otomasyon (branch≡roadmap, choke-point bütünlüğü) |
| vO8 | planned | Quality-gate roll-up (tüm lane tsc/lint/test tek matriste) |
| vO9 | planned | Heartbeat/notification (idle-lane + takılı-tab tespiti) |
| vO10 | planned | Self-review + completeness critic (eksik koordinasyon ne?) |

---

## vO1 — Bootstrap (ACTIVE)

**Hedef:** Orkestrasyon lane'i kendi izole worktree'sinde ayağa kalksın; bu sekme her
oturumda obey edeceği master prompt'a, birleşik durum görüşüne ve hata hafızasına sahip olsun.

**Todo:**
- [x] İzole worktree `~/Desktop/ollamas-orchestration-wt` (feat/orchestration-v1)
- [x] `ORCHESTRATION_AGENTS.md` master prompt (§0-§8)
- [x] `ROADMAP_ORCHESTRATION.md` (bu dosya)
- [x] `errors_registry.json` (ERR-ORCH şema + RISK preload)
- [x] `SEYIR_DEFTERI_ORCHESTRATION.md`
- [x] `ADOPTIONS_ORCHESTRATION.md` (ranked OSS matris)
- [x] `bin/status.ts` read-only durum matrisi
- [x] status.ts kanıt koşusu → STATUS.md üretildi (7 worktree), lane ağaçları unchanged doğrulandı (0 leak)

**Phase sırası:** READ şablonlar → WRITE governance → BUILD status.ts → VERIFY (koş + zero-write kanıt) → LOG → COMMIT.

**Next precomputed (→vO2):** status.ts'e canlı tab-discovery ekle: `ps`/lsof ile çalışan
dev-server'ları (vite 5173, backend 3000, tsx watch) read-only sapta + terminal.app sekme
sayısını AppleScript ile sorgula (iTerm2 -CC desen, ref-only — GPL kod kopyalama). Worktree
listesi zaten dinamik; hardcoded lane adı kalmasın. Test: yeni worktree eklenince matris
otomatik büyür.

---

## vO2 — Live Discovery (DONE 2026-06-20)

**Yapıldı:**
- `discover.ts` (NEW): pure parser (parseLsofListen/parseLsofCwd/matchWorktree/mapServersToWorktrees/parseTabs) + native read-only sarmalayıcılar (listenersLive/pidCwdLive/discoverTabs/pidsOnTty/tabWorktree).
- Dev-server: lsof→pid→cwd→worktree (port-3000 collision çözüldü; Docker:3000 lane sayılmaz). ERR-ORCH-001.
- Terminal.app sekme keşfi (osascript hibrit; izin yok → zarafetle atlar, ORCH_TAB_SIM=fail testi).
- idle-lane sinyali (git %ct, >ORCH_IDLE_HOURS saat → 💤).
- status.ts rewrite: Tab/Idle kolonları + "beklenen 8 vs canlı N" header.
- TDD: discover.test.ts 9/9 pass (6×port-3000 disambiguation dahil) + orchestration/vitest.config.ts (root vite kontaminasyon by-pass, ERR-SCR-002 dersi).

**Kanıt:** vitest 9/9; status.ts canlı 7 worktree + 3 dev-server + 11 sekme; lane ağaçlarına 0 yazım.

**Bilinen sınır:** tab↔lane cwd eşlemesi best-effort (shell cwd home ise eşlenmez) — vO9 heartbeat'te güçlendirilecek.

**Next precomputed (→vO3):** trigger protokolü §4'ü script'e bağla — `plan-next.ts <lane>` verilen
lane'in SEYIR+ROADMAP+errors'ını okuyup todo+phase+optimal-prompt taslağı emit etsin (insan
onayı ile). a3-swod skill çıktısını şablonla. Dosya: NEW orchestration/bin/plan-next.ts +
tests/plan-next.test.ts (lane→şablon pure fonksiyon). status.ts'in roadmapSignal/errorSignal
helper'larını discover.ts'e ortak çıkar (DRY).
