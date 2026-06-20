# CLI_SEYIR_DEFTERI — ollamas CLI hata & öğrenme defteri

> Her döngü başında okunur (CLI_AGENTS §4). Format: `tarih · semptom · kök neden · fix · ÖNLEME KURALI`.
> Amaç: **aynı hatayı iki kez yapma.** Çapraz: `~/Desktop/ollamas/project_cortex.md`.

---

## v11 — Keychain + secrets v2 (2026-06-20)

### N-024 · macOS keychain per-USER, HOME-scoped DEĞİL
- **Gözlem**: live migrate testini temp HOME ile izole etmeyi planladım; ama `security` login keychain'i **kullanıcıya** bağlı, `HOME`'a değil. Temp HOME yalnız keyfile'ı izole eder; `writeMasterKey` gerçek login keychain'e gerçek `ollamas/master-key` servisine yazardı → kullanıcının gerçek key'iyle ÇAKIŞMA riski.
- **Fix**: live probe `read/write/deleteMasterKey`'i **TEST service** (`ollamas-test-probe`/`v11-live`) parametresiyle çağırır; gerçek `ollamas/master-key` item'ına asla dokunmaz; `afterAll` temizler. Probe **opt-in** (`OLLAMAS_LIVE_KEYCHAIN=1`) → default `npm test` keychain prompt tetiklemez.
- **ÖNLEME KURALI**: keychain canlı testinde HOME izolasyonuna GÜVENME — keychain user-scoped. Daima ayrı TEST service + cleanup + opt-in gate.

