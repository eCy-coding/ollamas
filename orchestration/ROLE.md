# Bu sekme = ollamas Orkestra Şefi (orchestration lane)

> Canlı durum (`role.ts` üretti — bayat değil). ollamas **v1.6.0** @ `feat/v1.11-roots-abort`.

## Görev
**Bu sekme = ollamas'ın orkestra şefi.** Tek görev: çalışan diğer lane sekmelerini (backend/MCP, frontend, cli, scripts, integrations/gateway, bench + test/integration) **read-only** takip et, birleşik durum matrisi üret, her lane'in sıradaki versiyonunu **10 versiyon ileriye** kadar planla, her iş için optimal prompt'u üret, OSS adoption fırsatlarını lane'lere map'le, hataları seyir defterine yaz ve **asla tekrarlama**.

## Ne yaparım
- **İzle:** `status.ts` → lane durum matrisi (branch/commit/dev-server/idle/hata)
- **Planla:** "sıradaki versiyonu planla [lane]" → o lane'in todo+phase+optimal-prompt'u (lane sekmesi kodlar)
- **Koordine:** çapraz-lane bağımlılık (`depgraph.ts`), version-drift, çakışma
- **Adoption:** GitHub e2e-search → lisans-disiplini gate (`adopt.ts`), no vibe-code
- **Benchmark:** `bench.ts` → MacBook+iOS tok/s, en-verimli model
- **Logla:** hata → errors_registry, asla tekrarlama

## Sınır (Scope Law §3)
- **YAPABİLİR:** yalnız `orchestration/**` yaz + lane'lere read-only eriş
- **YAPAMAZ:** lane kodu (src/server/cli/scripts), commit, endpoint → backlog+prompt veririm
- İzole worktree, branch git ile doğrulanır (RISK-ORCH-001 branch-hijack)

## Mevcut aşama
- Orchestration: **vO11 (Self review + completeness critic (eksik koordinasyon ne?)) DONE** → sıradaki **(ROADMAP'e planlı versiyon ekle)**
- İzlenen lane'ler (10): `feat/v1.11-roots-abort` · `feat/cli-v2-clean` · `feat/frontend-vf3` · `feat/general-oauth-grants` · `feat/ukp-ingest-receiver` · `feat/gateway-v2` · `feat/orchestration-v3` · `feat/scripts-v1` · `feat/tunnel-v1` · `feat/v1.8-bench`
- Optimal runtime: `tsx bin/benchprompt.ts` koş (henüz MODEL_SELECTION.json yok)
- 🩺 **Lane health (vO9):** 1🟢 / 1🔴 / 7⚪ — `QUALITY.md` (tsc canlı + vitest cache)
- 🧭 **Öz-denetim (vO10-12):** completeness 12 açık · DoD 19 yarım-iş — `CRITIC.md`/`DOD.md` (autopilot→conduct tüketir)

## Şu anki ollamas aşaması (canlı — her lane shipped → geliştirilebilir)
| Lane | Şu an (shipped) | → Geliştirilebilir sonraki | dirty |
|------|-----------------|----------------------------|-------|
| `v1.11-roots-abort` | ✅ ~~Per tenant upstream tool visibili… | → ✅ Faz 22 v1.13 (OAuth Refresh Token R… | 8△ |
| `cli-v2-clean` | v13 — DONE (kanıt) | → v14 TUI v2 / agent watch top multi pa… | 2△ |
| `frontend-vf3` | ✅ Faz 13 v1.4 (Production Operations … | → — | 21△ |
| `general-oauth-grants` | ✅ ~~roots/list upstream agregasyonu +… | → — | 0△ |
| `ukp-ingest-receiver` | ✅ ~~roots/list upstream agregasyonu +… | → ✅ Faz 22 v1.13 (OAuth Refresh Token R… | 0△ |
| `gateway-v2` | ✅ Per tenant upstream tool visibility… | → — | 1△ |
| `orchestration-v3` | — | → — | 50△ |
| `scripts-v1` | v14 — Host Bridge Security Hardening … | → Durum işaretleri: ⬜ planlı · 🔵 devam… | 3△ |
| `tunnel-v1` | — | → — | 12△ |
| `v1.8-bench` | ✅ Faz 15 v1.6 (MCP Ecosystem Interop … | → — | 4△ |

## Geliştirilebilir aşamalar (ROADMAP planned)
- (ROADMAP'te planned vO yok)

### Lane bazında geliştirilebilir sonraki (canlı NEXT sinyalleri)
- **v1.11-roots-abort** → ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
- **cli-v2-clean** → v14 TUI v2 / agent watch top multi pane (request
- **ukp-ingest-receiver** → ✅ Faz 22 v1.13 (OAuth Refresh Token Rotation [RF
- **scripts-v1** → Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 

## Araç envanteri (24 bin/)
- `adopt-gate.ts` — adopt-gate.ts — vO4 OSS Adoption License-Discipline Gate
- `adopt.ts` — OSS adoption tracker + lisans-disiplini GATE
- `autofix.ts` — Self-healing remediation
- `autopilot.ts` — vO-AUTO 0-manuel orkestrasyon tetikleyici.
- `bench.ts` — Benchmark agregasyon raporu
- `benchprompt.ts` — FÜZYON: 0-manuel optimal model+config → TEK portable prompt
- `claim.ts` — vO7 Work-Claim CLI: bir sekme bir görevi
- `conduct.ts` — Zero-touch autonomous conductor
- `critic.ts` — Self-auditing completeness critic
- `depgraph.ts` — Cross-lane bağımlılık grafiği + API-gap raporu
- `discover.ts` — READ-ONLY canlı keşif: çalışan dev-server'ları cwd ile
- `doctor.ts` — vO-AUTO.1 readiness doctor
- `dod.ts` — Definition-of-Done + Concurrent-Task detector
- `driftguard.ts` — vO8 Drift-Guard CLI: deterministik tutarlılık GATE
- `fuse.ts` — Unified Critical Requirements
- `heartbeat.ts` — Otonom sürdürülebilir tick
- `horizon.ts` — vO12 Roadmap Horizon Auto-Generator CLI
- `model-hook.ts` — UserPromptSubmit hook wrapper
- `panel.ts` — panel.ts — vO4 panel "Tech-Lead orchestrator"
- `plan-next.ts` — Trigger §4 otomasyonu: "sıradaki versiyonu planla [lane]".
- `quality.ts` — vO9 Quality-Gate Roll-Up: 0-manuel tüm-lane sağlık matrisi.
- `scan.ts` — scan.ts — vO4 panel "parallel review" fazı: persona-başı DETERMİNİSTİK
- `serve.ts` — serve.ts — vO3 canlı cockpit sunucusu. ZERO-DEP
- `status.ts` — ollamas lane'lerinin READ-ONLY birleşik durum matrisi.

## Tetik
**"sıradaki versiyonu planla [lane]"** → kesintisiz plan+prompt (READ→CROSS-THINK→EMIT). Sözleşme: `ORCHESTRATION_AGENTS.md` + `~/Desktop/plan.md`.
