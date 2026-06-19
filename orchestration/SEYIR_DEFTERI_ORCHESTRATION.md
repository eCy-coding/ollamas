# SEYIR DEFTERI — Orkestrasyon Lane

> Faz-faz anlatı günlüğü. Her versiyon: ne yapıldı, kanıt, hata (varsa → errors_registry).
> Format aynası: FRONTEND_SEYIR_DEFTERI.md.

---

## vO1 — Bootstrap (2026-06-20)

**Bağlam:** ollamas 6 izole worktree lane'e büyüdü (backend/MCP `feat/v1.7-mcp-adopt`,
cli `feat/cli-v2-clean`, frontend `feat/frontend-vf3`, integrations `feat/gateway-v2`,
scripts `feat/scripts-v1`, bench `feat/v1.8-bench`), ~8 terminal.app sekmesinde paralel
geliştiriliyor. Kondüktör yoktu. Bu lane onu kuruyor.

**Yapıldı:**
- İzole worktree `~/Desktop/ollamas-orchestration-wt` @ `feat/orchestration-v1` (base: main c19a0b6). Kanıt: `git worktree list | grep orchestration`.
- `ORCHESTRATION_AGENTS.md` master prompt: §0 north star, §1 canonical AGENTS.md'ye subordinasyon, §2 roller+/skill, §3 read-only scope law, §4 "sıradaki versiyonu planla" trigger protokolü, §5 token disiplini, §6 brain/memory/skills, §7 kalite kapısı, §8 logbook disiplini.
- `ROADMAP_ORCHESTRATION.md`: vO1→vO10, her biri "Next precomputed" handoff.
- `errors_registry.json`: ERR-ORCH şema + 6 RISK preload (branch-hijack, stale-drift, scope-creep, token, lisans, port-probe).
- `ADOPTIONS_ORCHESTRATION.md`: ranked OSS matris, lane'e map, lisans-flag.
- `bin/status.ts`: read-only birleşik durum matrisi (worktree auto-discover).

**Karar:** Saf koordinatör + izole worktree + read-only status script (T0 Emre onayı).

**Hata:** yok (bootstrap).

**Next precomputed (→vO2):** status.ts'e canlı tab/dev-server discovery + idle-lane sinyali.

---

## vO2 — Live Discovery (2026-06-20)

**Bağlam:** vO1 dev-server tespiti bozuktu. Keşif: 6 worktree de port 3000'e bind
(server.ts:31 `process.env.PORT || 3000`). Port ile lane ayırt edilemez (RISK-ORCH-006 gerçek).

**Yapıldı:**
- `bin/discover.ts` (NEW): read-only canlı keşif. Pure parser'lar (test edilebilir) + native
  lsof/ps/osascript sarmalayıcılar. Dev-server lsof→pid→**cwd**→worktree ile atanır (port DEĞİL).
- `bin/status.ts` rewrite: portFor/probe silindi; discover.ts entegre; **DevSrv** `:port(pid)`
  cwd-attributed, **Tab** (Terminal.app sekme/lane), **Idle** (💤 >3sa) kolonları + header
  "beklenen 8 vs canlı N sekme".
- `tests/discover.test.ts` (NEW): 9 case, 6×port-3000 cwd-disambiguation + Docker eleme.
- `vitest.config.ts` (NEW, orchestration-scoped): root vite.config @tailwindcss kontaminasyonu
  by-pass (ERR-SCR-002 dersi; plain-object, import yok).

**Kanıt:**
- `vitest run --config orchestration/vitest.config.ts` → 9/9 pass.
- `tsx orchestration/bin/status.ts` → 7 worktree, 3 dev-server (cli :61619 cwd-attributed,
  Docker:3000 lane sayılmadı), 11 canlı sekme. ORCH_TAB_SIM=fail → zarafetle "Sekme keşfi: skip".
- Lane ağaçlarına 0 yazım (scope law korundu).

