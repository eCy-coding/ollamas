# ODYSSEY O7 — Deploy: Multi-Service Compose + Native Launchers + PWA/Service-Worker + GHCR Publish

> **Odyssey planı** — ollamas'ı odysseus-kalitesinde self-hosted AI-workspace'e evrimleştirme.
> Bu dosya **O7 (Deploy / Boot / Docker / PWA)** kapsamını kaplar. Dil: TR · kod/komut/dosya-yolu: EN.
> **Doğrulama disiplini:** her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek koduna karşı Read/Grep ile doğrulandı (aşağıda dosya:satır referansları, 2026-07-10 kod-okuması).

---

## 1. Kapsam ve Hedef

**O7 = 4 alt-modül:**

| # | Alt-modül | odysseus emsali | ollamas mevcut | Δ (delta) |
|---|-----------|-----------------|----------------|-----------|
| O7.1 | **Multi-service Docker Compose** (app + vector + search) | `odysseus:7000` + ChromaDB:8100 + SearXNG:8080 + ntfy:8091, tümü 127.0.0.1-bound | **Kısmi** — tek-servis `mission-control` + opt-in `postgres` profili | vector/search servislerini **profil**-arkası ekle |
| O7.2 | **Native launcher scripts** (macOS / Linux / Windows) | `start-macos.sh` (Metal-GPU) + `launch-windows.ps1` + Linux native | **Kısmi** — `start.sh` (macOS-öncelikli, **Docker-zorunlu**); Linux/Windows native YOK | native/Docker-suz boot yolu + platform scriptleri |
| O7.3 | **PWA / service-worker** (installable + offline shell) | `static/sw.js` service-worker + `manifest.json` installable | **VAR ve olgun** — `vite-plugin-pwa` konfigüre (SW + manifest auto-gen) | manifest/SW **etkin doğrula** + lighthouse gate |
| O7.4 | **GHCR image publish + signed native binary** | (odysseus: compose image + release) | **VAR** — `publish.yml` (GHCR) + `release-binary.yml` (minisign SEA/Bun) | parity zaten karşılandı; compose'a vector/search image'leri ekle |

**Kabul kriteri (üst düzey):** `docker compose --profile full up -d --wait` ile app + vector + search üç servisi de 127.0.0.1'e bağlı ayağa kalksın; harici servis kurulu değilken (SearXNG/ChromaDB down) app **honest-empty** ile GREEN boot etsin (03-ui K6, roadmap ui-K8); PWA lighthouse ≥ eşik + `/api/health` yeşil; native launcher Docker-suz da (macOS/Linux) app'i açsın.

---

## 2. Mevcut Durum (kanıt-temelli, kod okundu)

> **Dosya-yolu netliği:** Ana Express sunucusu **repo-kökündeki `server.ts`** (163k, `package.json` `dev: tsx server.ts`). Deploy artefaktları repo-kökünde: `Dockerfile`, `docker-compose.yml`, `start.sh`, `vite.config.ts` + `.github/workflows/`.

### 2.1 Docker imaj + compose — VAR (tek-servis + opt-in postgres)

- **`Dockerfile`** (kök, `Dockerfile:1-65`): dual-stage `node:24-slim`. Stage-1 (`builder`, `:2-16`) `npm ci` + `npm run build`; Stage-2 (`runner`, `:19-64`) production deps + system `chromium` (puppeteer için, `:28-32`), non-root `nodeapp` (uid 1001, Faz 9A hardening `:51-54`), `EXPOSE 3000` (`:56`), `HEALTHCHECK` node-native `fetch('http://127.0.0.1:3000/api/health')` (`:60-61`), `CMD ["tsx","server.ts"]` (`:64`).
- **`docker-compose.yml`** (kök, `docker-compose.yml:1-96`): **tek-servis** `mission-control` (`:4`).
  - **127.0.0.1-bound**: `ports: "127.0.0.1:3000:3000"` (`:10-11`) — odysseus'un localhost-only desenine **zaten uygun**.
  - `env_file: .env` (`:12-13`) + inline env (OLLAMA_HOST=`host.docker.internal:11434` `:17`, Metal-GPU kalibrasyonu `OLLAMA_NUM_GPU=999`/`NUM_THREAD=12`/`KEEP_ALIVE=30m` `:19-22`).
  - **Volume persist**: `~/.llm-mission-control:/home/nodeapp/.llm-mission-control` (vault + master key + saas.db, `:43-46`).
  - `healthcheck` (`:50-55`) + `stop_grace_period: 30s` (drain, Faz 13A `:56-58`) + resource limits (2 cpu / 4G `:61-65`).
  - **Opt-in `postgres` servisi** (`:71-92`): `profiles: ["postgres"]` (`:73`), `postgres:17`, `no-new-privileges` (`:78-79`), named volume `ollamas-pgdata` (`:86-87`, `:94-95`), 127.0.0.1:5432-bound (`:84-85`). v1.3 çok-replika async store için (`DATABASE_URL` set edilince).
