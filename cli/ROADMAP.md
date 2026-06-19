# ollamas CLI — ROADMAP (v1 → v10+)

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
| **v7** | Profiller + secrets | Çoklu-gateway profil; AES-GCM şifreli key store (`server/db.ts` SecureDB reuse) — v1 plaintext'i değiştir; `config use <profile>`; env override zinciri | ▶ NEXT |
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

## v4 — DONE (kanıt)
- `cli/lib/bench.ts` (saf-fn: `median/mean/aggregate/pickBest`) + `cli/commands/bench.ts` yeni
- `client.ts`: `generateStream` meta'ya `ttfbMs` (I1, ilk-chunk); `listModels` (I2, `/api/models/:provider`)
- warmup turu (I3, cold-start discard); host platform etiketi `cli-bench.json` (I4, N-002); `pickBest`+`--apply` (I5); help/README/VERSION 4.0.0 (I6)
- dual-target: `mac`(local) + `remote`(--remote-gateway, iOS-proxy) + `both`; no-silent-cap (remote URL yoksa uyar)
- Testler: `tests/cli-bench.test.ts` + chat/parser ek — **122 pass/1 skip** (v3:113)
- Canlı (kendi gateway :3009): `bench` tablo (ttfb 108-112ms, host **darwin/arm64**=CLI Mac host), `cli-bench.json` host-etiketli yazıldı, `--json` çalışır
- Bench ollama'ya doğrudan gitmez (yalnız `/api/generate`+`/api/models`); VERSION 4.0.0
- **Gotcha**: N-006 echo-proof correctness (prompt'ta beklenen token olmamalı); N-007 bu gateway eval-timing yüzeye çıkarmıyor → tok/s=0 (gerçek Mac+native-ollama'da dolar)

## v5 — DONE (kanıt)
- **GitHub harvest** (eşleşen tamamlanmış MIT projeler → zero-dep TS PORT): f/mcptools (subcmd şekli, `--params`, tool-signature render, **guard** glob), jonigl/mcp-client-for-ollama (**HIL gate** destructive/open-world), MCP spec (JSON-RPC envelope). Binary vendor yok.
- `cli/lib/mcp.ts` (saf-fn): `rpcEnvelope`/`parseRpcResponse` (SSE+JSON), `globMatch`/`filterByGuard`, `formatToolSignature`, `coerceArg`/`argsFromPairs`, `renderToolResult`, `toolDanger`.
- `client.ts`: `mcpRpc` (stateless, Accept SSE, Bearer), `mcpListTools` (cursor pagination), `mcpCallTool`, `mcpInfo`, `listUpstreams`/`addUpstream`/`removeUpstream` (tenant apiKey); `mcpError` 401/403 hint.
- `cli/commands/mcp.ts` yeni: `info|tools [--sig]|call [--params/--arg] [--yes]|upstreams|add|rm`; guard filtre; HIL gate; doctor `mcp` satırı.
- config `mcpGuardAllow`/`mcpGuardDeny` (env `OLLAMAS_MCP_ALLOW`/`DENY`); POSIX köprü `mcp tools|call`.
- Testler: `tests/cli-mcp.test.ts` (18) + output/parser ek — **full 140 pass/1 skip** (v4:122).
- **Canlı** (kendi gateway :3009): `mcp info` tools=22; `mcp tools` ⚠ danger sütunu; `--sig` imza; `mcp call list_tree` gerçek choke-point sonucu; guard deny→3 hidden; tenant-key ile `upstreams` empty→`add` ups_…→liste 1 satır; `doctor` mcp ● up.
- **Protokol gerçeği (canlı probe)**: `/mcp` **STATELESS** — initialize GEREKMİYOR (tools/list standalone döndü), session-id YOK, yanıt `text/event-stream`. **Origin gönderme** — no-Origin always-allowed (server.ts:1293), allowlist tahmininden robust.
- Choke-point korunur (`grep ToolRegistry cli/`=yalnız yorum; ollama'ya/registry'ye import yok); VERSION 5.0.0

