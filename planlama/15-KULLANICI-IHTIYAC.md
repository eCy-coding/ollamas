# 15-KULLANICI-IHTIYAC — dogfooding: kullanıcı ihtiyaç envanteri

> ollamas'ı KULLANICI olarak kullanıp (3 persona) çıkarılan ihtiyaç listesi. Yöntem: 3 Explore agent
> journey-tracing (kod + doküman izleme). Her ihtiyaç bir GAP-id'ye bağlı (03-GAP, P6 fazı).
> **Ana bulgu: mekanizmalar olgun; boşluk kullanıcıya-dönük DOKÜMANTASYON + birkaç UX-wiring.**
> Damga: 2026-07-10 · c5ac42d. Faz: P6 Benimseme/DX.

## §0 Personalar

| # | Persona | Amaç |
|---|---|---|
| A | **BYO-model kullanıcı** | kendi/tercih modelini getir, çalıştır, ayarla |
| B | **Geliştirici/uzatan** | kendi tool/skill/CLI/entegrasyon geliştir |
| C | **İlk-kez kuran/self-host** | kur, ilk-çalıştır, deploy, güncelle |

---

## §1 Persona A — BYO-model yolculuğu

| Adım | Durum | Anchor / kanıt |
|---|---|---|
| Yerel ollama modeli seç | ✅ VAR (pull hariç) | `server/ai.ts:48` listModels · `:72` resolveDefaultModel · `ReactAgentTab.tsx:539` model select |
| Champion set | ✅ VAR | `ai.ts:35` `MAC_MODEL_CHAMPION` · `server.ts:91` default qwen3:8b |
| Custom/remote endpoint | ⚠ KISMEN | `providers.ts:1334` custom-openai · `KeyVault.tsx:39` CUSTOM_OPENAI_PRESETS · **agent dropdown'da YOK** |
| Provider + API key | ✅ VAR (tam) | `KeyVault.tsx` · `server.ts:1006` POST /api/keys · vault şifreli · `provider-catalog.ts` |
| Donanım-uyumlu öneri | ⚠ TEMEL | `cockpit-models.ts:11` rankMacModels (RAM-fit); VRAM/GPU profili yok |
| GGUF/Modelfile import | ✗ EKSİK | yalnız `tool-registry.ts:635` bench_gguf; `ollama create` akışı yok |
| Model-başına ayar | ⚠ GLOBAL | `providers.ts:933` ollamaNumCtx (global), keep_alive env; UI override yok |
| İlk kullanım (model yok) | ✗ EKSİK | `ai.ts:77` throw "no local ollama model"; model-pull wizard yok |

**İhtiyaç → GAP:** custom-openai dropdown **GAP-035** [P1, gerçek bug] · first-run wizard **GAP-034** [P2] ·
per-model ayar UI **GAP-037** [P2] · GGUF import **GAP-036** [P3] · (VRAM öneri, UI pull/delete → §5 backlog).

---

## §2 Persona B — geliştirici-uzatma yolculuğu

| Uzatma noktası | Durum | Anchor / kanıt |
|---|---|---|
| Yeni tool ekle | ⚠ kod-VAR, doküman-YOK | `tool-registry.ts:195` TOOLS · `:852` register · tier `:43`; "adding a tool" HOWTO yok |
| MCP consume | ✅ VAR (belgeli) | `cli/commands/mcp.ts:43` · INTEGRATIONS.md · upstream-guard |
| MCP expose | ✅ VAR (belgeli) | `openapi.ts:39` POST /mcp · `/.well-known/mcp.json` · conformance |
| Skill ekle | ⚠ kod-VAR, HOWTO-YOK | `.claude/skills/*/SKILL.md` · skills-wiring test; kullanıcı-HOWTO yok |
| CLI alt-komut ekle | ⚠ desen-VAR, rehber-zayıf | `cli/commands/*.ts` · CLI_AGENTS.md; adım-adım yok |
| Plugin/marketplace | ✅ VAR | `cli/commands/plugin.ts` (checksum-gated) + `.claude/build-plugin.sh` |
| Programatik erişim (API) | ✅ VAR (quickstart-YOK) | `openapi.ts` OpenAPI 3.1 · `/api/openapi.json` · Bearer olm_ |
| Dev kurulum | ⚠ KISMEN | QUICKSTART.md var; **CONTRIBUTING.md YOK** |
| Extension-nokta indeksi | ⚠ DAĞINIK | 11-MIMARI var ama tek "Extension Guide" yok |