- **`.dockerignore`** (`node_modules`, `dist`, `.git`, `.env*`, `*.log`) — build context yalın.
- **`deploy/` alt-dizini VAR**: `deploy/helm/ollamas` (Helm chart), `deploy/k8s/` (`ollamas.yaml` + `migration-job.yaml` + README), `deploy/litellm/` (litellm.config.yaml). K8s/Helm yolu ayrı — O7 **compose + native**'e odaklanır, K8s parity-dışı (odysseus emsali compose).

### 2.2 Native launcher — KISMİ (start.sh, Docker-zorunlu)

- **`start.sh`** (kök, `start.sh:1-150`, TR yorumlu, `chmod +x`): tek-komut uçtan-uca boot.
  - Akış (`:4-5`): `preflight → port → ollama(serve+warm) → .env/keys → bridge(+TCC) → container(--wait) → integration gate → open → durum matrisi`.
  - **Docker ZORUNLU** (`:39-40`): `command -v docker || die "docker yok"` + `docker info || die "daemon kapalı"` → **Docker-suz native boot yolu YOK**.
  - Ollama otomatik-serve + warm (`WARM_MODEL=qwen3:8b` benchmark-winner, `:13`, `:50-53`).
  - `DRY_RUN=1` prova modu (yan-etkisiz, `:14`, `:53`, `:145`).
  - Host bridge (`:87-93`, macOS iTerm2/Terminal köprüsü, TCC).
  - Sonuç: `open http://localhost:3000` + durum matrisi (`:145-149`).
- **`stop.sh`** (kök) — teardown.
- **Platform kapsaması**: macOS-öncelikli (`open`, TCC, host-bridge, `lsof`). **Linux native scripti YOK**, **Windows `.ps1` launcher YOK** (`launch-windows.ps1` yok; sadece `join-cluster.ps1` — o cluster-join, boot değil). odysseus'un `start-macos.sh` / `launch-windows.ps1` üçlüsüne karşı **eksik: Linux + Windows**.
- **GPU compose overlay YOK**: `nvidia.yml`/`amd.yml` yok. GPU tek-yol: ollama HOST'ta (`host.docker.internal:11434`) Metal-GPU ile, compose değil.

### 2.3 PWA / service-worker — VAR ve olgun

- **`vite-plugin-pwa@^1.3.0`** kurulu (`package.json` devDep, doğrulandı) + `vite.config.ts:5` import.
- **`VitePWA(...)`** konfigüre (`vite.config.ts:14-64`):
  - `registerType: 'autoUpdate'` + `injectRegister: 'auto'` (`:15-16`) → SW registration **otomatik enjekte** (elle `sw.js` yazmaya gerek yok; Workbox derler).
  - **Manifest** (`:18-32`): `name`/`short_name: 'ollamas'`/`description`/`theme_color: '#0b0d12'`/`display: 'standalone'`/`start_url: '/'`/`scope: '/'` + `pwa-icon.svg` (any + maskable). **`public/manifest.json` dosyası YOK** — plugin build-time üretir (bu yüzden roadmap "manifest.json YOK" notu **kısmen yanıltıcı**: statik dosya yok ama manifest **etkin**, plugin generate ediyor).
  - **Workbox SW** (`:33-62`): `globPatterns` (js/css/html/svg/woff2 precache), `navigateFallback: '/index.html'` (offline shell), `runtimeCaching` iki kural:
    1. `/api/health` → `NetworkFirst` (3s timeout, telemetri canlı-veri, `:41-48`).
    2. **vF15** same-origin `GET /api/*` → `NetworkFirst` (offline-first, son-bilinen cache fallback, `:49-60`). POST/SSE (chat/pipeline) Workbox GET-only olduğu için **dokunulmaz** (`:38` yorumu).
  - `devOptions: {enabled: false}` (`:63`) → SW yalnız prod build'de aktif.
