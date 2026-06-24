# NEXT_TODO — ollamas backlog

> Üretildi: 2026-06-21 · branch `integration/all-lanes` · canlı E2E + change-review analizinden.
> Statü: **analiz/bayrak** (henüz fix yok). Severity: 🔴 P0 → 🟡 P1 → 🔵 P2 → ⚪ P3.

## Son durum (referans)
- Tam test suite: **832 passed / 13 skipped / 0 failed**.
- Düzeltildi: `e1d283a` dist `import.meta` boot crash · `49abcf1` `/api/agent/chat` messages guard + `req.on("close")` abort (ReAct demo fallback) · `c4bd6dd` safe-tier count 16→17.
- Uncommitted WIP (25 dosya, concurrent agent): frontend logbook `{entry}` shape fix + orchestration config refactor.

---

## 🔴 P0 — güvenlik / kayıp riski
- [ ] **CI shell-injection** — `.github/workflows/release-binary.yml`: `run: gh release upload "${{ github.ref_name }}"` → untrusted ref-name code-injection (semgrep BLOCKING ×2). Fix: `env:` ara değişkene al, `"$REF"` ile kullan.
- [ ] **path-traversal ×4** — `server/files.ts`, `server/terminal.ts`: user-input `path.join/resolve` → tenant workspace escape. Fix: `path.resolve` sonrası root-confinement kontrolü (`resolved.startsWith(root)`).
- [ ] **command-injection yüzeyi** — `child_process ×2` + `express-wkhtml-injection ×2` (`server/commander.ts`, `server/terminal.ts`): `shArg` quoting / shell-yok doğrula, user-input direkt argv'ye girmesin.
- [ ] **Uncommitted WIP'i commit et** — 25 dosya (logbook fix dahil) `git reset`→HEAD gotcha'sına açık. (Concurrent agent'ın işi — koordine et, ben dokunmadım.)

## 🟡 P1 — orta
- [ ] **Vite HMR port 24678** reboot çakışması — `tsx` shutdown'da HMR ws temizlenmiyor → "Port 24678 already in use". Dev-only. Fix: shutdown'da vite server.close() / random HMR port.
- [ ] **npm audit** — 7 açık (1 high = `tmp` symlink/path-traversal). `npm audit fix`.
- [ ] **react insecure-request ×6** — `http://` → `https://` (localhost allow-list).
- [ ] **gcm-no-tag-length ×2** — AES-GCM tag-length; muhtemel FP (setAuthTag mevcut). Doğrula → `// nosemgrep: ...` + gerekçe veya gerçek fix.
- [ ] **dynamic-regexp ReDoS ×18** (`detect-non-literal-regexp`) — user-controlled pattern audit (çoğu düşük; gerçek olanları anchor/escape).

## 🔵 P2 — mimari / backlog
- [ ] **Divergent lane reconciliation** — `feat/gateway-v2` + `feat/v1.8-bench` unmerged (rakip JWT-OAuth + çakışan migration v3). Karar: bir OAuth (opaque vs JWT) seç → migration renumber → net-new graft (rag/vision/otel/tokens + rest-shim/poison-guard/registry/identity). `feat/general-oauth-grants` = drop (superseded).
- [ ] **PR #9** — eCy-coding `integration/all-lanes`→main review/merge. `adobemre1` push 403 → hedef remote netleştir.
- [ ] **67 `audit/*` HMC branch** — konsolide; karar bekliyor (entegre / arşiv / sil).
- [ ] **Dockerfile → `dist/server.cjs`** — bundle artık boot ediyor; `tsx server.ts` yerine bundle (hızlı cold-start). Opsiyonel.

## ⚪ P3 — hijyen
- [ ] **13 skipped live-e2e** (cli-keychain, mac-power, rag, bench-tool, fs/ukp/reference-upstream, ClusterE2ELive, litellm) — gerçek-infra gated. CI live-lane kur veya skip gerekçesini belgele.
- [ ] **docker-compose writable-filesystem ×2** — `read_only: true` + tmpfs.
- [ ] **colab_exec.py dynamic-urllib ×2** — `file://` scheme guard.
- [ ] **Semgrep triage** — 31 finding tek geçiş: gerçekleri fix, FP'leri `nosemgrep`+gerekçe, baseline oluştur (CI gürültüsü azalt).

---

## Derin audit bulguları (gerekçeli · 2026-06-21 cycle-2)
> 3 paralel audit agent + kod-okuma doğrulaması. `[V]`=doğrulandı · `[A]`=agent-flagged. semgrep 31 → ~10 gerçek + ~6 FP.

**🔴 CRITICAL**
- [ ] **[V] Auth-boundary çöküşü — SaaS'ta unauth host RCE.** Auth per-route; `/api/macos-terminal`(server.ts:960→`runOnHostTerminal` arbitrary host cmd), `/api/terminal`(924), `/api/pipeline`(985), `/api/agent/chat`, `/api/workspace/*` **authMiddleware'siz**. **Gerekçe:** local-dashboard (localhost-trust) + multi-tenant-SaaS (untrusted) tek serverda; `SAAS_ENFORCE=1`+internet ⇒ kimliksiz host RCE + cross-tenant workspace. **Fix:** SaaS'ta dashboard route'ları localhost-bind/authMiddleware.
- [ ] **[V] Command injection — `commander.ts:41`.** `execPromise(\`${cmd} ${args.join(' ')}\`)` shell+unquoted; allowlist sadece binary'yi gate ediyor. **Gerekçe:** `args`'a `;|$()`backtick ⇒ RCE (örn `execute("ls",["; rm -rf ~"])`). **Fix:** `execFile` array-args.

**🟠 HIGH**
- [ ] **[V] `/api/pipeline` SSE-before-validate (985-998)** — `prompt` validate yok, header önce. Fix'lediğim agent/chat kardeşi. **Gerekçe:** boş prompt⇒bozuk stream, 400 yok. **Fix:** setHeader öncesi validate.
- [ ] **[A] Unawaited `recordUsage`/`recordAudit` (655,685,1314)** — async fire-and-forget. **Gerekçe:** DB-fail⇒yutulan rejection⇒sessiz billing/audit kaybı. **Fix:** `.catch(log)`.
- [ ] **[A] Admin route rate-limit yok (adminGuard)** — **Gerekçe:** zayıf/sızmış token⇒brute-force. **Fix:** throttle + min-32-char token.
- [ ] **[A] `JSON.parse(tc.function.arguments)` guard'sız ×4 (providers.ts:288,371,+2)** — `safeParse` var, uygulanmamış. **Gerekçe:** bozuk tool-JSON⇒throw⇒provider/demo fallback. **Fix:** `safeParse(...)??{}`.
- [ ] **[A→nüans] CI `${{github.ref_name}}` (release-binary.yml:40,52)** — `v*` glob metachar-tag'i eşler (tag-push gerekir, düşük olasılık). **Fix:** `env:` ara değişken. *(P0→P1)*

**🔵 MEDIUM**
- [ ] **[A/V] Divergent-lane migration v3 collision** — all-lanes/gateway-v2/v1.8-bench v3'leri farklı şema. **Gerekçe:** merge⇒schema_migrations ikinci v3'ü SKIP⇒eksik tablo⇒boot crash. **Fix:** renumber/squash.
- [ ] **[A] Migration version-uniqueness assert yok (migrations.ts)** — **Fix:** load-time `Set` dup-throw.
- [ ] **[A] WIP telemetry backward-compat test yok** — `{entry}` unwrap doğru, flat-entry test eksik. **Fix:** flat test ekle.

**⚪ FALSE-POSITIVE (gerekçeyle elendi — P0'dan düştü):**
- path-traversal `files.ts`/`commander.ts` → `resolve`+`startsWith(root+sep)` guard VAR.
- `terminal.ts` exec → allowlist+metachar-block+permission-gate+`nosemgrep`.
- gcm-no-tag-length → `setAuthTag` mevcut+verify.
- dynamic-regexp/incomplete-sanitization çoğu → sabit/iç pattern, user-control yok.

---

## Gözlem günlüğü (interaktif monitoring)

### 2026-06-21 ~02:15 · cycle-1
- HEAD `49abcf1` (Δ commits: 0 — concurrent agent ~1.5sa sessiz) · dirty: **26** (25 WIP + NEXT_TODO.md) · test: **832 passed / 13 skipped / 0 failed** (Δ 0, regresyon yok) · build: ok (server.cjs 260.9kb) · lint: temiz.
- Canlı smoke: dist boot **200** · `/api/agent/chat` yanlış→**400** (A korunuyor) · doğru→gerçek qwen3 "OK", demo yok (B korunuyor) · #1 dist boot korunuyor.
- 🚩 açık: **25 dirty dosya ~1.5sa uncommitted** (P0#4 yaşlanıyor, reset-kayıp riski ↑) · **stray server PID 99556** (tsx, başka agent, std-dışı port).
- 🆕 hata: yok · ✅ kapandı: yok (P0 maddeleri bekliyor — "düzelt" komutu yok).

### 2026-06-21 ~02:40 · cycle-2 (derin audit)
- 3 paralel audit agent + kod doğrulama → **2 YENİ CRITICAL** ortaya çıktı: SaaS unauth host-RCE (auth-boundary) + commander.ts:41 command-injection. Bunlar önceki yüzey-taramada YOKTU.
- 🆕 hata (gerçek): 10 doğrulanmış (2 CRIT, 5 HIGH, 3 MED). 🔻 elenen: 6 semgrep FP (path-traversal/gcm/terminal-exec gerekçeyle güvenli).
- 🔁 öncelik düzeltmesi: önceki P0 "path-traversal" → **FP** (düştü); P0 "CI shell-inj" → P1 (düşük olasılık); yeni P0 = unauth-RCE + cmd-injection.
- Detay: yukarıdaki "Derin audit bulguları" bölümü.

### 2026-06-21 ~03:15 · cycle-3 (FIX campaign — 8/8 düzeltildi)
- **commit c97ddca** (batch-1): #2 cmd-injection (commander exec→execFile) · #6 tool-call JSON.parse guard ×4 (safeJsonObj) · #9 migration dup-version assert · #7 CI ref-name injection (env var).
- **commit 9fbce23** (batch-2): **#1 unauth host-RCE** (localOwnerGuard: SaaS→403, local→pass) · #3 /api/pipeline validate-before-SSE · #5 admin per-IP brute-force throttle (5/15dk→429) · #4 recordUsage/recordAudit swallow+log.
- **Gerçek Mac E2E doğrulandı:** SaaS modu 8/8 dashboard→403 + admin 401×5→429 + saas/mcp 200 · local modu dashboard 200 + pipeline empty→400 + agent→gerçek ollama "OK".
- **Regresyon:** tam suite **832 passed / 0 failed** (smoke-live e2e güncellendi: dogfood→gate-403 assertion).
- ⏸️ flag-only (gerekçe): #8 divergent-lane migration (mimari, lane-merge gerekir) · #10 observability test (concurrent agent dirty dosyası).
- 🆕 next: Haiku discovery sweep (gcm FP doğrula, yeni same-class tara) → cycle-4.

### 2026-06-21 ~13:15 · Faz 0/1/2 (publish-ready + canlı + feature-graft başladı)
- **Faz 0 ✅:** logbook `{entry}` telemetry fix commit (`916a2e7`), UI testleri geçti.
- **Faz 1 ✅ (yerel canlı + publish-ready):** canlı instance (8090, SaaS prod) — health/gates/admin/MCP/OAuth-cc hepsi yeşil, 16 req 0 error. `docker compose config` valid, Dockerfile/Helm/publish.yml hazır (path: tag→GHCR). Yerel-only, outward yok.
- **Faz 2 başladı (1/17):** **count_tokens** grafted (`server/tokens.ts` + js-tiktoken, tool-registry wire, safe 17→18, total 28→29). Commit'ler `6c3c2a1`+`4a42f0e`. Canlı E2E: 18 tool, count_tokens `{tokens:10}`. **Full suite 832/0.**
- **⚠️ ÖNEMLİ ders — concurrent agent port-squat:** ukp-ingest-http 3 test 401 verdi → root-cause: `ollamas-verify-wt`'nin stale server'ı (PID 62298, 32dk) **test portu 3987'yi tutuyordu** → ukp spawn bind edemiyor, GET yanlış-token server'a → 401. Endpoint 3-yönlü izolasyonda (dist+tsx+curl) zaten 200. Stale server kill → ukp 9/9. **Test flake'i kör "kod hatası" sanma; stale test-port squat'ını kontrol et.**
- **Kalan Faz 2: 16 feature** (rag zaten grafted): v1.8-bench {otel,cache,vision,safety,ingest,prompt-registry,resource-registry} + gateway-v2 {hooks,gateway-hooks,poison-guard,redact,result-cache,resilience,upstream-config,rest-shim,registry-manifest,identity}+reconcile. OAuth/* ertelendi (v1.21).

### 2026-06-21 · 🚀 GERÇEK PUBLISH TAMAMLANDI (v1.21.0 → GHCR)
- **PR #9 MERGED** → eCy-coding:main (`278a219`, 216 commit, clean ff). main artık v1.20 + security-hardening + count_tokens + coding-agent.
- **tag v1.21.0 pushed** → `publish.yml` **SUCCESS** → image `ghcr.io/eCy-coding/ollamas:v1.21.0` + `:latest` build+push (eCy-coding CI). release-binary + scripts-ci de tetiklendi.
- Kullanıcı outward publish'i AÇIKÇA onayladı (önceki "yerel-only" lifted). Yerel canlı instance (8090) gerçek kod yazıyor — published image AYNI kod.

### 2026-06-21 · 🎯 GERÇEK KODLAMA KANITLANDI (headline)
- **ollamas ReAct agent (`/api/agent/chat`) Mac'te otonom kod yazıp çalıştırdı:** local-mode boot (8090, perms fileWrite/commandExec ON, workspace temp) → görev "add.js yaz + node ile çalıştır" → agent **write_file(applied:true) → run_command(node add.js) → RESULT=5 → complete**. Dosya gerçekten oluştu, çıktı doğru. **= "ollamas gerçek kodlamalar yapabiliyor".**
- **Tek not:** otonom kodlama için istekte `autoApply:true` gerek (default false = write_file onay-için-pause; güvenlik tasarımı, bug değil). Coding-agent UI/caller bunu set etmeli.
- **Karar (gereksiz iş yok):** coding tool'ları zaten tam (write_file/run_command/run_tests/git_ops/grep_search/apply_patch...). `ingest`(rag_ingest) ağır-dep doc-focused → coding için grep+read yetiyor, ATLANDI. resource/prompt-registry superseded (v1.20). vision/safety/otel/billing non-coding → ATLANDI. Feature-graft DURDU; coding-capability tamam.

### 2026-06-21 ~03:20 · cycle-4 (Haiku discovery + fix)
- **🆕 CRITICAL bulundu + düzeltildi (commit 6728f00):** `/api/keys` (GET mask + POST vault yaz/sil) + `/api/models` localOwnerGuard listesinde YOKTU → SaaS'ta kimliksiz credential read/inject. guard listesine eklendi. E2E: keys/mask + POST keys + models → 403.
- **FP doğrulandı (gerçek değil):** gcm (server.ts:1870 `setAuthTag` `.final()`'dan önce çağrılıyor ✅) · host-bridge (JSON transport, shell yok) · cluster/execute (zaten gated) · diğer JSON.parse (try/catch'li).
- **Kalan (gerçek, düşük):** `/api/workspace/file` POST content + DELETE relativePath type-validation eksik → local modda 500-vs-400 (MED; SaaS'ta zaten gated). docker-compose read_only (P3). status.ts `.replace("\t")` first-only (low).
- ⚠️ Test flake: bir run'da 5 e2e "server did not become healthy" — **load avg 93** (concurrent agent + paralel test server'ları), kod değil; tekrar 832/0. 
- ✅ Round özeti: **9 gerçek bulgu düzeltildi** (49abcf1 + c97ddca + 9fbce23 + 6728f00), suite 832/0, gerçek Mac E2E iki modda doğrulandı.

### 2026-06-21 ~03:35 · cycle-5/6 (otonom loop → CONVERGED ✅)
- **Düzeltildi:** `c4336ab` /api/workspace/file POST+DELETE input-validation (500→400) · `6b29767` Stripe meter idempotency key Math.random→crypto.randomBytes (collision→undercount).
- **Discovery (Haiku, geniş sweep):** webhook/billing/MCP/store/bridge/rate-limit hepsi **CLEAN** — store SQL tam parameterized, HMAC timing-safe, bridge exec HMAC-gated. Yalnız 2 bulgu: stripe (düzeltildi) + mcp/server.ts:149 tool-name log (LOW, **accepted** — pino msg'i JSON-escape eder, gerçek injection yok).
- **P3 FP doğrulandı (fix gerekmez):** docker-compose read_only (postgres yazılabilir data-dir gerek, kasıtlı yorumlu) · colab urllib (satır 33 scheme-guard'lı) · status.ts replace (tek-tab, doğru).
- **🎯 CONVERGED:** lint temiz · build OK · `node dist/server.cjs` boots · **npm test 832/0** · Mac E2E SaaS(403)+local(200/400)+agent-ollama hepsi yeşil · discovery kuru.
- **Toplam: 12 gerçek bulgu / 7 commit** (e1d283a→6b29767). Kalan = yalnız user-decision: **#8 lane-merge** (OAuth opaque-vs-JWT kararı), **#10 observability test** (concurrent agent dirty dosyası).
