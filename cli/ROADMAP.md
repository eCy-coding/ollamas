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
| **v7** | Profiller + secrets | AES-256-GCM secrets-at-rest (`secrets.ts`/`keystore.ts`, db.ts deseni) + `*Enc` sealed config + güvenli migration; çoklu-gateway profil (`config use`/`profiles`/`--profile`); env override korunur | ✅ DONE |
| **v8** | Observability/TUI | `ollamas top` — saf prom-parser (`/metrics`) + sparkline/gauge + usage timeseries + seyir tail + `--watch` (alt-screen, SIGINT-restore) | ✅ DONE |
| **v9** | Packaging | shell completion (bash/zsh/fish) + hidden `__complete`; Bun `--compile` tek-binary (1.3.13 arm64 pin + ad-hoc codesign); Homebrew formula draft + PACKAGING.md; npm link | ✅ DONE |
| **v10** | Self-update + plugin | `ollamas update` (manifest+sha256-verify+atomic-replace); checksum-gated plugin alt-komut sistemi; release-binary CI draft; UPDATE.md | ✅ DONE |
| **v11** | Keychain + secrets v2 | v7-ertelenen macOS Keychain backend (`/usr/bin/security`) v7 key-source seam arkasında; `resolveKeySource` precedence + `config keystore` migrate (aynı key bytes) + `--insecure-storage` opt-out | ✅ DONE |
| **v12** | Node-SEA binary | **classic** `node --experimental-sea-config` (host Node 24.16, `--build-sea`/25.5 gerekmez) + postject inject + macOS remove-sign→inject→re-sign; `sea.ts` saf + `build:sea`; Bun alternate kalır, SEA canonical runtime-integrity | ✅ DONE |
| **v13** | Completions v2 + man | `__complete` dinamik VALUES (`config use`→profil, `-m`→model-cache, `-p`→provider; **TAB'da network/keychain YOK** N-032) + `man ollamas` saf troff (`mandoc -Tlint` temiz) | ✅ DONE |
| **v14** | MCP client completeness | `mcp resources\|read\|prompts\|prompt` — gateway'in resources/prompts/completion yüzeyine erişim (v5'te eksikti); aynı stateless JSON-RPC + cursor; canlı architect/coder/reviewer prompt render | ✅ DONE |
| **v15** | TUI v2 / agent-watch | `top` multi-pane (requests/latency/tools ayrı panel) + `agent --watch` canlı ReAct (alt-screen, v8 SIGINT-restore reuse) | ▶ NEXT |
| **v15+** | Ufuk (önceden-hesap) | v16 profile-sync · v17 plugin-SDK · v18 imza(minisign/cosign) · v19 i18n/a11y · v20 enterprise/GA | |
| **CLI-ID** | Sekme kimliği otomasyonu (tooling, binary-dışı) | `cli/lib/role.ts` canlı kimlik üretici + `cli/bin/role-hook.ts` UserPromptSubmit auto-inject + `.claude/settings.json` (operatör onayı); 0-manuel self-update. VERSION değişmez | ✅ DONE (settings.json operatör onayına bağlı) |

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