## v6 — DONE (kanıt)
- **GitHub harvest** (eşleşen tamamlanmış projeler → zero-dep reçete PORT, binary vendor yok): drewburchfield/shortcuts-toolkit (MIT, downloadurl+header), joshfarrant/shortcuts-js (GPL, WFWorkflowActionIdentifier vocab — FİKİR-only), julian-englert/apple-shortcuts (`shortcuts sign` reçetesi — fikir-only), 0ssamaak0/SiriLLama (iCloud-link dağıtım deseni), Tailscale Serve/Funnel (resmi). Lisans disiplini uygulandı.
- `cli/lib/shortcuts.ts` (saf-fn): `plistEscape`/`plistValue` (XML plist serializer), `wfAction`/`buildWorkflowPlist`, `recipeChat/Status/Bench/McpCall`, `allRecipes`, `recipeCard`. Key-agnostic core → `__OLLAMAS_API_KEY__` placeholder default, gerçek key core'a girmez.
- `cli/commands/shortcuts.ts` yeni: `ollamas shortcuts build [--url] [--embed-key] [--out] [--import] [--json]`; saf `planArtifacts()` (disksiz test); I/O shell dir 0700 / dosya 0600 `~/.ollamas/shortcuts/`; `--embed-key` HIL (TTY-confirm, `--json` redddi); `--import` macOS re-sign (false-success YOK); localhost `--url` uyarısı. `index.ts` route+HELP+VERSION **6.0.0**.
- `cli/bin/ollamas.sh`: `mcp upstreams|add|rm` (REST `/api/saas/upstreams`, Bearer) + `saas plans|tenants|usage` (read-only, X-Admin-Token). **fix E-005** auth header word-split (`Bearer KEY` boşlukta bölünüyordu → chat/agent auth'u da sessizce bozuktu) → `ocurl`/`ocurl_admin` helper.
- `mcp call --stream`: `client.mcpCallToolStream` (notifications/progress SSE consume) + `mcp.ts` `formatProgress` saf renderer; terminal-only (`--json` altında non-stream).
- `cli/REMOTE_EXPOSURE.md`: tailscale serve (default, private) vs funnel (public opt-in risk); Bearer=gerçek auth; iOS reçete **stream:false** (Shortcuts SSE yok); `/mcp` stateless; install via `--import`+iCloud.
- **Apple imza gerçeği**: compiled `.shortcut` = signed (AEA); unsigned iOS'ta import EDİLEMEZ → v6 çift-tık iPhone binary göndermez; XML plist scaffold + macOS `shortcuts import` re-sign + reçete kartları.
- Testler: `cli-shortcuts` (16) + `cli-shortcuts-cmd` (5) + `cli-bridge-mcp` (9, async-spawn) + `cli-mcp-stream` (6) — **full 176 pass/1 skip** (v5:140). `plutil -lint` + binary1 roundtrip + canlı build (9 dosya 0600, placeholder-only) doğrulandı.
- Choke-point korunur (gerçek `tool-registry` import YOK; mention'lar yorum). VERSION 6.0.0.

## v7 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. `cli/lib/secrets.ts` (saf-fn) — `server/db.ts` SecureDB AES-GCM desenini İNCELE (import etme), `seal(plaintext, key)`/`open(blob, key)` saf round-trip; ilk test = round-trip + tamper-throws (auth tag). v6 `--embed-key` plaintext-at-rest zayıf halkası bunu doğurdu.
2. `cli/lib/config.ts` — `apiKey`/`saasAdminToken` plaintext yerine sealed blob; env override korunur; eski plaintext'i tek-yön migrate.
3. Çoklu-gateway profil: `config use <profile>`; `~/.ollamas/profiles/<name>.json`; gateway+key+model demeti.
4. Testler: secrets round-trip/tamper; profil seç/override zinciri; config redaksiyon.