- **PWA statik asset**: `public/pwa-icon.svg` VAR (`public/` = `embed.js` + `pwa-icon.svg`). `apple-touch-icon`/PNG-fallback icon **yok** (yalnız SVG).
- **Multi-page build** (`vite.config.ts:73-93`): `app` (index.html) + `landing` (web/index.html) + `embedDemo`. `manualChunks` vendor-split (firebase/react/ui/i18n, `:83-90`).
- **lighthouse gate VAR**: `lighthouserc.json` + `package.json` `perf: lhci autorun` (perf CI).

### 2.4 Release altyapısı (Şef-1 v1.31) — VAR ve olgun

> **Şef-1 rollback/minisign release-altyapısı ZATEN VAR** — parity için yeniden-inşa GEREKMEZ, yalnız doğrula.

- **GHCR publish** — **`.github/workflows/publish.yml`** (`:1-35`):
  - Tetik: `push tags: ["v*"]` (`:5-6`).
  - `docker/build-push-action@v6` → `ghcr.io/${{ github.repository }}` (`:26`), tag'ler `semver{{version}}` + `latest` (`:27-29`), `packages: write` izni (`:12`). Tek imaj (mission-control) publish ediliyor.
- **İmzalı native binary** — **`.github/workflows/release-binary.yml`** (`:1-120`):
  - Matrix: `darwin-arm64` (macos-latest) + `linux-x64` (ubuntu-latest) (`:24-29`).
  - Node-SEA yolu (`npm run build:sea`, `:36-40`) — Bun taslak alternatif (`:1-9` yorumu).
  - **minisign detached-sign ZORUNLU** (`:50-70`): `MINISIGN_SECKEY` secret yoksa **HARD-FAIL exit 1** (imzasız release = supply-chain deliği, `:56-59`). `cli/sign-release.sh` çağırır, keyId türetir.
  - **`latest.json` manifest** (`:90-119`): sha256 + minisig URL + keyId embed → consumer `ollamas update --manifest <url>` ile **imza-doğrulamalı güncelleme** (rollback-safe).
- **SEA build** — **`cli/build-sea.sh`** (`:1-48`): classic `--experimental-sea-config` + `postject` (Node ≥20, host 24.x). `sea-config.json` + `dist/ollamas-<os>-<arch>` çıktı, macOS ad-hoc codesign (`:36-40`). `build:binary` (`cli/build-binary.sh`) Bun `--compile` alternatifi (`:1-34`, arm64 "Killed:9" regresyon-guard `:14-17`).
- **Ek release WF'leri**: `release-please.yml` (versiyon-PR otomasyonu), `registry-publish.yml` (MCP server registry).

---

## 3. odysseus Referans Modeli

odysseus (FastAPI+VanillaJS+SQLite) deploy deseni:

- **Docker-compose multi-service** — tümü **127.0.0.1-bound**:
  - `odysseus:7000` (ana app),
  - `ChromaDB:8100` (vector store),
  - `SearXNG:8080` (meta-search, research modülü için),
  - `ntfy:8091` (push-bildirim).
