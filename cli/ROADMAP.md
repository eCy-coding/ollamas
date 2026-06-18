# ollamas CLI — ROADMAP (v1 → v10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla (CLI_AGENTS §7).
> Her versiyonun "done" tanımı, sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Durum |
|-----|------|----------|-------|
| **v1** | İskelet + chat | `node:util` parseArgs router, `chat` (one-shot+REPL+SSE), `doctor`, `config`, TTY/`--json`/NO_COLOR, `bin`, POSIX köprü iskelet, governance docs | ✅ DONE |
| **v2** | Agent sürücü + sweep | `ollamas agent` ReAct loop (`/api/agent/chat` SSE); write-onay akışı (`/api/agent/approve-write`); oturum (`/api/agent/sessions`); `--yolo`/`--safe`; + 10 v1-gap (G1-G10) | ✅ DONE |
| **v3** | SaaS/admin + sweep | `ollamas saas plans\|tenants\|tenant new\|keys\|key new\|revoke\|audit\|usage\|billing` → `/api/saas/*`+`/api/billing/*` (X-Admin-Token); `formatTable`; secret-once key; revoke confirm; doctor saas satırı; H1-H8 | ✅ DONE |
| **v4** | Bench/calibration | Dual-target (Mac-native + remote/iOS-proxy) benchmark; `~/.llm-mission-control/cli-bench.json`; en verimli model/ctx/Metal flag auto-pick; `benchmark.mjs` yükselt; host-platform etiket (N-002) | ▶ NEXT |
| **v5** | MCP client | `ollamas mcp add\|list\|call\|tools` — upstream register/consume `/api/mcp/upstreams` + `/mcp`; choke-point üzerinden çağrı | |
| **v6** | iOS Shortcuts pack | `ollamas shortcuts build` → `.shortcut` (chat/bench/status); POSIX köprü tamamla (agent/saas); remote-exposure doc (tailscale/LAN + key) | |
| **v7** | Profiller + secrets | Çoklu-gateway profil; AES-GCM şifreli key store (`server/db.ts` SecureDB reuse) — v1 plaintext'i değiştir; `config use <profile>`; env override zinciri | |
| **v8** | Observability/TUI | `ollamas top` canlı usage/metrics (`/metrics` prom parse + `/api/saas/usage/timeseries`); seyir-defteri.jsonl tail; terminal sparkline; `--watch` | |
| **v9** | Packaging | `npm link` global; opsiyonel Go tek-binary (v4 bench TTFB kazancı gösterirse); Homebrew tap; shell completion (bash/zsh) | |
| **v10** | Self-update + plugin | `ollamas update`; manifest-tabanlı 3rd-party alt-komut sistemi; release-please; CLI CI (`.github/workflows`) | |
| **v11+** | Ufuk (önceden-hesap) | Native Swift Shortcuts derinleştirme; WASM build; otonom agent loop; multi-gateway mesh kontrolü | |

## v1 — DONE (kanıt)
- `cli/` : `index.ts` (router+config), `lib/{client,output,config}.ts`, `commands/{chat,doctor}.ts`, `bin/ollamas.sh`
- Testler: `tests/cli-{parser,output,chat}.test.ts` — 18 pass (saf-fonksiyon + mock-fetch)
- Full suite regression: 86 pass / 1 skip
- `package.json`: `bin.ollamas` → `dist/cli/index.cjs`; `cli` + `build:cli` script
- Canlı: `doctor --json` healthy=true (gateway/ollama/bridge); POSIX köprü curl health OK
- Choke-point: `grep -r ToolRegistry cli/` = yalnız yorum (gerçek import yok)

## v2 — DONE (kanıt)
- `cli/commands/agent.ts` + `cli/lib/io.ts` (stdin/confirm) yeni; `agent` (task/sessions/rm), write-onay akışı, `--yolo`/`--safe`
- `client.ts`: `agentStream`/`approveWrite`/`{list,get,create,delete}Session`/`ready`; baseUrl normalize (G3); stream timeout (G4)
- `output.ts`: `formatStep`/`formatDiff`; doctor 5 satır (+ready+agent, G6)
- sweep: G1 per-cmd help · G2 stdin-pipe · G5 `--version` route · G7 POSIX agent · G8 cli/README · G9 main-dispatch test · G10 `--gateway`
- Testler: `tests/cli-{parser,output,chat,agent}.test.ts` — **35 pass** (saf-fn + mock-fetch); full suite **102 pass/1 skip**
- Canlı: `doctor` 5 satır healthy (sessions=46); `agent --json` gerçek SSE thought→message→done; `agent sessions` tablo; POSIX köprü agent
- Choke-point korunur; VERSION 2.0.0

## v3 — DONE (kanıt)
- `cli/commands/saas.ts` yeni; `client.ts`: `listPlans/listTenants/listKeys/listAudit/createTenant/createKey/revokeKey/billingPreview/billingRun` + `adminHeaders` (X-Admin-Token) + `adminError` 401/403 ipucu
- `output.ts`: `formatTable` (savunmacı String-coerce, E-004); `config.ts`+`index.ts`: `saasAdminToken` (env `OLLAMAS_SAAS_ADMIN`, redaksiyon)
- sweep H1-H8: admin token config/env · formatTable · 401/403 hint · secret-once key · revoke confirm (`--yes`) · doctor saas satırı · README+help · remote-admin TLS notu
- Testler: `tests/cli-saas.test.ts` + output/parser ek — **46 pass**; full suite **113 pass/1 skip**
- Canlı (kendi izole gateway :3009, SAAS_ENFORCE=1, token=ecytest): `saas plans` hizalı tablo · `tenant new`→tnt_… · `key new` secret-once olm_… + uyarı · `keys` liste · `revoke --yes` · `usage` · `doctor` saas up plans=3 healthy; enforced gateway'de token'sız → 401 ipucu
- Choke-point korunur (`server/store` import yok); VERSION 3.0.0; **Idempotency: server'da create idempotency-key YOK → plandan çıkarıldı**

## v4 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. `cli/commands/bench.ts` — dual-target: `--target mac|remote|both`; ölçüm TTFB, tok/s, total, correctness.
2. `cli/lib/client.ts` → `generateTimed(messages, opts)` (TTFB + tok/s yakala) veya mevcut `generateStream` meta'sını kullan; her model/ctx kombinasyonu için tur.
3. `~/.llm-mission-control/cli-bench.json` yaz; host platform etiketi göm (N-002: container ≠ Mac-native).
4. En verimli model/ctx/Metal-flag auto-pick → `config` öner/yaz; `benchmark.mjs` mantığını CLI'a yükselt (reuse `bin/host-bridge/benchmark.mjs`).
5. `--json` rapor; tablo (model · ctx · TTFB · tok/s · correct).
6. Testler: bench hesap saf-fn (tok/s, TTFB derive) + mock-fetch; doctor'a değişiklik yok.
