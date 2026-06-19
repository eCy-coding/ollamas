# NEXT — cli lane → v8 (Observability/TUI ollamas top canlı usage/metrics ( /metrics)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: ROADMAP.md
> Mevcut: **v7 (Profiller + secrets AES 256 GCM secrets at rest ( secrets.ts)** → Hedef: **v8 (Observability/TUI ollamas top canlı usage/metrics ( /metrics)**

## Spec (niyet)
> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla (CLI_AGENTS §7).
> Her versiyonun "done" tanımı, sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Durum |
|-----|------|----------|-------|
| **v1** | İskelet + chat | `node:util` parseArgs router, `chat` (one-shot+REPL+SSE), `doctor`, `config`, TTY/`--json`/NO_COLOR, `bin`, POSIX köprü iskelet, governance docs | ✅ DONE |
| **v2** | Agent sürücü + sweep | `ollamas agent` ReAct loop (`/api/agent/chat` SSE); write-onay akışı (`/api/agent/approve-write`); oturum (`/api/agent/sessions`); `--yolo`/`--safe`; + 10 v1-gap (G1-G10) | ✅ DONE |
| **v3** | SaaS/admin + sweep | `ollamas saas plans\|tenants\|tenant new\|keys\|key new\|revoke\|audit\|usage\|billing` → `/api/saas/*`+`/api/billing/*` (X-Admin-Token); `formatTable`; secret-once key; revoke confirm; doctor saas satırı; H1-H8 | ✅ DONE |
| **v4** | Bench/calibration | `ollamas bench` dual-target (mac + remote/iOS-proxy); warmup'lı TTFB/tok/s/total; `cli-bench.json` host-etiketli; `pickBest` + `--apply`; I1-I6 | ✅ DONE |
| **v5** | MCP client | `ollamas mcp info\|tools\|call\|upstreams\|add\|rm` — `/mcp` JSON-RPC + `/api/saas/upstreams`; guard glob + HIL gate; choke-point üzerinden çağrı | ✅ DONE |
| **v6** | iOS Shortcuts pack | `ollamas shortcuts build` → WFWorkflow plist (chat/status/bench/mcp-call) + recipe cards; POSIX köprü saas+mcp upstreams/add/rm; `mcp call --stream`; remote-exposure doc (tailscale) | ✅ DONE |
| **v7** | Profiller + secrets | AES-256-GCM secrets-at-rest (`secrets.ts`/`keystore.ts`, db.ts deseni) + `*Enc` sealed config + güvenli migration; çoklu-gateway profil (`config use`/`profiles`/`--profile`); env override korunur | ✅ DONE |
| **v8** | Observability/TUI | `ollamas top` canlı usage/metrics (`/metrics` prom parse + `/api/saas/usage/timeseries`); seyir-defteri.jsonl tail; terminal sparkline; `--watch` | ▶ NEXT |
| **v9** | Packaging | `npm link` global; opsiyonel Go tek-binary (v4 bench TTFB kazancı gösterirse); Homebrew tap; shell completion (bash/zsh) | |
| **v10** | Self-update + plugin | `ollamas update`; manifest-tabanlı 3rd-party alt-komut sistemi; release-please; CLI CI (`.github/workflows`) | |
| **v11+** | Ufuk (önceden-hesap) | Native Swift Shortcuts derinleştirme; WASM build; otonom agent loop; multi-gateway mesh kontrolü | |

## Plan / Phase + Tasks
- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)

## Don't-repeat (errors_registry)
- (kayıtlı hata yok)

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen cli lane sekmesisin (branch feat/cli-v2-clean).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas-cli-wt/cli/CLI_AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: v7 (Profiller + secrets AES 256 GCM secrets at rest ( secrets.ts) DONE. Hedef: v8 (Observability/TUI ollamas top canlı usage/metrics ( /metrics).
**[Task]** v8 (Observability/TUI ollamas top canlı usage/metrics ( /metrics) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > > "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla (CLI_AGENTS §7).
  > > Her versiyonun "done" tanımı, sonraki versiyonun ilk todo'sunu doğurur (precompute).
  > 
  > | Ver | Tema | Çekirdek | Durum |
  > |-----|------|----------|-------|
  > | **v1** | İskelet + chat | `node:util` parseArgs router, `chat` (one-shot+REPL+SSE), `doctor`, `config`, TTY/`--json`/NO_COLOR, `bin`, POSIX köprü iskelet, governance docs | ✅ DONE |
  > | **v2** | Agent sürücü + sweep | `ollamas agent` ReAct loop (`/api/agent/chat` SSE); write-onay akışı (`/api/agent/approve-write`); oturum (`/api/agent/sessions`); `--yolo`/`--safe`; + 10 v1-gap (G1-G10) | ✅ DONE |
  > | **v3** | SaaS/admin + sweep | `ollamas saas plans\|tenants\|tenant new\|keys\|key new\|revoke\|audit\|usage\|billing` → `/api/saas/*`+`/api/billing/*` (X-Admin-Token); `formatTable`; secret-once key; revoke confirm; doctor saas satırı; H1-H8 | ✅ DONE |
  > | **v4** | Bench/calibration | `ollamas bench` dual-target (mac + remote/iOS-proxy); warmup'lı TTFB/tok/s/total; `cli-bench.json` host-etiketli; `pickBest` + `--apply`; I1-I6 | ✅ DONE |
  > | **v5** | MCP client | `ollamas mcp info\|tools\|call\|upstreams\|add\|rm` — `/mcp` JSON-RPC + `/api/saas/upstreams`; guard glob + HIL gate; choke-point üzerinden çağrı | ✅ DONE |
  > | **v6** | iOS Shortcuts pack | `ollamas shortcuts build` → WFWorkflow plist (chat/status/bench/mcp-call) + recipe cards; POSIX köprü saas+mcp upstreams/add/rm; `mcp call --stream`; remote-exposure doc (tailscale) | ✅ DONE |
  > | **v7** | Profiller + secrets | AES-256-GCM secrets-at-rest (`secrets.ts`/`keystore.ts`, db.ts deseni) + `*Enc` sealed config + güvenli migration; çoklu-gateway profil (`config use`/`profiles`/`--profile`); env override korunur | ✅ DONE |
  > | **v8** | Observability/TUI | `ollamas top` canlı usage/metrics (`/metrics` prom parse + `/api/saas/usage/timeseries`); seyir-defteri.jsonl tail; terminal sparkline; `--watch` | ▶ NEXT |
  > | **v9** | Packaging | `npm link` global; opsiyonel Go tek-binary (v4 bench TTFB kazancı gösterirse); Homebrew tap; shell completion (bash/zsh) | |
  > | **v10** | Self-update + plugin | `ollamas update`; manifest-tabanlı 3rd-party alt-komut sistemi; release-please; CLI CI (`.github/workflows`) | |
  > | **v11+** | Ufuk (önceden-hesap) | Native Swift Shortcuts derinleştirme; WASM build; otonom agent loop; multi-gateway mesh kontrolü | |
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - (kayıtlı hata yok)
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon v7 (Profiller + secrets AES 256 GCM secrets at rest ( secrets.ts) kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