- **GPU stacking**: `COMPOSE_FILE` env ile `nvidia.yml`/`amd.yml` overlay katmanı (base compose üstüne GPU-servis inject).
- **Native (Docker-suz)**: `start-macos.sh` (Metal-GPU), Linux native, `launch-windows.ps1` — üç platformda bağımsız boot.
- **PWA**: `static/sw.js` (service-worker, elle) + `manifest.json` (installable web-app).
- **Config**: `.env` toggle'ları — `AUTH_ENABLED`, `APP_BIND`/`APP_PORT`, `DATABASE_URL`, `LLM_HOST`. İlk-boot **auto-admin** (ilk kullanıcı otomatik admin).

**ollamas'a çeviri notu:** ollamas kendi stack'inde (Node/TS + React/Vite) — **ChromaDB yerine `sqlite-vec`** (`server/rag.ts:1`, `:10` `import sqlite-vec`; 02-arch KN-M4 kararı: vektör → `VectorStore`, `sqlite-vec` kalır, **ChromaDB opsiyonel-MCP**). **SearXNG** research modülünde (O2) opsiyonel harici bağımlılık. **ntfy** parity-dışı (ollamas webhook + MCP-native bildirim kullanır). Yani odysseus'un 4-servisi ollamas'ta **1 zorunlu (app) + 2 opsiyonel-profil (vector/search)** olur.

---

## 4. Hedef-Plan (TDD-adımlı)

> **Ön-koşul (roadmap W6):** **O4 modülleri + O6 GREEN.** **Çıkış-kapısı:** `/api/health` yeşil + PWA lighthouse geçer + toggle-off (harici servis yok) boot GREEN.
> Her adım **RED → GREEN → gate → ledger** (implementer ≠ verifier; Tier-1 paralel değil — deploy adımları sıralı-bağımlı).

### Faz A — Multi-service compose genişletme (O7.1)

**A0 (RED)** — `tests/deploy/compose.e2e.test.ts`: `docker compose --profile full config` çıktısında `mission-control` + `searxng` + `chromadb` üç servisin de tanımlı + **hepsi 127.0.0.1-bound** olduğunu assert et (kırmızı: profil henüz yok).

**A1 (GREEN)** — `docker-compose.yml`'e opt-in servisler ekle (mevcut `postgres` profil desenini **birebir taklit et**, `docker-compose.yml:71-92` şablon):
- `searxng` servisi: `profiles: ["search","full"]`, `searxng/searxng` image, `127.0.0.1:8080:8080`, `no-new-privileges`, healthcheck.
- `chromadb` servisi: `profiles: ["vector","full"]`, `chromadb/chroma` image, `127.0.0.1:8100:8000`, named volume `ollamas-chromadata`, healthcheck.
- `mission-control` env'e **feature-toggle** ekle: `ENABLE_RESEARCH=${ENABLE_RESEARCH:-0}`, `SEARXNG_URL=${SEARXNG_URL:-}`, `CHROMA_URL=${CHROMA_URL:-}` (down iken honest-empty, roadmap ui-K8).

**A2 (gate)** — `docker compose --profile full up -d --wait` üç servisi de healthy getirsin; app **profilsiz** (`docker compose up -d`) hâlâ tek-servis GREEN (regresyon-yok). `ENABLE_RESEARCH=0` iken research paneli honest-empty.

### Faz B — GPU overlay (O7.1 devamı, opsiyonel)

**B1** — `docker-compose.nvidia.yml` overlay (odysseus `nvidia.yml` emsali): yalnız GPU-servis (opsiyonel local-LLM container) için `deploy.resources.reservations.devices` GPU inject. `COMPOSE_FILE=docker-compose.yml:docker-compose.nvidia.yml` ile stack. **Not:** ollamas'ın birincil GPU yolu ollama-HOST (Metal), bu yüzden B düşük-öncelik (Linux/nvidia kullanıcıları için).

### Faz C — Native launcher (O7.2)

