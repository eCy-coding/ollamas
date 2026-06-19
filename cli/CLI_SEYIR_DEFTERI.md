# CLI_SEYIR_DEFTERI — ollamas CLI hata & öğrenme defteri

> Her döngü başında okunur (CLI_AGENTS §4). Format: `tarih · semptom · kök neden · fix · ÖNLEME KURALI`.
> Amaç: **aynı hatayı iki kez yapma.** Çapraz: `~/Desktop/ollamas/project_cortex.md`.

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
