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

---
**Toplam:** 22 agent tool, bridge 6 endpoint, warm-model kalibre, watchdog+self-heal,
shellcheck-doğrulamalı, gözlemlenebilir (seyir defteri). Repo: `eCy-coding/ollamas`.
