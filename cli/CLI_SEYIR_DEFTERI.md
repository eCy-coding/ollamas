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

### N-004 (mimari sınır) · agent resume tam tool-history taşımıyor
- **Gözlem**: write-onay sonrası resume, yalnız assistant history + "approved, continue" turu gönderir; tam tool-result history server session'da.
- **Not**: server loop'u `messages` param'ından çalışır, session'ı yalnız sonda yazar → istemci-tarafı tam-history resume mümkün değil. Pragmatik resume yeterli; cap 12 round. v3+ session-load-into-loop server desteği gerekirse genişlet.
