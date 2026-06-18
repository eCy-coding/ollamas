# Seyir Defteri — LLM Mission Control

Bu projenin klonlanıp kurulmasından, gerçek-zamanlı macOS terminal coding
sistemine ve 22-araçlı agentic toolkit'e dönüşmesine kadar **adım adım** kayıt.
Her faz: **ne** yapıldı, **nasıl**, **niçin**, kanıt (commit). Canlı agent
eylemleri ayrıca `~/.llm-mission-control/seyir-defteri.jsonl`'e otomatik düşer
(`logbook` aracı / `GET /api/logbook` ile okunur).

---

## Faz 0 — Klonlama + E2E kurulum
- **Ne:** `adobemre1/ollamas` klonlandı, Docker detached + localhost-only çalıştırıldı.
- **Nasıl:** `docker-compose.yml` portu `127.0.0.1:3000` + `restart: unless-stopped`; Dockerfile fix (puppeteer chromium, `tools.json` kopyala).
- **Niçin:** kesintisiz + LAN'a kapalı (unauth shell-exec yüzeyini izole et).
- **Kanıt:** 9/9 self-test gate yeşil, ollama 0.30.7 live.

## Faz 1 — Vault durability bug fix
- **Ne:** API key'leri restart'ta kaybolmuyor artık.
- **Nasıl:** `db.ts` `os.platform()!=="darwin"` → container'ı ephemeral sayıp `/app/.ephemeral-data`'ya yazıyordu. `MISSION_CONTROL_DATA_DIR` env override → mounted volume.
- **Niçin:** Docker'da kalıcı vault + master key.

## Faz 2 — Gerçek-zamanlı macOS Terminal Bridge (commit 5ace9d6)
- **Ne:** Linux container'daki agent, gerçek **iTerm2/Terminal.app**'i sürüyor.
- **Nasıl:** host-side `terminal-bridge.mjs` (osascript) + `/run /exec /write /read /health`. macos_terminal agent tool → `host.docker.internal:7345`. Komut script-file ile çalıştırılır; **watchdog** hung komutu kesip session'ı kurtarır; timeout'ta dedicated pencere reset (self-heal).
- **Niçin:** container GUI süremez → host bridge şart.
- **Kanıt:** bridge test 10/10.

## Faz 3 — Benchmark + Warm-model kalibrasyon (commit 65a38ca)
- **Ne:** En verimli config bulundu + kalıcı yapıldı.
- **Nasıl:** 5 model e2e benchmark → **qwen3:8b** en hızlı doğru. `providers.ts`'e `keep_alive=30m` + `num_thread=12` (M4 Max P-core) + `num_gpu=999` plumb. Terminal.app stabil seçildi.
- **Niçin:** warm model = reload latency yok, stabil ~215ms/92 tok/s.

## Faz 4 — Sistemin kendi araçlarını kodlaması (dogfooding) + 21 araç
- **Ne:** Agent (qwen3-coder:30b) kendi bridge-tool'larını yazdı, 3 batch'te.
  - Batch 1 (5ace9d6/1a30e6c): run_tests, git_ops, process_port, health_probe + `write_host_file` + `/exec` (nested-bridge deadlock çözümü).
  - Batch 2 (0bacc33): lint_format, git_commit, build_app, kill_process.
  - Batch 3 (d764b60): log_stream, pkg_install, web_search, apply_patch.
- **Nasıl:** her tool agent `write_host_file` ile yazıldı, ReAct adımları izlendi; agent bug'ları (node-fetch/undici/Deno, token-path, heredoc) kök-nedenden düzeltildi.
- **Niçin:** sistem kendi araçlarını üretebilen agentic coding platformu.

## Faz 5 — Toolkit hardening (commit 39b2dcf)
- **Ne:** kalite + verim + kapasite.
- **Nasıl:** ortak `lib/bridge-client.mjs` (DRY, JSON+exit, retry+timeout); lint_format image cache; git_ops subcommand, git_commit --push, kill_process --sig, web_search --fetch; yeni `tools_doctor` (self-test).
- **Niçin:** ~80 satır tekrar gitti, tutarlı output, observability.

## Faz 6 — Bash/macOS uzmanlığı (commit 2872992)
- **Ne:** agent macOS/BSD shell'de uzmanlaştı, hata payı düştü.
- **Nasıl:** `MACOS_BASH_GUIDE.md` + system-prompt'a BSD kuralları; `shell_check` aracı (shellcheck + macOS heuristik) → komut çalıştırmadan lint; in-container allowlist +20 bin.
- **Niçin:** tekrarlayan base64 -d / sed -i / heredoc hatalarını önle.

## Faz 7 — Seyir Defteri + Otonomi testi (bu faz)
- **Ne:** logbook sistemi + müdahalesiz otonomi ölçümü.
- **Nasıl:** `server.ts` her agent step'i `seyir-defteri.jsonl`'e otomatik yazar; `logbook` aracı + `/api/logbook`. Gerçek kullanıcı istekleri agent'a verilip ne/nasıl/niçin sorgulandı.

