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
- Orchestration: **vO5 (Cross lane bağımlılık grafiği graph.ts / depgraph.ts API gap) DONE** → sıradaki **vO6 (Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid MLX ben)**
- İzlenen lane'ler (8): `feat/v1.11-roots-abort` · `feat/cli-v2-clean` · `feat/frontend-vf3` · `feat/gateway-v2` · `feat/orchestration-v3` · `feat/scripts-v1` · `feat/tunnel-v1` · `feat/v1.8-bench`

## Şu anki ollamas aşaması (canlı — her lane shipped → geliştirilebilir)
| Lane | Şu an (shipped) | → Geliştirilebilir sonraki | dirty |
|------|-----------------|----------------------------|-------|
| `v1.11-roots-abort` | ✅ ~~OAuth 2.1 Authorization Server~~ … | → — | 8△ |
| `cli-v2-clean` | v7 — DONE (kanıt) | → v11 Keychain + secrets v2 v7 ertelene… | 2△ |
| `frontend-vf3` | ✅ Faz 13 v1.4 (Production Operations … | → — | 14△ |
| `gateway-v2` | ✅ Per tenant upstream tool visibility… | → — | 3△ |
| `orchestration-v3` | vO3 — Canlı Cockpit (DONE 2026 06 20) | → vO3 ✅ DONE Canlı cockpit — serve.ts (… | 19△ |
| `scripts-v1` | v9 — iOS Deepening ✅ | → Durum işaretleri: ⬜ planlı · 🔵 devam… | 11△ |
| `tunnel-v1` | — | → vT9 Resilience auto reconnect, Launch… | 8△ |
| `v1.8-bench` | ✅ Faz 15 v1.6 (MCP Ecosystem Interop … | → — | 1△ |

## Geliştirilebilir aşamalar (ROADMAP planned)
- vO6: Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid MLX ben
- vO7: Drift guard otomasyon (branch≡roadmap, choke point bütünlüğü
- vO8: Quality gate roll up (tüm lane tsc/lint/test tek matriste)
- vO9: Heartbeat/notification (idle lane + takılı tab tespiti)
- vO10: Self review + completeness critic (eksik koordinasyon ne?)

### Lane bazında geliştirilebilir sonraki (canlı NEXT sinyalleri)
- **cli-v2-clean** → v11 Keychain + secrets v2 v7 ertelenen macOS Key
- **orchestration-v3** → vO3 ✅ DONE Canlı cockpit — serve.ts (zero dep no
- **scripts-v1** → Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 
- **tunnel-v1** → vT9 Resilience auto reconnect, LaunchAgent daemo

## Araç envanteri (11 bin/)
- `adopt-gate.ts` — adopt-gate.ts — vO4 OSS Adoption License-Discipline Gate
- `adopt.ts` — OSS adoption tracker + lisans-disiplini GATE
- `bench.ts` — Benchmark agregasyon raporu
- `depgraph.ts` — Cross-lane bağımlılık grafiği + API-gap raporu
- `discover.ts` — READ-ONLY canlı keşif: çalışan dev-server'ları cwd ile
- `optimize.ts` — M4 + ollamas için en-verimli model+config seç → portable prompt
- `panel.ts` — panel.ts — vO4 panel "Tech-Lead orchestrator"
- `plan-next.ts` — Trigger §4 otomasyonu: "sıradaki versiyonu planla [lane]".
- `scan.ts` — scan.ts — vO4 panel "parallel review" fazı: persona-başı DETERMİNİSTİK
- `serve.ts` — serve.ts — vO3 canlı cockpit sunucusu. ZERO-DEP
- `status.ts` — ollamas lane'lerinin READ-ONLY birleşik durum matrisi.

## Tetik
**"sıradaki versiyonu planla [lane]"** → kesintisiz plan+prompt (READ→CROSS-THINK→EMIT). Sözleşme: `ORCHESTRATION_AGENTS.md` + `~/Desktop/plan.md`.