### N-025 · argv-leak on WRITE (kabul edilen tradeoff, gizleme yok)
- **Gözlem**: `security add-generic-password -w <b64key>` master key'i `ps`'te ~100ms 1 kez gösterir (`/usr/bin/security`'nin stdin/file value alternatifi yok). READ (`find -w`) sızdırmaz.
- **Karar**: zero-dep'i korumak için kabul + KEYCHAIN.md'de dürüstçe dokümante (native binding = native addon = zero-dep ihlali; keytar arşivli). `-A` (allow-any-app) ZORLAMADIK (ACL'i zayıflatırdı).
- **ÖNLEME KURALI**: güvenlik tradeoff'unu over-claim etme; maliyeti dokümana yaz, suppress etme. Secret'i argv'de SON eleman yap (`buildSecurityArgs`) → test yapı doğrular, secret erken pozisyona sızmaz.

### N-026 · key-source-agnostic seam → config/secrets'e sıfır dokunuş
- **Gözlem**: master key'in kaynağını (keyfile→keychain) değiştirmek `secrets.ts` seal/open ve `config.ts`'i etkilemedi — ikisi de yalnız 32-byte Buffer ister.
- **Doğrulama**: yalnız `keystore.ts` + yeni `keychain.ts` değişti; migrate **aynı key bytes** taşır → sealed `*Enc` okunur kalır (keyfile silinmeden önce keychain read-back doğrulanır = verify-before-destroy, N-021 disiplini).
- **ÖNLEME KURALI**: kaynak-agnostik seam (tek `loadMasterKey`) sayesinde backend swap güvenli; invariant = 32-byte. Migration'da bytes'ı ASLA yeniden üretme, taşı.

---

## v1 — İskelet + chat + doctor (2026-06-19)

### E-001 · Çift shebang → bin SyntaxError
- **Semptom**: `node dist/cli/index.cjs version` → `SyntaxError: Invalid or unexpected token` (line 2 `#!/usr/bin/env node`).
- **Kök neden**: kaynak `cli/index.ts` line1 zaten shebang içeriyordu; esbuild bunu **koruyor**. `build:cli`'a ayrıca `--banner:js='#!/usr/bin/env node'` ekledim → çıktıda iki shebang. Node yalnız **ilk** satır shebang'ını strip eder; ikincisi geçersiz JS.
- **Fix**: `build:cli`'tan `--banner` kaldırıldı. esbuild entry-file shebang'ını zaten taşıyor.
- **ÖNLEME KURALI**: esbuild bundle'da shebang için **ya** kaynak shebang **ya** banner — ikisi değil. Kaynak dosyada shebang varsa banner ekleme.

### E-002 · `terminals=[object Object]` doctor çıktısında
- **Semptom**: `doctor` bridge detail = `terminals=[object Object]`.
- **Kök neden**: bridge `/health` `terminals`'ı obje/array döndürüyor; template-string'e ham koydum.
- **Fix**: `countOf()` helper — array→length, object→key count, scalar→String.
- **ÖNLEME KURALI**: bilinmeyen API payload'ını çıktıya basmadan önce skalar-coerce et; `${obj}` template'e doğrudan obje koyma.

### N-001 (not, hata değil) · `/api/generate` → 401
- **Gözlem**: canlı testte gateway `/api/generate` 401 döndü (bu ortamda SAAS enforcement açık).
- **Karar**: CLI hatası değil — istemci 401'i temiz yüzeyledi. 401'de `OLLAMAS_API_KEY` ipucu eklendi (`chat.ts withHint`).
- **ÖNLEME/NOT**: canlı chat E2E için gateway auth durumunu önce kontrol et; key gerekiyorsa `OLLAMAS_API_KEY` set et. doctor auth gerektirmez (sağlık probu).

### N-002 (ortam notu) · "MacBook" testi aslında linux/arm64 container
- **Gözlem**: `/api/health` → `platform=linux, arch=arm64, release=…linuxkit`. Bu sekme native macOS değil, container içinde.
- **Etki**: v4 dual-target benchmark "Mac native" hedefini gerçek macOS host'ta koşmalı; container ölçümü Metal/Apple-Silicon temsili değil.
- **ÖNLEME KURALI**: benchmark sonucu yazarken host platform'unu (`os.platform/arch/release`) etikete göm; container ≠ Mac-native.

---

## v2 — Agent sürücü + completeness sweep (2026-06-19)

### E-003 · Eşzamanlı worker branch-switch → commit'siz v2 işi silindi (KRİTİK)
- **Semptom**: v2 editlerinin ortasında tüm cli/ değişiklikleri kayboldu; `index.ts` v1.0.0'a döndü, `agent.ts`/`io.ts` silindi, package.json pristine.
- **Kök neden**: bu repo'da **başka bir eşzamanlı worker** `feat/v1.3` (Postgres async store) üzerinde çalışıyor. reflog: `checkout: moving from feat/cli-v2 to feat/v1.3` + worker'ın commit'i benim `feat/cli-v2` branch'ime bindi (7e49465). Branch ana checkout'tan altımdan değişti; commit'siz working-tree değişikliklerim discard oldu. v1 commit `7f63164` git'te sağ kaldı.
- **Fix**: **izole git worktree** — `git worktree add ../ollamas-cli-wt feat/cli-v2-clean 7f63164` (temiz v1 base). Tüm v2 işi orada; `node_modules` ana repo'dan symlink. Branch-switch artık worktree'yi etkilemez. Tamamlayınca **hemen commit**.
- **ÖNLEME KURALI**: paylaşılan repo'da (eşzamanlı worker varsa) CLI işini **kendi worktree'sinde** yap; commit'siz uzun süre durma — her phase sonrası commit. Branch'i ana checkout'ta paylaşma. Başlamadan `git worktree` aç.

### N-003 (not) · agent path 401 vermedi (chat N-001 aksine)
- **Gözlem**: canlı `agent --json` 401 olmadan çalıştı (thought→message→done), oysa v1'de `/api/generate` 401 vermişti.
- **Not**: gateway auth durumu endpoint/oturuma göre değişebilir; CLI her iki halde de doğru (401→ipucu, açık→akış). Live E2E öncesi `doctor` ile durumu gör.

---

## v3 — SaaS/admin + sweep (2026-06-19)

### E-004 · `formatTable` non-string hücre → `.padEnd is not a function` (E-002 tekrarı!)
- **Semptom**: canlı `saas plans` → `saas error: (cell ?? "").padEnd is not a function`.
- **Kök neden**: `formatTable` tüm hücreleri string varsaydı; `plans[].allowed_tiers` **array** (`["safe"]`) döndü. `(cell ?? "").padEnd` array üzerinde patlar. **E-002 ile aynı sınıf hata** (bilinmeyen payload'ı ham kullanma) — ÖNLEME KURALI'na rağmen formatTable'da tekrarlandı.
- **Fix**: `formatTable` her hücreyi `String()`-coerce eder (savunmacı; çağıranlara güvenme). Tek noktadan tüm tablolar korunur.
- **ÖNLEME KURALI (güçlendirildi)**: generic render util'leri **girdiyi coerce etmeli**, çağırana güvenmemeli. Yeni bir formatter yazınca ilk satır = `String(v)` coercion. E-002 yalnız çağıran tarafı düzeltti; util tarafı da zorla.

### N-005 (ortam notu) · gateway SAAS_ENFORCE durumu reused-instance'a göre değişir
- **Gözlem**: v2'de fresh-boot gateway enforce kapalı (agent 200); v3'te reused gateway enforce **açık** (ready/agent/saas 401). CLI her iki halde doğru (401→ipucu, açık→akış).
- **ÖNLEME/NOT**: SaaS başarı yolunu kanıtlamak için **kendi izole gateway'ini farklı portta boot et** (`PORT=3009 SAAS_ADMIN_TOKEN=… SAAS_ENFORCE=1 SAAS_DB_PATH=/tmp/…`), `OLLAMAS_GATEWAY`+`OLLAMAS_SAAS_ADMIN` ile sür. Başkasının :3000 gateway'ine **dokunma** (eşzamanlı worker olabilir).

---

## v4 — Bench/calibration (2026-06-19)

### N-006 · Bench correctness prompt-echo false-positive
- **Semptom**: `bench` correctRatio=100% ama tok/s=0 — şüpheli. Default prompt `"Reply with exactly: PONG"`, correctness `output.includes("PONG")`. Prompt'un kendisi "PONG" içerdiği için model echo/tekrar etse bile **trivially** eşleşir.
- **Fix**: echo-proof default → prompt `"What is two plus two? Reply with only the number."`, expected `"4"`. Beklenen token **prompt'ta yok** → yalnız gerçek yanıt skorlar.
- **ÖNLEME KURALI**: substring-correctness benchmark'ında beklenen cevap **prompt metninde geçmemeli** (echo bypass). Deterministik soru + prompt-dışı cevap kullan.

### N-007 (ortam notu) · gateway eval-timing yüzeye çıkarmıyor → tok/s=0
- **Gözlem**: canlı bench tok/s=0; total 137ms (gerçek 8b değil). Bu container-gateway `tokensPerSec` (ollama `eval_count/eval_duration`) döndürmüyor (demo/fallback olabilir). `pickBest` null döndü (savunmacı, doğru).
- **Not**: bench FEATURE doğru (ttfb/total/json/host-etiket/tablo + unit-test'li hesap). Gerçek tok/s yalnız **Mac+native-ollama**'da dolar (`providers.ts:250`). cli-bench.json host=`darwin/arm64` (CLI Mac host'ta koşuyor) ama inference backend container → N-002 ile birlikte: host-etiketi CLI tarafını yansıtır, gateway URL raporda ayrı.
- **ÖNLEME/NOT**: throughput sayısı gerekiyorsa gateway'in gerçek ollama'ya bağlı olduğunu doğrula (`doctor` ollama up + gerçek model yüklü); demo/fallback'ta tok/s anlamsız.

## v5 — MCP client (GitHub-harvested, 2026-06-19)

### N-008 (protokol gerçeği) · `/mcp` STATELESS — initialize handshake gereksiz
- **Gözlem**: plan, MCP spec'e göre `initialize→notifications/initialized→tools/list` handshake varsayıyordu. **Canlı probe** (boot+curl, evidence-first) gösterdi ki gateway `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` = **stateless**: `tools/list` **standalone** (önce initialize YOK) tam tool listesini döndürdü. `mcp-session-id` response header'ı YOK.
- **Etki**: client `mcpRpc` = tek POST, handshake/session takibi YOK. Tahmin edilen 3-adımlı handshake yazılsaydı gereksiz 2 ekstra round-trip + olası "already initialized" hatası olurdu.
- **ÖNLEME KURALI**: dış protokol entegrasyonunda spec'e körlemesine kodlama — **önce canlı probe et** (tek istek at, davranışı gör), sonra istemciyi gözleme göre yaz. Stateless transport → handshake yok varsay, kanıtla.

### N-009 (güvenlik/robustluk) · `/mcp` Origin: göndermemek > tahmin etmek
- **Gözlem**: server `originAllowed(origin)`: `if (!origin) return true` (header'sız MCP istemcisi her zaman geçer); Origin varsa ALLOWED_ORIGINS CSV veya localhost regex ister. Plan "Origin header doğru ver" diyordu.
- **Karar**: Node `fetch` server-side **Origin eklemez** (probe: curl Origin'siz → geçti). İstemci Origin **göndermiyor** → DNS-rebinding guard'ı her config'de (ALLOWED_ORIGINS set olsa bile) geçer; Origin gönderseydik yanlış allowlist'te 403 riski.
- **ÖNLEME KURALI**: izin-tabanlı guard'da "yanlış değer < değer-yok" ise, opsiyonel header'ı **hiç gönderme** (no-Origin always-allowed yolu). Tahmin edilen header eklemek attack-surface değil ama kırılganlık ekler.

### N-010 (HIL sinyali) · tool tehlikesi = annotations.destructiveHint/openWorldHint
- **Gözlem**: tools/list her tool'a `annotations: {readOnlyHint, destructiveHint, openWorldHint}` döndürüyor (tier alanı tools/list'te YOK). `macos_terminal`/`git_commit`/`write_host_file` → destructiveHint:true. HIL gate (ollmcp pattern) bu bayrağa anahtarlandı, ayrı tier sorgusu gerekmedi.
- **Not**: `mcp call` tek tools/list çeker (hem isim doğrulama, hem --arg tip-coerce, hem danger tespiti) → tek round-trip ek maliyet, side-effect ÖNCESİ doğru tespit (post-hoc imkansız).

### N-004 (mimari sınır) · agent resume tam tool-history taşımıyor
- **Gözlem**: write-onay sonrası resume, yalnız assistant history + "approved, continue" turu gönderir; tam tool-result history server session'da.
- **Not**: server loop'u `messages` param'ından çalışır, session'ı yalnız sonda yazar → istemci-tarafı tam-history resume mümkün değil. Pragmatik resume yeterli; cap 12 round. v3+ session-load-into-loop server desteği gerekirse genişlet.

## v6 — iOS Shortcuts pack (2026-06-19)

### E-005 · POSIX köprü auth header word-split → `Bearer` (token kayıp), chat/agent'ı da sessizce bozdu
- **Semptom**: bridge smoke-test `mcp upstreams` → server `Authorization: Bearer` aldı (token YOK). Beklenen `Bearer olm_test`.
- **Kök neden**: `AUTH="-H Authorization:Bearer ${KEY}"`; sonra `curl $AUTH` (unquoted). Shell word-splitting `Bearer KEY`'i boşlukta böler → curl arg'ları `-H`, `Authorization:Bearer`, `KEY` olur; header değeri `Bearer`'a kesilir, `KEY` ayrı (yutulan) arg. **v1'den beri sessiz**: chat/agent auth'u da aynı şekilde bozuktu — yalnız enforce-açık gateway'de fark edilirdi.
- **Fix**: AUTH/ADMIN vars silindi; `ocurl()`/`ocurl_admin()` helper'ları token'ı **gerçek curl argümanı** olarak geçer (`curl -fsS -H "Authorization: Bearer $KEY" "$@"`), word-split yok.
- **ÖNLEME KURALI**: POSIX sh'da boşluk içeren değer (auth header) **asla** unquoted var'da curl'e verilmez (array yok). Helper fonksiyon + `"$@"` ile gerçek-arg geç. Bunu test eden bir smoke yoksa yaz (mock server header'ı assert etsin).

### N-011 (test gerçeği) · `spawnSync` + in-process HTTP stub = deadlock
- **Semptom**: bridge smoke-test'i sonsuza astı (>60s timeout), vitest header'da donup kaldı.
- **Kök neden**: test stub server'ı vitest worker'ının **aynı event loop**'unda; `spawnSync("sh", …)` event loop'u **bloke eder** → curl isteği gelir ama server yanıt veremez (loop meşgul) → curl bekler → spawnSync bekler → kilitlenme.
- **Fix**: `spawnSync` → async `spawn` + Promise (`child.on("close")`). Loop serbest kalır, in-process server curl'e yanıt verir.
- **ÖNLEME KURALI**: aynı Node sürecindeki bir server'a istek atan child process'i **asla** `spawnSync`/sync I/O ile çağırma — event loop'u bloke eder. Async spawn + await kullan.

### N-012 (gate düzeltme) · choke-point grep'i artık yorum-mention'larıyla eşleşiyor
- **Gözlem**: `grep -r ToolRegistry cli/` eski "= boş" konvansiyonu artık yanlış — `client.ts`/`mcp.ts`/`index.ts` yorumları (`never imports server/tool-registry`, `ToolRegistry.execute`) grep'e takılıyor. Yasanın özü = **gerçek import yok**, mention değil.
- **Fix/Not**: gerçek gate = `grep -rn --include="*.ts" "from.*tool-registry\|require.*tool-registry" cli/` → boş olmalı (`.md` mention'ları hariç; import-grep'in kendisi bile doc'ta geçince eşleşir → `--include="*.ts"` şart). Bu phase'de doğrulandı: 0 gerçek import. CLI_AGENTS §3.1 güncellendi.
- **ÖNLEME KURALI**: kanıt-grep'i yorum/dokümantasyon mention'larına duyarsız yaz (import statement'ı hedefle), aksi halde gate false-positive verir.

## v7 — Profiller + AES-GCM secrets-at-rest (2026-06-20)

### N-013 (resilience) · decrypt-failure her komutu crash ettiriyordu → degrade
- **Semptom**: canlı probe'da kayıp/yanlış key veya bozuk `*Enc` blob → `loadConfig` `SecretError` fırlattı; `chat`/`doctor` dahil HER komut stack-trace ile çöküyor, CLI kullanılamaz hale geliyor (kullanıcı dosyayı elle silene kadar).
- **Kök neden**: `open()` THROW eder (doğru — boş Bearer key göndermemek için, N-014). Ama bu istisna I/O sınırında yakalanmadan `loadConfig`'ten dışarı sızdı → her invocation fatal.
- **Fix**: `unsealOrWarn` (I/O sınırı) `SecretError`'ı yakalar → tek-satır **uyarı + recovery adımları** (set OLLAMAS_API_KEY / `config apiKey` reset / `cli.json.bak` restore) yazar ve secret'i **düşürür** (absent kabul); secret-gerektirmeyen komutlar çalışmaya devam eder, auth-gerektiren komut mevcut 401-hint'e düşer. Saf `unsealDisk` hâlâ THROW eder (testler buna dayanır).
- **ÖNLEME KURALI**: pure katman THROW etsin (doğruluk), ama I/O sınırı (config load) recoverable hatayı **yakalayıp degrade** etsin — kullanıcıya her komutta stack-trace gösterme. "fail clear, degrade gracefully" ≠ "silent-empty".

### N-014 (güvenlik tasarımı) · env-secret asla diske yazılmamalı + open() THROW
- **Gözlem**: `OLLAMAS_API_KEY` env set iken alakasız bir `config model x` → naïve `saveConfig(loadConfig())` env key'i sealed olarak diske yazardı (env-secret kalıcılaşır).
- **Fix**: `saveConfig` persistence baseline'ı `loadDiskPlain` (env-override YOK, yalnız dosya değerleri) + patch; env'den gelen secret asla seal/persist edilmez. `open()` ise db.ts'in `""`-döndür davranışından **bilerek sapar** → THROW (CLI boş key'i Bearer olarak göndermesin).
- **ÖNLEME KURALI**: secret persistence'ta env-kaynaklı değeri taban alma; yalnız dosya-state + explicit patch yaz. Decrypt başarısızlığında boş string döndürme (silent-empty = sahte-auth riski).

### N-015 (test) · in-process probe'da bozuk dosyayı sonraki adımda yeniden kullanma
- **Gözlem**: tek probe içinde önce `*Enc`'i kasten boz, sonra AYNI `$T` ile başka bir adım koş → ikinci adım bozuk blob'a çarpıp beklenmedik throw verdi (kod bug'ı değil, probe sıralaması).
- **ÖNLEME KURALI**: yıkıcı (corruption/tamper) adımları probe'un EN SONUNA koy ya da her adıma taze `mktemp -d` HOME ver; durum-bozan adımdan sonra aynı fixture'ı yeniden kullanma.

## v8 — Observability/TUI `ollamas top` (2026-06-20)

### N-016 (TUI yasası) · `--watch` SIGINT'te terminali geri yükle, yoksa bozulur
- **Risk**: alt-screen (`\x1b[?1049h`) + hidden-cursor (`\x1b[?25l`) ile girip cleanup'sız çıkılırsa kullanıcının terminali imleçsiz + alt-ekranda kalır (bozuk).
- **Fix**: `cleanupSequence()` saf fn = `CURSOR_SHOW + ALT_OFF`; SIGINT **ve** SIGTERM handler'ı bunu yazıp `exit(0)`; `tearingDown` guard çift-cleanup'ı önler. Saf fn unit-test (show-cursor + alt-off içerir).
- **ÖNLEME KURALI**: alt-screen/cursor-hide kullanan her live komut, signal handler'da terminali **mutlaka** geri yükler; restore dizisini saf fn yapıp test et. Non-TTY → loop'a hiç girme (tek snapshot).

### N-017 (consume gerçeği) · `/metrics` auth'suz, usage Bearer ister → panel-bazlı degrade
- **Gözlem**: server `/metrics` OPEN (prom-client, auth yok); `/api/saas/usage/timeseries` Bearer+scope ister. Tek "her şey ya da hiç" hata = kötü UX.
- **Fix**: metrics panel daima render (key gerekmez); usage panel best-effort `try/catch` → 401'de hint göster, gerisi çalışır. seyir-defteri.jsonl yoksa o panel atlanır.
- **ÖNLEME KURALI**: çok-kaynaklı dashboard'da her paneli **bağımsız degrade** et; bir kaynağın auth/eksikliği tüm view'i düşürmesin.

### N-018 (yaklaşıklık dürüstlüğü) · histogram p50/p90 bucket-le sınırı = yaklaşık
- **Gözlem**: prom histogram yalnız cumulative bucket sayıları verir; gerçek quantile yok. p50/p90 = percentile'ı geçen ilk bucket'ın `le` üst sınırı.
- **ÖNLEME KURALI**: türetilmiş metriği **yaklaşık** olarak işaretle (`~p90`) + doc'ta belirt; kesinmiş gibi sunma (over-claim yok). `+Inf` bucket'ı sonsuz, son sonlu le'ye düş.

## v9 — Packaging (2026-06-20)

### E-006 · Compiled binary adı `invokedDirectly` guard'ına uymuyordu → binary no-op
- **Semptom**: `bun --compile` çıktısı `dist/ollamas-darwin-arm64` çalıştırıldığında HİÇBİR ŞEY yapmadı (main() koşmadı), sessizce çıktı.
- **Kök neden**: entry-guard `process.argv[1]` regex'i yalnız `…/ollamas$` veya `index.(ts|cjs|js)$` eşliyordu. Compiled binary `ollamas-darwin-arm64` ile bitiyor → `ollamas$` eşleşmiyor → `invokedDirectly=false` → main atlanır. (E-001 dual-shebang ile aynı sınıf: paketleme-anı ile çalışma-anı isim uyuşmazlığı.)
- **Fix**: regex `ollamas[\w.\-]*$` → her `ollamas*` binary adını eşler; test-import (argv[1]=vitest) hâlâ eşleşmez.
- **ÖNLEME KURALI**: "doğrudan mı çalıştırıldı" guard'ı, üretilecek TÜM dağıtım adlarını (suffix'li binary, symlink) hesaba katsın; yalnız kaynak dosya adına bağlama. Yeni paketleme hedefi eklerken guard'ı doğrula (binary'yi gerçekten çalıştır).

### N-019 (completion) · shell prefix-filtreler, biz değil
- **Gözlem**: `__complete` candidate'leri kullanıcı girdisine göre filtrelemeye kalkmak zsh/fish eşleşmesini bozar — bash `compgen -W`, zsh `compadd`, fish kendi prefix-match'ini yapar.
- **ÖNLEME KURALI**: completion callback'i pozisyonun **TAM candidate set**'ini döndürür; prefix-filtreleme shell'in işi. `__complete` ayrıca **gizli + saf + I/O'suz** (her TAB'da koşar — config/network yükleme YASAK).

### N-020 (macOS dağıtım) · unsigned binary Gatekeeper'a takılır
- **Gözlem**: ad-hoc/imzasız compiled binary indirilince macOS "cannot be opened" (quarantine xattr) verir.
- **Fix/Not**: build script lokal binary'yi `codesign -s -` ad-hoc imzalar (lokal çalışır). İNDİRİLEN binary için `xattr -d com.apple.quarantine ./ollamas` (doc'ta). Gerçek dağıtım için notarize → v18.
- **ÖNLEME KURALI**: macOS native binary ship'lerken Gatekeeper'ı baştan planla (ad-hoc lokal, notarize dağıtım); kullanıcıya quarantine-temizleme adımını ver.

## v10 — Self-update + Plugin (2026-06-20)

### N-021 (güvenlik) · self-replace ÖNCE sha256 doğrula, sonra atomic rename
- **Tasarım**: `ollamas update` indirilen asset'i manifest sha256'sına karşı doğrular; **mismatch → abort + temp sil**, canlı binary'ye DOKUNMAZ. Doğrulama geçerse: temp **hedefin dizininde** (aynı fs — cross-device rename başarısız), `chmod +x`, macOS quarantine drop, `renameSync` ile hedefin üzerine (açık inode rename'i atlatır → çalışan binary güvenle değişir).
- **Kanıt**: canlı probe SADECE temp hedefte (gerçek binary asla); mismatch case target'ı değiştirmedi (exit 1).
- **ÖNLEME KURALI**: indirip-çalıştıran her akışta **doğrula-sonra-değiştir**; asla hedefi kısmi-yaz. Temp aynı filesystem'de (atomic rename şartı). Self-update'i gerçek binary üzerinde test ETME — temp hedef enjekte et.

### N-022 (güvenlik) · plugin = keyfi kod → checksum-gate, blind-exec YOK
- **Tasarım**: bilinmeyen komut = kayıtlı plugin ise YALNIZ dosya sha256'sı kayıtla eşleşirse exec edilir (tampered→red exit 1, kayıtsız→unknown exit 2). `$PATH` taranmaz, otomatik kurulum yok; `plugin install` = açık güven kapısı (TOFU). İsim path-traversal guard'lı (`a-z0-9-`).
- **ÖNLEME KURALI**: dış kod exec eden CLI özelliği, git'in blind `git-foo` modelini KOPYALAMA — checksum-manifest ile gate'le; tampered'ı reddet; trust'ı explicit install'a bağla.

### N-023 (choke-point ayrımı) · release download tool-call DEĞİL
- **Gözlem**: `update` manifest+asset'i standalone `fetch` ile çeker, `GatewayClient` üzerinden değil. Bu choke-point ihlali DEĞİL — release indirme bir tool çağrısı değil (gateway `/mcp` rate-limit/registry ile ilgisiz).
- **ÖNLEME KURALI**: choke-point yasası **tool yan-etkileri** içindir (`/mcp`→ToolRegistry.execute). Sürüm/asset indirme gibi non-tool ağ erişimi serbest; ama bunu kodda+doc'ta açıkça ayır ki ihlal sanılmasın.
