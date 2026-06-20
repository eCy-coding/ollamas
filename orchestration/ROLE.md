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
- Orchestration: **vO7 (Work Claim Ledger (duplikasyon önleme) claims.ts atomic mkdi) DONE** → sıradaki **vO8 (Drift guard otomasyon (branch≡roadmap, choke point bütünlüğü)**
- İzlenen lane'ler (9): `feat/v1.11-roots-abort` · `feat/cli-v2-clean` · `feat/frontend-vf3` · `feat/general-oauth-grants` · `feat/gateway-v2` · `feat/orchestration-v3` · `feat/scripts-v1` · `feat/tunnel-v1` · `feat/v1.8-bench`
- 🏆 **Optimal runtime (0-manuel):** `qwen3-coder:30b` @ Apple M4 Max (119.7 tok/s) — `MODEL_PROMPT.md`

## Şu anki ollamas aşaması (canlı — her lane shipped → geliştirilebilir)
| Lane | Şu an (shipped) | → Geliştirilebilir sonraki | dirty |
|------|-----------------|----------------------------|-------|
| `v1.11-roots-abort` | ✅ ~~roots/list upstream agregasyonu +… | → — | 4△ |
| `cli-v2-clean` | v11 — DONE (kanıt) | → v12 Node SEA binary node build sea ca… | 1△ |
| `frontend-vf3` | ✅ Faz 13 v1.4 (Production Operations … | → — | 5△ |
| `general-oauth-grants` | ✅ ~~roots/list upstream agregasyonu +… | → — | 0△ |
| `gateway-v2` | ✅ Per tenant upstream tool visibility… | → — | 0△ |
| `orchestration-v3` | vO3 — Canlı Cockpit (DONE 2026 06 20) | → vO3 ✅ DONE Canlı cockpit — serve.ts (… | 42△ |
| `scripts-v1` | 3. ✅ 4 nokta registration : usage → i… | → Durum işaretleri: ⬜ planlı · 🔵 devam… | 8△ |
| `tunnel-v1` | — | → vT9 Resilience auto reconnect, Launch… | 0△ |
| `v1.8-bench` | ✅ Faz 15 v1.6 (MCP Ecosystem Interop … | → — | 6△ |

## Geliştirilebilir aşamalar (ROADMAP planned)
- vO6: Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid MLX ben
- vO8: Drift guard otomasyon (branch≡roadmap, choke point bütünlüğü
- vO9: Quality gate roll up (tüm lane tsc/lint/test tek matriste)
- vO10: Heartbeat/notification (idle lane + takılı tab tespiti)
- vO11: Self review + completeness critic (eksik koordinasyon ne?)

### Lane bazında geliştirilebilir sonraki (canlı NEXT sinyalleri)
- **cli-v2-clean** → v12 Node SEA binary node build sea canonical tek
- **orchestration-v3** → vO3 ✅ DONE Canlı cockpit — serve.ts (zero dep no
- **scripts-v1** → Durum işaretleri: ⬜ planlı · 🔵 devam · ✅ done. 
- **tunnel-v1** → vT9 Resilience auto reconnect, LaunchAgent daemo

## Araç envanteri (16 bin/)
- `adopt-gate.ts` — adopt-gate.ts — vO4 OSS Adoption License-Discipline Gate
- `adopt.ts` — OSS adoption tracker + lisans-disiplini GATE
- `autopilot.ts` — vO-AUTO 0-manuel orkestrasyon tetikleyici.
- `bench.ts` — Benchmark agregasyon raporu
- `benchprompt.ts` — FÜZYON: 0-manuel optimal model+config → TEK portable prompt
- `claim.ts` — vO7 Work-Claim CLI: bir sekme bir görevi
- `conduct.ts` — Zero-touch autonomous conductor
- `critic.ts` — Self-auditing completeness critic
- `depgraph.ts` — Cross-lane bağımlılık grafiği + API-gap raporu
- `discover.ts` — READ-ONLY canlı keşif: çalışan dev-server'ları cwd ile
- `heartbeat.ts` — Otonom sürdürülebilir tick
- `panel.ts` — panel.ts — vO4 panel "Tech-Lead orchestrator"
- `plan-next.ts` — Trigger §4 otomasyonu: "sıradaki versiyonu planla [lane]".
- `scan.ts` — scan.ts — vO4 panel "parallel review" fazı: persona-başı DETERMİNİSTİK
- `serve.ts` — serve.ts — vO3 canlı cockpit sunucusu. ZERO-DEP
- `status.ts` — ollamas lane'lerinin READ-ONLY birleşik durum matrisi.

## Tetik
**"sıradaki versiyonu planla [lane]"** → kesintisiz plan+prompt (READ→CROSS-THINK→EMIT). Sözleşme: `ORCHESTRATION_AGENTS.md` + `~/Desktop/plan.md`.
