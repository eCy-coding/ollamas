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