## v10 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-dep, binary vendor yok): deno upgrade + tj/go-update (MIT) atomic-replace+sha256; GitHub Releases API / `latest.json` manifest; jedisct1/minisign (Tier-2 sig→v18); git/gh-extension/krew plugin → **checksum-gated** (blind-exec değil) güvenli varyant.
- `cli/lib/manifest.ts` (saf): `parseManifest`/`compareSemver`/`isNewer`/`currentTarget`/`selectAsset`/`sha256Hex`. `cli/lib/plugins.ts` (saf): `parsePluginRegistry`/`findPlugin`/`isValidPluginName`(traversal-guard)+load/save/`verifyPluginFile`.
- `cli/commands/update.ts`: saf `planUpdate` + `ollamas update [--check][--manifest]`; manifest URL **explicit** (flag/env, hardcode yok, startup-network yok); standalone fetch (non-gateway, N-023); download→**sha256-verify**(mismatch→abort, canlı binary'ye dokunmaz, N-021)→temp aynı-dizin→chmod+x→macOS quarantine drop→atomic `renameSync(process.argv[1])`; node-run `.cjs`→pkg-manager uyarısı.
- `cli/commands/plugin.ts` + index fallback: `plugin list|install|remove`; bilinmeyen komut = kayıtlı plugin İSE sha256-eşleşirse exec (tampered→red, kayıtsız→unknown, N-022); TOFU install, `$PATH` taranmaz.
- `.github/workflows/release-binary.yml` draft (tag-triggered matrix→binary+sha+latest.json+gh upload); `cli/UPDATE.md`.
- Testler: `cli-manifest`(9)+`cli-plugins`(7)+`cli-update`(3) → **full 280 pass/1 skip** (v9:261). Canlı: update --check/replace/**mismatch-abort** (temp hedef, gerçek binary asla); plugin install→exec(args+stdio)→**tamper-refuse**→remove→unknown.
- Choke-point korunur (`grep --include="*.ts"` boş; release-fetch tool-call değil N-023); VERSION **10.0.0**. **Outward-facing**: binary release / manifest hosting kullanıcı kararı (CI draft+doc ship, publish YOK).

## v9 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-dep, binary vendor yok): gh CLI(38k)+npm completion+pnpm/tabtab desen → static-script+`__complete`-callback hand-roll; Bun `--compile`(oven-sh/bun, 1.3.12 arm64 "Killed:9" → **1.3.13 fix**, host'ta var); Node `--build-sea` 25.5+ ister (host 24.16 → v12'ye not); Homebrew prebuilt-binary formula deseni (deno/gh).
- `cli/lib/completion.ts` (saf): `COMMAND_TREE` tek-kaynak + `complete(words)` (pozisyon candidate-set; shell prefix-filtreler, biz değil — N-019) + `completionScript(bash|zsh|fish)`.
- `cli/index.ts`: `completion <shell>` (HELP'te) + `__complete <words>` (**gizli**, saf tree-lookup, I/O yok — her TAB'da koşar). `invokedDirectly` guard `ollamas*` binary adını da eşler (compiled binary `ollamas-darwin-arm64` aksi halde no-op).
- `cli/build-binary.sh` + `package.json` `build:binary`(bun --compile→`dist/ollamas-<os>-<arch>` gitignored, Bun≥1.3.13 guard, macOS ad-hoc codesign)+`postbuild:cli`(chmod +x npm-link). `packaging/Formula/ollamas.rb` draft + `cli/PACKAGING.md` (npm link / completion / binary / brew flow / Gatekeeper xattr).
- Testler: `cli-completion`(18) → **full 261 pass/1 skip** (v8:243). Canlı: `completion bash` script, `__complete mcp`→sub-actions, **Bun binary build+run** (`version`+`__complete`, ad-hoc signed), dist gitignored, help'te `__complete` YOK.
- Choke-point korunur (`grep --include="*.ts"` boş); VERSION **9.0.0**. **Outward-facing**: npm publish / live brew tap kullanıcı kararı (draft+doc ship edildi, publish edilmedi).

## v8 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-dep, binary vendor yok): `yunyu/parse-prometheus-text-format` (Apache-2) parser LOGIC port; `holman/spark`(6.1k)+`sindresorhus/sparkly`(MIT) sparkline algo; `sindresorhus/ansi-escapes`+`log-update`(MIT) inline escape + full-frame repaint; `bencao/terminal-clock` loop; k9s/docker-stats 2s-repaint doğrulandı. ~100 LOC desen-port.
- `cli/lib/metrics.ts` (saf): `parsePromText` (HELP/TYPE/labeled + histogram `_bucket/_sum/_count` konsolidasyon) + `counterTotal` + `histogramStats` (avg + **yaklaşık** p50/p90 bucket-le sınırından) + `samplesByLabel`. Malformed satır atlanır, throw yok.
- `cli/lib/output.ts` (saf, +): `sparkline` (▁▂▃▄▅▆▇█ min/max norm; boş→"", eşit→orta düz çizgi), `bar` (█/░ gauge clamp), `compactNum` (1.2k/3.4M).
- `cli/lib/client.ts`: `getText`+`getMetrics` (`/metrics` OPEN, auth yok) + `getUsageTimeseries` (Bearer; 401/403→OLLAMAS_API_KEY hint).
- `cli/commands/top.ts`: saf `renderDashboard`/`buildSnapshot`/`reqRateDelta`/`cleanupSequence`. Snapshot (default) + `--json`; **`--watch`** (TTY-only) alt-screen+hide-cursor, `setInterval` repaint, req/s = Δ(request count)/Δt ring-buffer sparkline, **SIGINT/SIGTERM cleanup** cursor-restore + alt-screen-exit (yoksa terminal bozulur). Non-TTY+`--watch` → tek snapshot. seyir-defteri.jsonl tail (lokal fs, yoksa atla). `cli/OBSERVABILITY.md` (p50/p90 yaklaşık, seyir local-only, SSH alt-screen caveat).
- Testler: `cli-metrics`(19)+`cli-output`(+13)+`cli-top`(15) → **full 243 pass/1 skip** (v7:211). Canlı stub-server probe: `--json` gerçek metrics parse, non-TTY render+degrade, `--watch` non-TTY refuse.
- Choke-point korunur (`grep --include="*.ts"` boş); VERSION **8.0.0**.

## v7 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-dep, binary vendor yok): Node.js crypto docs + kendi `server/db.ts:155-187` AES-256-GCM desen-PORT (import yok); `aws`/`gh`/`stripe` credential-at-rest modelleri (encrypted-file-from-start + opsiyonel keychain doğrulandı); `aws-cli` profil precedence (flag>env>active>default); macOS Keychain `security` CLI → **v11'e ertelendi** (SSH'de sessiz fail, temiz seam bırakıldı).
- `cli/lib/secrets.ts` (saf): `seal`/`open` (`iv:tag:ciphertext` hex, `authTagLength:16` iki tarafta → gcm-no-tag-length yok) + `deriveKey` scrypt. **Sapma**: `open()` THROW eder (db.ts `""` döndürür — CLI'da boş Bearer key tehlikeli).
- `cli/lib/keystore.ts`: `loadMasterKey` — `OLLAMAS_PASSPHRASE` (scrypt, key disk-dışı) yoksa `~/.ollamas/.cli_master_key` (randomBytes32, 0600, lazy → keysiz kullanıcı keyfile almaz).
- `cli/lib/config.ts`: saf `sealDisk`/`unsealDisk` (`apiKey`/`saasAdminToken`→`*Enc`, asla plaintext); load'da decrypt → **6 GatewayClient consumer'ı değişmedi**; env-secret asla persist edilmez; güvenli tek-yön migration (`cli.json.bak.<ts>` 0600 backup); bozuk/kayıp-key → uyar+düşür (her komut crash etmez).
- Çoklu profil: `~/.ollamas/profiles/<name>.json` (default=cli.json back-compat); `resolveProfileName` precedence flag>`OLLAMAS_PROFILE`>activeProfile>default; `--profile` global flag (index.ts); `setActiveProfile`/`listProfiles`; per-profil sealed izolasyon; path-traversal guard.
- `cli/index.ts`: `config use <name>` / `config profiles` / aktif-profil display + (sealed) işareti. `cli/SECRETS.md` (dürüst threat model + key kaynakları + recovery).
- Testler: `cli-secrets`(14) + `cli-config-secrets`(10) + `cli-profiles`(11) → **full 211 pass/1 skip** (v6:176). Canlı (izole HOME): migration+roundtrip+tamper+env-no-persist+graceful-degrade + profil create/switch/isolation/no-plaintext doğrulandı.
- Choke-point korunur (`grep --include="*.ts"` boş); VERSION **7.0.0**.

## v11 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-dep, binary vendor yok): 99designs/aws-vault(9k)+sorah/envchain+r-lib/keyring (MIT) → `/usr/bin/security` generic-password CRUD reçetesi + **always-degrade→null** sözleşmesi; kishikawakatsumi/KeychainAccess (MIT) ACL semantiği (fikir-only, `-A` zorlamadık); atom/node-keytar **ARŞİVLİ**+native → EKLENMEDİ (shell-out doğru).
- `cli/lib/keychain.ts` (NEW): saf `buildSecurityArgs(op,svc,acct,b64?)` (secret SON eleman → test sızdırmaz, `-U` upsert) + `keychainAvailable(platform)` (darwin-only) + I/O `read/write/deleteMasterKey(svc,acct)` `execFileSync("/usr/bin/security",…)` 5s timeout, ANY error→null/false.
- `cli/lib/keystore.ts` (MODIFY): saf `resolveKeySource(env,hasKeyfile,keychainOk,marker)` precedence (passphrase>explicit-env>marker>**existing-keyfile back-compat**>keychain-default>file); `loadMasterKey` bağlandı (keychain miss→generate+store; write-fail SSH/locked→keyfile fallback, **asla throw**); `.keystore` marker (sealed config DIŞINDA); `describeKeystore`+`migrateKeySource` (aynı key bytes; keychain-switch **verify-before-destroy** N-021; passphrase-set→reddet).
- `cli/index.ts` (MODIFY): global `--insecure-storage`→`OLLAMAS_KEYSTORE=file`; `config keystore [keychain|file]` show/migrate; HELP. `completion.ts`: `config keystore` + `--insecure-storage`. **`config.ts`/`secrets.ts` DEĞİŞMEDİ** (key-source-agnostic — v11'in tüm güvenliği bu).
- Testler: `cli-keychain`(8 saf)+`cli-keystore-source`(12 precedence matrisi)+parser/completion ek → **full 302 pass/1 skip** (v10:280). `cli-keychain-live`(3, **opt-in** `OLLAMAS_LIVE_KEYCHAIN=1`, macOS-guard, TEST service): canlı M4 keychain write→read **32-byte tam sadakat**→delete→null + `-U` upsert; TEST item temizlendi, **gerçek `ollamas/master-key` dokunulmadı**.
- Choke-point korunur (`grep --include="*.ts" "from.*tool-registry" cli/` boş); VERSION **11.0.0**. `cli/KEYCHAIN.md` (kaynaklar+precedence+dürüst argv-leak/ACL notu+migrate+non-breaking). **Gotcha**: N-024 keychain per-USER (HOME-scoped değil) → live test TEST-service zorunlu; N-025 argv-leak-on-write (`security` stdin-yok, kabul+dokümante, READ sızdırmaz).

## v12 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-RUNTIME-dep): Node.js resmi SEA (`node:sea`+`--experimental-sea-config`, MIT) **classic flow** — host Node 24.16 yeterli, `--build-sea`(25.5) GEREKMEZ; **nodejs/postject** (MIT, build-time devDep) blob inject; in-repo `build-binary.sh` codesign/target/dist-gitignore aynalandı; Bun `--compile` (v9) **alternate korundu**.
- `cli/lib/sea.ts` (NEW saf): `seaConfigObject`+`SEA_FUSE`(resmi sentinel)+`postjectArgs`(testable argv, macho-segment off-macOS optional)+`seaOutName`(build-binary.sh ile aynı ad). `sea-config.json` (kök) + `cli/build-sea.sh` (bundle→`--experimental-sea-config` blob→`cp node`→macOS **remove-sign→postject NODE_SEA inject→re-sign**→verify) + `build:sea` script + `postject` devDep.
- `cli/index.ts` `invokedDirectly` **SEA-aware** `isSea()` — Node SEA'da `argv[1]` script DEĞİL (ilk user arg) → isim-regex tek başına binary'yi no-op ederdi (**N-029**). VERSION 11.0.0→**12.0.0**.
- Testler: `cli-sea`(7 saf) → **full 324 pass/4 skip** (v11-set:317). **Canlı macOS build** (`npm run build:sea`): blob→inject→ad-hoc-sign→`dist/ollamas-darwin-arm64 version`==12.0.0 + `__complete mcp`→sub-actions + help; dist gitignored.
- Choke-point korunur; zero-RUNTIME-dep (`node dist/cli/index.cjs` hâlâ saf built-in, postject yalnız devDep). **Gotcha**: N-029 SEA-argv1-yok→isSea()-guard-şart; N-030 macOS-imzalı-binary-postject-öncesi-remove-sign-sonrası-re-sign; N-031 postject-build-time-devDep-runtime-zero-dep-korunur. **Outward-facing**: release upload kullanıcı kararı (release-binary.yml SEA target draft, publish YOK).

## v13 — DONE (kanıt)
- **GitHub adoption** (lisans disiplinli, zero-RUNTIME-dep): git/gh + cobra ValidArgsFunction (dinamik-completion desen-only, tool-candidate-döndür-shell-filtreler); npm `~/.npm` cache deseni (TTL); git/npm man yapısı + **mandoc** (BSD, host'ta /usr/bin/mandoc) doğrulama; ronn/marked-man **EKLENMEDİ** (saf troff jeneratör).
- `cli/lib/providers.ts` (NEW): `PROVIDERS` tek-kaynak (6 sağlayıcı). `completion.ts` `complete(words, dyn?)` SAF + `DynamicValues{profiles,models,providers}` enjekte (`-m/--model`→models, `-p/--provider`→providers, `config use`→profiles; geri-uyumlu dyn-yok→eski).
- `cli/lib/modelcache.ts` (NEW): `~/.ollamas/models.json` TTL (saf parseModelCache/selectModels/mergeModelCache + best-effort I/O). `index.ts` `__complete` dyn'i **LOKAL diskten** toplar — provider env'den (config-unseal YOK→keychain-5s-timeout-YOK N-032), profiller plain `listProfiles`, modeller cache. `bench` listModels sonrası `writeModelCache` (0-manuel populate).
- `cli/lib/man.ts` (NEW saf): `generateManPage`+`troffEscape`(backslash/hyphen/leading-dot) → `.TH/.SH NAME/SYNOPSIS/COMMANDS/ENV/OPTIONS/SEE ALSO`; `buildManPage` COMMAND_TREE'den; `ollamas man` komut + completion/HELP. `.PP`-after-`.SH` düzeltildi + <80b → `mandoc -Tlint` **TEMİZ**.
- Testler: `cli-completion-dynamic`+`cli-modelcache`+`cli-man` → **full pass** (v12-set:324→+). Canlı: `__complete config use`→default, `-p`→6 provider, `-m`→boş(cache yok), `ollamas man | mandoc -Tlint` temiz, TAB'da network/keychain yok (5s timeout altında).
- VERSION 12.0.0→**13.0.0**; choke-point korunur; zero-RUNTIME-dep. **Gotcha**: N-032 `__complete` keychain/network-tetikleme-YASAK→env+cache+plain-disk; N-033 troff `.PP`-after-`.SH`-redundant→ilk-paragraf-bare; N-034 model-completion-cache-populate-via-bench (manuel değil ama bench-bir-kez-koş).

## v14 — DONE (kanıt)
- **Kritik-gap tespiti** (precompute TUI-v2 idi → "gereksiz işle uğraşma, critical tespit et"): gateway `server/mcp/server.ts` resources/list+read, prompts/list+get, completion/complete sunuyor (capabilities tools+resources+prompts+completions) ama CLI v5 yalnız tools/upstreams destekliyordu → **MCP yüzeyinin yarısı erişilemezdi**. v14 bu gerçek boşluğu kapatır (polish değil). TUI-v2 → v15.
- **Adoption** (lisans disiplinli, zero-dep): MCP spec JSON-RPC (resources/prompts metod-string'leri) + mevcut in-repo v5 `mcpListTools`/`mcpRpc` plumbing reuse (cursor pagination, stateless, SSE+JSON). Yeni dep yok.
- `cli/lib/mcp.ts` (+saf): `McpResource`/`McpPrompt` tip + `renderResourceContents`(text raw/blob özet) + `renderPromptMessages`(role:text chain) + `formatPromptSignature`(req/opt) + `promptArgsFromPairs`(string-map, coercion-yok). `client.ts`: `mcpListResources`/`mcpReadResource`/`mcpListPrompts`/`mcpGetPrompt` (tools ile aynı stateless+cursor). `commands/mcp.ts`: `resources|read|prompts [--sig]|prompt` + HELP; completion mcp sub-actions.
- Testler: `cli-mcp-resources`(saf render + mock-fetch round-trip/pagination) → **full 363 pass/4 skip** (v13:350). **Canlı** (gateway :3399 boot): `mcp prompts`→3 gerçek (architect/coder/reviewer+args), `--sig` imza, `mcp prompt architect --arg task=…`→**gerçek message-chain render** (task interpole), `resources`→0 (workspace boş=beklenen, zarif). VERSION 13.0.0→**14.0.0**.
- Choke-point korunur (registry import YOK, /mcp choke-point üstünden); zero-RUNTIME-dep. **Gotcha**: N-035 resources-boş≠hata (workspace-bağlı, zarif-0-satır); N-036 prompt-args-string-spec-coercion-yok (tool-args'tan farklı).

## v15 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. `top` multi-pane: `cli/commands/top.ts` `renderDashboard` → çoklu panel (requests | latency | tool-calls ayrı kutu); v8 saf-renderer + sparkline reuse.
2. `agent --watch`: canlı ReAct akış görünümü (alt-screen, v8 SIGINT-restore N-016 deseni); non-TTY→tek-snapshot degrade.
3. İlk check = multi-pane render saf-test (fixture metrics) + non-TTY degrade; agent-watch SIGINT cursor-restore.
4. Testler: panel-layout saf; watch-loop cleanup.