**İhtiyaç → GAP:** adding-a-tool.md **GAP-027** [P1] · Extension Guide **GAP-028** [P1] ·
CONTRIBUTING **GAP-026** [P1] · HOWTO-ADD-SKILL **GAP-029** [P2] · CLI-subcommand rehber **GAP-030** [P2] ·
API quickstart **GAP-038** [P3]. **Tümünde kod olgun; boşluk salt dokümantasyon.**

---

## §3 Persona C — onboarding / self-host / docs

| Adım | Durum | Anchor / kanıt |
|---|---|---|
| install.sh | ✅ VAR | Docker-first + npm fallback + LaunchAgent · DRY_RUN |
| `npm run ready` instant-on | ✅ VAR | `scripts/ready.mjs` (deps/.env/ollama/qwen3:8b pull/doctor) |
| setup.sh | ✗ KOPUK | README ilk-adım; olmayan `bin/main.go`/`go build` arıyor (eski Genesis kimliği) |
| İlk çalıştırma / health | ✅ VAR | `server.ts:143` /api/ready · `:188` /api/health · compose HEALTHCHECK |
| Konfigürasyon | ✅ VAR | `.env.example` zengin + satır-içi belgeli |
| Self-host/deploy | ✅ VAR (olgun) | Dockerfile · docker-compose.yml · deploy/helm · deploy/k8s |
| README | ✗ YANLIŞ ÜRÜN | `README.md:1` "LLM Mission Control mesh" (kurgusal P2P/WASM/70B) — gerçek ürün MCP gateway+CLI |
| QUICKSTART | ✅ VAR (doğru kapı) | ollamas-odaklı, doğru |
| Kullanıcı kılavuzları | ✗ EKSİK | user-guide/model-guide/troubleshooting/FAQ yok |
| LICENSE | ✅ VAR (MIT) | fork/dağıtım net |
| CONTRIBUTING/CoC | ✗ YOK | katkı yolu tanımsız |
| SAAS vs local mod | ✅ VAR | `.env.example` SAAS_ENFORCE belgeli |
| Güncelleme | ⚠ KISMEN | `cli/UPDATE.md` binary-only; Docker/stack update yok |

**İhtiyaç → GAP:** README fix **GAP-024** [P0] · setup.sh **GAP-025** [P0] · CONTRIBUTING **GAP-026** [P1] ·
troubleshooting **GAP-031** [P1] · model-guide **GAP-032** [P1] · deploy-guide + stack-update **GAP-033** [P2].

---

## §4 Kimlik-borcu kümesi (çapraz-tema)

**GAP-024 (README kurgusal) + GAP-020 (package `react-example@0.0.0`) + GAP-023 (PLAN.md "Genesis") +
GAP-025 (setup.sh `bin/main.go`)** = aynı kök: repo'nun kimlik-dokümanları gerçek ürünü yansıtmıyor.
Yeni kullanıcı yanlış zihinsel model alıyor. P6a + P5 birlikte **"repo gerçek kimliğini yansıtır"**
invariant'ını kapatır. Kabul: `grep -ri "mission control.*mesh\|Genesis Cluster" README.md PLAN.md package.json`
= yalnız kasıtlı-tarihsel referans (kurgu-onboarding 0).

## §5 Düşük öncelik / backlog (P6 dışı, gelecek)

- hwfit VRAM/GPU öneri motoru genişletme (şu an RAM-fit).
- UI'dan `ollama pull`/model-silme.
- Multi-model paralel serve (MAX_LOADED_MODELS>1) opsiyonu + uyarı.
- Katkı-marketplace (topluluk tool/skill paylaşımı).

## §6 GAP eşleme özeti (P6 → 03-GAP → 10-MIKRO)

| GAP | Öncelik | İhtiyaç | Mikro |
|---|---|---|---|
| GAP-024 | P0 | README gerçek-ürün | M-026 |
| GAP-025 | P0 | setup.sh düzelt/yönlendir | M-027 |
| GAP-026 | P1 | CONTRIBUTING + CoC | M-028 |
| GAP-027 | P1 | docs/adding-a-tool.md | M-029 |
| GAP-028 | P1 | Extension Guide | M-030 |
| GAP-035 | P1 | custom-openai dropdown (bug) | M-031 |
| GAP-031 | P1 | troubleshooting/FAQ | M-032 |
| GAP-032 | P1 | model-guide (VRAM) | M-033 |
| GAP-029 | P2 | HOWTO-ADD-SKILL | M-034 |
| GAP-030 | P2 | CLI-subcommand rehber | M-035 |
| GAP-033 | P2 | deploy-guide + stack-update | M-036 |
| GAP-034 | P2 | first-run model wizard | M-037 |
| GAP-037 | P2 | per-model ayar UI | M-038 |
| GAP-036 | P3 | GGUF/Modelfile import | M-039 |
| GAP-038 | P3 | API quickstart | M-040 |