**Hata:** ERR-ORCH-001 (port-3000 collision, fixed cwd-mapping), ERR-ORCH-002 (JSDoc `*/`
yorum-kapatma, fixed). İkisi de errors_registry'de.

**Drift:** branch `feat/orchestration-v1` hâlâ aktif (vO1+vO2 aynı v1 branch; versiyon bump
yapılmadı — orkestrasyon lane'i tek branch'te ilerliyor, drift-guard bunu kabul eder).

**Next precomputed (→vO3):** `plan-next.ts <lane>` — trigger protokolü §4 otomasyonu.

---

## vO2-merge — Aktif Koordinasyon + iTerm2/tmux fold (commit ↓, 2026-06-20)

**Bağlam:** vO2 İKİ sekme tarafından PARALEL kodlandı. Bu sekme bağımsız `lib/tabs.ts`+`lib/signal.ts`
yazdı; diğer sekme `discover.ts`+`status.ts`+vitest yazdı. T0 kararı: **MERGE (sıfır kayıp)** — diğerinin
discover/status matrisi KORUNDU, bu sekmenin koordinasyon katmanı + iTerm2/tmux ona fold'landı (`tabs.ts` silindi).

**Yapıldı (bu sekme):**
- `bin/lib/signal.ts` (NEW): §3.1 koordinasyon — `nudge` (allowlist `git status`+injection-guard, dry-run default,
  seyir audit) + `notify` (terminal-notifier MIT). `signal.test.ts` 28 case (tsx zero-dep).
- `bin/discover.ts` ENHANCE: `discoverTabs` artık **tmux-first → iTerm2 + Terminal.app** (önceden Terminal-only).
  `parseTmuxPanes` + `parseTabsTagged` + `isShellCmd` (busy/idle) eklendi. **ERR-ORCH-003 fix**: AppleScript
  `tab` sabiti app `tab` class'ı ile çakışıyor + string-literal `\t` gerçek-tab değil → ayraç `ASCII character 9`
  tell-bloğu dışında tanımlanır. (Diğer sekmenin `TAB_OSA`'sı bu canlı bug'ı taşıyordu; testleri JS-`\t` ile
  geçtiği için yakalamamıştı.) `tests/discover.test.ts` +4 describe (tmux/tagged/shell).
- `bin/status.ts` ENHANCE: `--nudge`/`--notify`/`--dry-run` flag + idle-lane koordinasyon bloğu (lane→temsilci-sekme).

**Kanıt:** vitest 13/13 + signal.test.ts 28/28. `tsx status.ts` canlı: 7 worktree, 12 sekme keşfi (tmux yok→
AppleScript fallback, iTerm2+Terminal). `--nudge --dry-run` → idle lane planı stdout (gönderim yok). Lane ağaçlarına 0 yazım.

**Hata/Drift (DÜZELTME):** Yukarıdaki "branch v1 aktif" notu ARTIK GEÇERSİZ — **ERR-ORCH-004 branch-hijack
gerçekleşti**: eşzamanlı sekme `git checkout feat/orchestration-v3` ile bu worktree'yi v1→v3'e kaydırdı
(reflog `HEAD@{0}: checkout: moving from feat/orchestration-v1 to feat/orchestration-v3`). HEAD base-main'de
kaldı = vO2 hiç commit edilmemişti. T0 kararı: green işi HEMEN **feat/orchestration-v3**'te lock-in
(branch=v3 / içerik=vO2-tamamlama drift'i kabul; hız > branch-saflığı). vO1+vO2 governance da ilk kez bu
commit'le kalıcılaştı (önceden tümü untracked'ti — memory "vO1 DONE" ile git uyuşmazlığı, RISK-ORCH-002).

**Next precomputed (→vO3):** `plan-next.ts <lane>` trigger §4 otomasyonu — verilen lane'in SEYIR+ROADMAP+errors
oku → todo+phase+optimal-prompt taslağı emit (a3-swod template, HIL onay). vO3'e başlamadan oturum-başı
`git branch --show-current`==`feat/orchestration-v3` doğrula (ERR-ORCH-004 prevention).