## Faz 8 — MCP Gateway + tools-as-SaaS (devam ediyor)
- **Ne:** ollamas'ı MCP gateway + SaaS broker'a dönüştürme. Önce master prompt + tek choke-point.
- **Master prompt:** `AGENTS.md` (roller + değişmez prensipler + kalite kapısı + güvenlik tier'leri); `server.ts` runtime system prompt'a operating-contract enjekte (commit bb05060).
- **Faz 0 (tek choke-point):** `server/tool-registry.ts` — 22 workspace tool tek `ToolRegistry.execute(name,args,ctx)`'ten geçer; schema/diff/halt/metering-hook/allowlist tek nokta. `server.ts` ReAct dispatch switch'i (~100 satır) registry çağrısına indi; `AGENT_TOOLS` literal → `ToolRegistry.schemas()`. tsc temiz, 6/7 test (1 pre-existing consent-401 fail).
- **Niçin:** MCP-expose, MCP-consume, auth, rate-limit, billing — hepsi tek noktaya takılacak; ikinci dispatch yolu yasak (AGENTS.md §4).
- **Faz 1 (MCP gateway):** `@modelcontextprotocol/sdk` 1.29. EXPOSE: `server/mcp/server.ts` low-level Server + stateless Streamable HTTP → `app.all("/mcp")`; registry JSON-Schema'ları doğrudan MCP `inputSchema`. CONSUME: `server/mcp/client.ts` stdio/http upstream → tool'lar `mcp__<server>__<tool>` olarak registry'ye merge → ReAct + /mcp ikisi de çağırır. tools.json `mcpServers` config. Kanıt: MCP client listTools = 22 tool (LIVE :3939); yerel stdio mini-MCP consume → `mcp__local__ping` → "pong" choke-point'ten. tier-filter `MCP_EXPOSE_TIERS` (§5 güvenlik).
- **Faz 2 (multi-tenant store):** `server/store/index.ts` — Node 24 built-in `node:sqlite` (ZERO dep, docker native-rebuild yok). Tablolar: plans (free/pro/enterprise seed, tier escalation), tenants, api_keys (SHA-256 hash, plaintext ONCE), usage_events (ay-bazlı index), invoices. `~/.llm-mission-control/saas.db`.
- **Faz 3 (auth + rate-limit):** `server/middleware/auth.ts` Bearer/X-API-Key → resolveKey → `req.tenant`; `rate-limit.ts` plan-bazlı token-bucket + aylık kota. `/mcp` = auth→rate-limit→handler. `SAAS_ENFORCE=1` key zorunlu (default off = tek-kullanıcı geriye-uyum). ctxFactory tenant ise plan.allowed_tiers + metering. Admin: `/api/saas/{plans,tenants,keys,keys/:id/revoke}` (`SAAS_ADMIN_TOKEN` guard). **Metering hook canlı** (`onUsage`→`recordUsage`). Kanıt (:3940 SAAS_ENFORCE): keysiz `/mcp`=401; free-key listTools=15 safe tool (host/privileged filtre); `git_commit` (host) "not permitted"; usage_events satırı yazıldı.
- **Faz 4 (billing):** `server/billing/stripe.ts` — `aggregateUsage` ay-bazlı tenant rollup → `computeRun`/`runBilling` Stripe metered events + invoice satırı; Stripe LAZY + `STRIPE_API_KEY` yoksa **dry-run** (sıfır billing config ile çalışır). `handleWebhook` imza-doğrulamalı (raw-body mount, plan değişimi→`setTenantPlan`). Endpoint: `/api/billing/{preview,run,webhook}` + tenant `/api/saas/usage`. stripe@22.2.1. Kanıt (:3941 pro-key): 3× read_file → usage `used:3`; preview `dryRun:true total:3`; run invoice yazdı. **Tüm 5 faz E2E doğrulandı; ollamas artık MCP gateway + tools-as-SaaS.**

## Faz 9 — E2E sertleştirme (Faz 5: fix + test + UI + docs)
- **Ne:** 3-ajan audit'in flag'lerini düzelt, ilk commit'li otomatik test suite, SaaS admin UI, portability/docs.
- **5A fix (tüm flag'ler):** HOST_TOOLS_DIR env-override (hardcoded abs yol → portability); rate-limit Map bounded + idle-TTL eviction (DoS); adminGuard SAAS_ENFORCE=1 iken token ZORUNLU + timing-safe compare; Stripe gerçek `stripe_customer_id` (kolon+idempotent migration); invoice idempotency; agent-loop metering ("local" tenant); consume `isError` → ok=false; sqlite ek index; orchestrator dürüst "legacy-cluster-stub"; `MCP_AUTO_APPLY` env.
- **5B test (hermetik, vitest):** tool-registry (tier gating/halt/onUsage/register), saas-store (tenant/key/resolve/revoke/usage/aggregate/invoice-idempotency/auth/rate-limit), mcp-gateway.e2e (**self-boot** server: keysiz 401, free=15 tier filtre, bad-admin 401, stdio consume ping→pong); ClusterE2ELive `RUN_LIVE_E2E` gate. **31 passed / 1 skipped.**
- **5C UI:** `src/components/SaaSAdmin.tsx` — admin-token, plan/tenant/key/usage/billing/gateway paneli; App tab "SaaS Gateway". vite build yeşil; canlı endpoint doğrulandı (key metadata-only).
- **5D docs:** `.env.example` 9 SaaS var; README "MCP Gateway + tools-as-SaaS" bölümü (claude mcp add, plan tier'leri, billing); docker-compose HOST_TOOLS_DIR + SaaS env + saas.db volume notu; start.sh HOST_TOOLS_DIR export; AGENTS.md §7 roadmap ✅.
- **Niçin:** "interaktif en verimli yöntem" = otomatik E2E ile flag tespit→fix→kanıt; ollamas artık test-korumalı + UI'lı + dökümante MCP-gateway/SaaS.

---
**Toplam:** 22 agent tool, bridge 6 endpoint, warm-model kalibre, watchdog+self-heal,
shellcheck-doğrulamalı, gözlemlenebilir (seyir defteri). Repo: `eCy-coding/ollamas`.