**C0 (RED)** — `tests/deploy/native-boot.e2e.test.ts`: `NATIVE=1 ./start.sh` Docker-suz (ollama + `npm start` doğrudan host'ta) boot etsin, `/api/health` yeşil dönsün.

**C1 (GREEN)** — `start.sh`'i genişlet: `NATIVE=1` env → Docker preflight'ı atla (`start.sh:39-40` guard'ı koşullu yap), bunun yerine `node dist/server.cjs` (`package.json` `start`) doğrudan host'ta çalıştır. Docker hâlâ default (geri-uyumlu).

**C2** — `start-linux.sh` (Linux native: `xdg-open`, systemd-user opsiyonel) + `launch-windows.ps1` (odysseus emsali: ollama serve + `npm start` + `Start-Process` tarayıcı). Platform-detect ortak `bin/require-env.sh` deseniyle (`start.sh:18`).

**C3 (gate)** — üç platformda (macOS/Linux/Windows) native boot + Docker boot ikisi de GREEN; `DRY_RUN=1` her scriptte yan-etkisiz.

### Faz D — PWA doğrula + sertleştir (O7.3)

**D0 (RED)** — `tests/deploy/pwa.e2e.test.ts` (playwright): prod build sonrası (a) `manifest.webmanifest` served + parse-edilebilir, (b) SW register olur (`navigator.serviceWorker.ready`), (c) offline → `/index.html` shell açılır, (d) `/api/*` GET offline'da son-cache döner.

**D1 (GREEN)** — çoğu ZATEN VAR (`vite.config.ts:14-64`); eksikleri kapat: `apple-touch-icon` + PNG icon fallback (şu an yalnız SVG `pwa-icon.svg`) manifest `icons`'a ekle; `theme-color` meta `index.html`'de.

**D2 (gate)** — `npm run perf` (lhci) PWA kategorisi ≥ eşik (`lighthouserc.json`); installable kriteri (manifest + SW + HTTPS/localhost) yeşil.

### Faz E — GHCR + compose imaj parity (O7.4)

**E1** — parity **zaten var** (`publish.yml` GHCR + `release-binary.yml` minisign). Tek ek: `docker-compose.yml`'de `mission-control` `build:` yanına opsiyonel `image: ghcr.io/<owner>/ollamas:latest` ekle → kullanıcı build etmeden GHCR imajıyla `docker compose up`. Vector/search zaten upstream image (searxng/chroma) — publish gerekmez.

**E2 (gate)** — `v*` tag push → publish.yml GHCR'ye + release-binary.yml imzalı binary + latest.json; `docker compose pull && up -d --wait` GHCR imajıyla GREEN.

---

## 5. Kör-Nokta Ledger

| ID | Tür | Kör-nokta / risk | Kanıt / doğrulama | Mitigasyon |
|----|-----|------------------|-------------------|------------|
| KN-D1 | ✅ kapandı | "PWA yok / manifest.json yok" — roadmap notu | `vite.config.ts:14-64` VitePWA konfigüre; `public/manifest.json` statik dosya yok ama **plugin build-time üretir** (`manifest.webmanifest`) | O7.3 = **etkin-doğrula**, sıfırdan değil |
| KN-D2 | ✅ kapandı | "release altyapısı yok" | `publish.yml` (GHCR) + `release-binary.yml` (minisign, HARD-FAIL imzasız) + `cli/sign-release.sh` VAR | Şef-1 v1.31 parity karşılandı; yeniden-inşa YASAK |
| KN-D3 | ⚠️ gerçek-eksik | **multi-service compose YOK** — yalnız tek-servis + opt-in postgres | `docker-compose.yml:4` tek `mission-control`; searxng/chromadb/ntfy grep → **0 sonuç** | Faz A: postgres-profil desenini taklit et |
| KN-D4 | ⚠️ gerçek-eksik | **Linux + Windows native launcher YOK** | `start.sh` macOS-öncelikli + Docker-zorunlu (`:39-40`); `launch-windows.ps1` yok (`join-cluster.ps1` ≠ boot) | Faz C: `NATIVE=1` + `start-linux.sh` + `launch-windows.ps1` |
| KN-D5 | ⚠️ gerçek-eksik | **GPU compose overlay YOK** (`nvidia.yml`/`amd.yml`) | grep → 0 sonuç; GPU tek-yol ollama-HOST Metal | Faz B (düşük-öncelik; Metal birincil yol) |
| KN-D6 | R (risk) | ChromaDB parity — ollamas `sqlite-vec` kullanır, ChromaDB opsiyonel | `server/rag.ts:1,10` sqlite-vec; 02-arch KN-M4 kararı | ChromaDB **opsiyonel-profil** (vector-lane MCP), sqlite-vec default kalır |
| KN-D7 | R (risk) | SearXNG harici bağımlılık — down iken boot | roadmap ui-K8: `ENABLE_RESEARCH` + SearXNG-down honest-empty | Feature-toggle default-off; A1'de env ekle |
| KN-D8 | R (risk) | ntfy parity — odysseus'ta var, ollamas'ta yok | grep ntfy → 0; ollamas webhook + MCP bildirim kullanır | **Parity-dışı** (bilinçli sapma); webhook eşdeğer |
| KN-D9 | R (risk) | **odysseus repo DOĞRULANMADI** (00-MASTER KN-R1) — servis-portları (7000/8100/8080/8091) task-brief'ten | odysseus README fetch edilmedi | O0 öncesi WebFetch doğrula; port/servis sapmasında bu §3 + Faz A güncelle |
| KN-D10 | R (risk) | Native boot deps — Docker-suz yolda ollama + node host'ta olmalı | `start.sh:39` şu an Docker-zorunlu | C1 preflight: `NATIVE=1` iken `command -v node && ollama` kontrol |
| KN-D11 | ✅ kapandı | K8s/Helm ayrı yol — O7 kapsamı mı? | `deploy/helm`,`deploy/k8s`,`deploy/litellm` VAR | O7 = **compose + native** (odysseus emsali); K8s parity-dışı, mevcut korunur |

---

## 6. Parity Kabul Kriteri

O7 **GREEN** sayılır ancak ve ancak:

1. **Multi-service (O7.1):** `docker compose --profile full up -d --wait` → `mission-control` + `searxng` + `chromadb` üçü de **healthy** + **127.0.0.1-bound** (odysseus localhost-only deseni). Profilsiz `docker compose up -d` tek-servis GREEN (regresyon-yok). `ENABLE_RESEARCH=0` / servis-down → app honest-empty ile GREEN boot (roadmap ui-K8).
2. **Native (O7.2):** `NATIVE=1 ./start.sh` (macOS) + `start-linux.sh` + `launch-windows.ps1` üçü de Docker-suz `/api/health` yeşil getirir; Docker yolu (`./start.sh`) geri-uyumlu GREEN; her scriptte `DRY_RUN=1` yan-etkisiz.
3. **PWA (O7.3):** prod build sonrası manifest served + SW register + offline shell (`/index.html`) + offline `/api/*` son-cache; `npm run perf` (lhci) PWA kategorisi ≥ eşik (`lighthouserc.json`).
4. **GHCR + signed release (O7.4):** `v*` tag push → `publish.yml` GHCR imaj (`ghcr.io/<owner>/ollamas:{version,latest}`) + `release-binary.yml` **minisign-imzalı** `darwin-arm64`+`linux-x64` binary + `latest.json` (sha256+minisig+keyId); `docker compose pull && up -d --wait` GHCR imajıyla GREEN. İmzasız release **HARD-FAIL** (mevcut davranış korunur).
5. **Config parity:** `.env` toggle'ları (`APP_BIND`/`PORT` → mevcut `PORT`; `AUTH_ENABLED` → mevcut `SAAS_ENFORCE`; `DATABASE_URL` VAR; `LLM_HOST` → mevcut `OLLAMA_HOST`) + yeni `ENABLE_RESEARCH`/`SEARXNG_URL`/`CHROMA_URL`. İlk-boot davranışı belgelenir (odysseus auto-admin ↔ ollamas single-owner localhost).

**Kritik-yol (roadmap):** `O0 → O1 → O5-core → O4 → O6 → **O7** → O8`. O7 çıkış-kapısı O8 (final gate) ön-koşuludur: **deploy güvenlik-enforcement (O6) olmadan ship YASAK** (03-ui K6, roadmap §270).
