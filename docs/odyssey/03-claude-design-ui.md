# ODYSSEY O2 — Claude Design UI Brief'leri (Ekran/Panel bazlı, odysseus-kalitesinde)

> **Belge:** `docs/odyssey/03-claude-design-ui.md`
> **Odak (O2):** Her ekran/panel için odysseus-kalitesinde bir **Claude Design** tasarım brief'i + **handoff-bundle** listesi + Claude Design workflow adımları (prompt → canvas → handoff → Claude Code implement).
> **Kapsam:** chat, research, docs, email, notes, calendar, cookbook, settings/2FA.
> **Dil:** TR (kod/komut/dosya-yolu EN).
> **Üretim tarihi:** 2026-07-10.

---

## 0. Claude Design nedir, ne DEĞİLdir (workflow'un temel kısıtı)

**Claude Design (claude.ai/design, Nisan 2026)** = **frontend-only UI tasarım canvası**.

| YAPAR | YAPMAZ |
|---|---|
| UI prototip (HTML/JSX + inline CSS) üretir | Backend/DB/host **ÜRETMEZ** |
| Statik/mock veriyle ekran tasarlar | `localhost`/MCP backend'e **BAĞLANAMAZ** |
| Handoff bundle çıkarır (HTML + screenshot + README) | Gerçek `/api/*` fetch **çağıramaz** (CSP + no-localhost) |
| Tasarım token'ları + component varyantları | App-runtime **DEĞİL** (canlı state, SSE, auth yok) |

**Sonuç (değişmez kural):** Claude Design **UI-tasarım aracı**dır, **app-runtime değil**. Her brief mock veriyle tasarlanır; gerçek veri bağlama işi **Claude Code handoff** aşamasında mevcut ollamas frontend+backend'e implementasyonla yapılır.

**Workflow zinciri (her panel için aynı):**
```
1. PROMPT      → Claude Design'a panel brief'i (bu belgedeki brief bloğu) yapıştırılır
2. CANVAS      → Claude Design mock veriyle UI üretir; varyant/iterasyon canvas'ta
3. HANDOFF     → bundle export: design.html + screenshot.png + HANDOFF.md
4. CLAUDE CODE → bundle Claude Code'a verilir; mevcut src/components + server/*.ts'e implemente edilir (TDD)
5. DEPLOY      → gate (typecheck + lint + test) → commit → ship
```

---

## 1. Mevcut Durum — ollamas frontend envanteri (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read`/`Grep` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10).

### 1.1 Tasarım sistemi (mevcut, korunacak — Claude Design'a bu token'lar verilecek)
- **Stack:** Vite + React 19 + TypeScript, Tailwind **v4** (`@theme` inline), `lucide-react` ikon.
  Doğrulandı: `src/App.tsx`, `vite.config.ts`, `package.json`.
- **Token katmanı:** `src/styles/tokens.css` (`:root` = dark) + `src/styles/tokens-light.css` (`[data-theme="light"]`).
  Auto-generated → `tokens/*.json` (style-dictionary), `npm run tokens` ile regenerate. **El ile düzenleme YASAK.**
- **Renk paleti (immersive dark cockpit):**
  `--ollamas-color-bg-base:#050608` · `bg-sidebar:#08090d` · `bg-panel:#0a0b10` · `bg-inset:#04050a` ·
  `border-subtle: rgba(255,255,255,.05)` · `text-bright:#f8fafc` · `text-muted:#94a3b8` ·
  `accent-indigo:#6366f1` · `status-ok:#34d399` · `status-warn:#fbbf24` · `status-err:#fb7185` · `status-info:#22d3ee`.
- **Tailwind utility eşlemesi** (`src/index.css` `@theme`): `bg-immersive-bg`, `bg-immersive-sidebar`, `bg-immersive-panel`, `border-immersive-border`, `text-immersive-text-bright/muted/dim`, `text-status-accent/ok/warn/err/info`.
- **Font:** sans = Inter; mono = JetBrains Mono (`--ollamas-font-*`).
- **Radius/space:** `radius-sm:3px/md:8px/lg:12px`; `space-1..4 = 4/8/12/16px`.
- **Hareket:** `.animate-fade-in` (0.25s cubic-bezier), `.ollamas-skeleton` shimmer; `prefers-reduced-motion` saygılı.
- **Theme:** `src/lib/theme.tsx` — tek `[data-theme]` attribute ile flip (dark/light), `ThemeToggle.tsx`.
- **i18n:** Lingui, `src/locales/{en,tr}.ts`; sekme etiketleri `_(\`app.tab.${id}\`)`. **Her yeni panel için EN+TR anahtar zorunlu.**

### 1.2 Uygulama iskeleti (mevcut)
- **`src/App.tsx`** — tek dosya shell: global header (logo + live/degraded/demo badge + Lang/Theme toggle), **sol sidebar** (21 sekmeli dikey nav), sağ **dinamik panel** mount alanı, footer, toast bildirim overlay.
- **Navigasyon:** `activeTab` state; sekmeler `tabs[]` dizisinden; her panel `activeTab === "<id>" && <Component/>`.
- **Capability gate:** `src/lib/capabilities.ts` — `isTabEnabled(tabId, perms)`; `CapabilityGate`/`CapabilityDenied` (deny-by-default). Bu **RBAC değil** — sadece backend'in `telemetry.permissions{fileRead,fileWrite,commandExec,git}` yansıması.
- **Veri akışı:** `/api/cockpit/stream` (SSE, ~2s) + `/api/health` polling fallback; `src/lib/apiClient.ts`.

### 1.3 Mevcut 21 sekme (`src/App.tsx` `tabs[]` — doğrulandı)
`telemetry · swarm · saas · pipeline · react-agent · files · drive · sheets · calendar · gmail · search · github-actions · integrations · threatintel · terminal · keys · security · backup · automation · selftest · revenue`

### 1.4 Panel envanteri — odysseus modülüne eşleme (VAR / KISMİ / YOK)

| odysseus modülü | ollamas'ta karşılık | Dosya | Durum |
|---|---|---|---|
| **chat/agents** | `ReactAgentTab` (ReAct loop + tool-exec + trace), `MultiAgentPipeline` | `src/components/ReactAgentTab.tsx` (48k), `MultiAgentPipeline.tsx` | **VAR** (agent_loop mevcut; sohbet UX odysseus-altı) |
| **research (deep_research + SearXNG)** | `ECySearcherPanel` (threat-intel), `GitHubSearchPanel` | `src/components/ECySearcherPanel.tsx`, `GitHubSearchPanel.tsx` | **KISMİ** (arama var; çok-kaynak deep-research + citation YOK) |
| **documents (PDF/office/markdown editör + upload)** | `WorkspaceTree` (dosya ağacı, read) + `FileTransfer` | `src/components/WorkspaceTree.tsx`, `FileTransfer.tsx` | **KISMİ** (ağaç/okuma var; **editör/preview/upload YOK**) |
| **email (IMAP/SMTP + triage)** | `GmailBrowser` (read-only metadata, Firebase OAuth) | `src/components/GmailBrowser.tsx` | **KISMİ** (Gmail metadata-only; **IMAP/SMTP + triage YOK**) |
| **notes/tasks (memory + cron)** | — (server `memory-stats.ts` var, UI yok) | — | **YOK** |
| **calendar (CalDAV/ICS)** | `GoogleCalendarBrowser` (Firebase, read) | `src/components/GoogleCalendarBrowser.tsx` | **KISMİ** (Google read; **CalDAV/ICS + yazma YOK**) |
| **local-models/cookbook (donanım-farkında öneri)** | `cockpit/ModelsPanel`, `ModelOpsFeed`, `OrchestraPanel` | `src/components/cockpit/*` | **KISMİ** (model listesi var; **donanım-farkında öneri/cookbook YOK**) |
| **MCP-as-extension** | MCP catalog + supervisor + IntegrationsPanel | `server/mcp/catalog.ts`, `IntegrationsPanel.tsx` | **VAR** (curated catalog, one-click add) |
| **settings / 2FA / RBAC (TOTP + admin/non-admin policy)** | `SecurityPolicies`, `SaaSAdmin`, `KeyVault` | `src/components/SecurityPolicies.tsx`, `SaaSAdmin.tsx`, `KeyVault.tsx` | **KISMİ** (capability + admin-token var; **TOTP/2FA + gerçek RBAC YOK**) |
| **theming/PWA** | `ThemeToggle`, `public/pwa-icon.svg` | `src/lib/theme.tsx`, `public/` | **KISMİ** (dark/light var; **manifest/SW/tam PWA doğrulanmadı**) |

**Kritik eksik özet (Claude Design brief'lerinin hedeflediği boşluk):**
`notes/tasks` (tam YOK) · `documents editör/upload` · `deep_research` · `IMAP/SMTP email triage` · `CalDAV/ICS calendar` · `cookbook (hardware-aware)` · `TOTP/2FA + RBAC`.

---

## 2. odysseus Referansı — parity hedefi

**odysseus** (self-hosted AI workspace, 82k★): FastAPI + VanillaJS + SQLite + ChromaDB + Docker.
Extensibility sırrı: **MCP-as-extension + modular-services + config-driven (.env 40+ toggle)**.

**ollamas ile paralellik:** ollamas'ın MCP catalog'u (`server/mcp/catalog.ts`), modüler `server/*.ts` servisleri ve `.env` toggle'ları (mevcut ~46 anahtar) aynı felsefeyi taşıyor — yani **parity mimari olarak erişilebilir**; boşluk **UI kalitesi + eksik modüller**.

**odysseus UI kalite çıtası (her brief bu 8 kriteri karşılamalı):**
1. Tek-ekran modül düzeni (liste + detay + eylem, üç-panel değil boğmayan iki-panel).
2. Boş/yükleniyor/hata/başarı **dört durumu da** tasarlanmış (honest empty state).
3. Klavye-öncelikli (⌘K komut paleti, enter-to-send, esc-to-close).
4. Streaming/canlı feedback (token akışı, progress, SSE göstergesi).
5. Config-driven görünürlük (`.env` toggle kapalıysa panel gizli/kilitli).
6. Erişilebilirlik (ARIA, focus-visible, `prefers-reduced-motion`, kontrast AA).
7. Dark/light paritesi (token katmanından, `dark:` prefix yok).
8. Mobil/dar viewport'ta bozulmayan responsive grid.

---

## 3. Hedef Plan — Panel bazlı Claude Design Brief'leri (TDD-adımlı)

> **Her panel bloğu şunu içerir:** (a) Claude Design **PROMPT** iskeleti, (b) **handoff-bundle** listesi, (c) Claude Code **implementasyon hedefi** (mevcut dosya), (d) **TDD adımları** (test-önce), (e) panel-özel **parity kabul kriteri**.
>
> **Ortak handoff-bundle şablonu** (her panel `docs/odyssey/handoff/<panel>/` altına):
> ```
> <panel>/
>   PROMPT.md          # Claude Design'a verilen tam brief (token'lar + mock veri + durumlar)
>   design.html        # Claude Design export (self-contained, inline CSS)
>   screenshot.png     # canvas görüntüsü (dark; ayrıca light varyant screenshot-light.png)
>   HANDOFF.md         # component adı, prop imzası, i18n anahtar listesi, /api sözleşmesi, mock→real map
>   tokens.snippet.css # brief'e gömülen ollamas token alt-kümesi (kaynak: src/styles/tokens.css)
> ```

---

### 3.1 CHAT / AGENTS paneli  (`react-agent`)  — mevcut: `ReactAgentTab.tsx` (VAR, UX yükseltme)

**Claude Design PROMPT iskeleti:**
> "Dark developer-cockpit AI chat panel. Token'lar: bg `#0a0b10`, sidebar `#08090d`, accent `#6366f1`, mono JetBrains Mono, sans Inter. İki bölge: (sol dar) session listesi + 'New chat'; (sağ geniş) mesaj akışı + altta prompt kutusu. Mesaj akışında: user/assistant balonları, **tool-call trace step kartları** (step#, tool adı, latency ms, ok/fail rozeti, açılır diff), streaming token imleci. Üst bar: provider seçici (ollama-local default), model dropdown, `verify` toggle, `auto-apply` toggle. Dört durum: boş (greeting), streaming (imleç + step göstergesi), hata (retry), tamam (tok/s metriği). Mock: 3 mesajlı sohbet + 2 trace step."

**Handoff-bundle:** `handoff/chat/{PROMPT.md, design.html, screenshot.png, screenshot-light.png, HANDOFF.md, tokens.snippet.css}` + `TRACE_CARD.spec.md` (step kartı prop imzası).

**Claude Code implementasyon hedefi:** `src/components/ReactAgentTab.tsx` (mevcut trace/session state korunur; sadece görsel katman), `src/components/AgentMessage.tsx`.

**TDD adımları:**
1. Test-önce: `ReactAgentTab.test.tsx` — greeting render, streaming step append (step-keyed, overwrite değil append), verify-toggle prop akışı.
2. Test kırmızıyken UI'yi handoff'a göre güncelle.
3. Green: trace-card ok/fail rozeti + latency görünür; a11y (mesaj listesi `role="log"`, `aria-live="polite"`).
4. i18n: `react-agent.*` EN+TR anahtarları senkron (mevcut `react-agent.greeting.welcome` korunur).

**Parity kabul:** streaming imleç + step trace kartı + provider/model/verify barı + 4 durum + dark/light + ⌘Enter gönder.

---

### 3.2 RESEARCH paneli  (yeni: `research`)  — mevcut: KISMİ (`ECySearcherPanel` + `GitHubSearchPanel`)

**Claude Design PROMPT iskeleti:**
> "Deep-research panel. Üst: geniş arama kutusu + 'derinlik' seçici (quick / deep) + kaynak toggle'ları (web/SearXNG, GitHub, threat-feed). Orta: **canlı araştırma akışı** — numaralı adımlar (sorgu üretildi → N kaynak çekildi → çelişki doğrulandı → sentez), her adım progress + kaynak sayısı. Alt: **cited synthesis** — paragraflar + `[1][2]` atıf çipleri; sağ kolonda kaynak listesi (başlık, domain, tarih, aç-ikonu). Boş durum: örnek sorgu önerileri. Mock: 'X nedir?' sorgusu, 4 adım, 3 kaynaklı sentez."

**Handoff-bundle:** `handoff/research/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `CITATION_CHIP.spec.md`, `SOURCE_LIST.spec.md`.

**Claude Code implementasyon hedefi:** yeni `src/components/ResearchPanel.tsx`; backend yeni `server/research.ts` (SearXNG proxy + multi-fetch + verify). App.tsx `tabs[]`'a `research` ekle. **Mevcut `ECySearcherPanel` threat-feed'i kaynak olarak bağlanabilir.**

**TDD adımları:**
1. Test-önce (backend): `server/__tests__/research.test.ts` — SearXNG proxy 502-graceful, multi-source merge, citation index bütünlüğü.
2. Test-önce (UI): `ResearchPanel.test.tsx` — adım akışı render, atıf çipi → kaynak scroll, boş durum örnek sorgular.
3. Green: SSE ile canlı adım akışı; `.env` `ENABLE_RESEARCH` toggle ile panel görünür.
4. i18n `research.*` EN+TR.

**Parity kabul:** çok-kaynak fan-out + adımlı canlı akış + `[n]` atıflı sentez + kaynak paneli + SearXNG-down honest empty + toggle-gated.

---

### 3.3 DOCUMENTS paneli  (yeni: `documents`)  — mevcut: KISMİ (`WorkspaceTree` read-only)

**Claude Design PROMPT iskeleti:**
> "Doküman workspace paneli. Sol: dosya ağacı (klasör/dosya ikonları, `.md/.pdf/.docx` tip rozetleri) + 'Upload' drop-zone. Sağ: **iki-mod görüntüleyici** — Markdown için split editör (sol raw / sağ preview), PDF/office için read-only preview + 'download'. Üst bar: dosya adı, kaydet (dirty rozeti), tip. Drop-zone: sürükle-bırak yükleme durumu (progress + hata). Dört durum: boş ağaç, dosya seçilmedi, yükleniyor, kaydedildi. Mock: 3-dosyalı ağaç + açık markdown editör."

**Handoff-bundle:** `handoff/documents/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `DROPZONE.spec.md`, `MD_EDITOR.spec.md`.

**Claude Code implementasyon hedefi:** `src/components/WorkspaceTree.tsx` genişlet + yeni `DocumentEditor.tsx`; backend `server/files.ts`'e write/upload + markdown render. `fileWrite` capability-gate zorunlu.

**TDD adımları:**
1. Test-önce (backend): `files.test.ts` — write path-traversal guard, upload boyut/uzantı allowlist, markdown→html sanitize.
2. Test-önce (UI): `DocumentEditor.test.tsx` — dirty state, save handler, dosya-yok boş durum.
3. Green: split preview canlı; upload progress; `CapabilityGate need="fileWrite"`.
4. i18n `documents.*` EN+TR.

**Parity kabul:** ağaç + upload dropzone + MD split-editör + PDF preview + dirty/save + fileWrite-gate + 4 durum.

---

### 3.4 EMAIL paneli  (yeni: `email` — IMAP/SMTP)  — mevcut: KISMİ (`GmailBrowser` metadata-only)

**Claude Design PROMPT iskeleti:**
> "Email triage paneli. Sol: hesap/klasör listesi (Inbox/Sent + unread sayacı). Orta: mesaj listesi (from, subject, tarih, unread noktası, **triage etiket çipleri**: action/waiting/archive). Sağ: mesaj önizleme (header + gövde) + hızlı eylemler (reply/archive/label). Üst: arama + 'compose'. Compose modalı: to/subject/body + gönder (SMTP). Dört durum: bağlı-değil (IMAP setup CTA), boş inbox, yükleniyor, gönderildi. Mock: 5 mesajlı inbox + 2 triage etiketi."

**Handoff-bundle:** `handoff/email/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `TRIAGE_CHIP.spec.md`, `COMPOSE_MODAL.spec.md`.

**Claude Code implementasyon hedefi:** yeni `src/components/EmailPanel.tsx`; backend yeni **MCP email server** (`server/mcp/` içinde IMAP/SMTP) veya `server/email.ts`. **Mevcut `GmailBrowser` metadata-only privacy law'ını bozmadan ayrı IMAP kanalı.**

**TDD adımları:**
1. Test-önce (backend): `email.test.ts` — IMAP fetch mock, SMTP send mock, kimlik-bilgisi keychain'den (`KeyVault`), gövde sanitize.
2. Test-önce (UI): `EmailPanel.test.tsx` — triage çip filtresi, compose validation, bağlı-değil CTA.
3. Green: `.env` `ENABLE_EMAIL_IMAP` toggle; kimlik `KeyVault` üzerinden.
4. i18n `email.*` EN+TR.

**Parity kabul:** IMAP liste + SMTP compose + triage etiketleri + preview + setup-CTA + 4 durum + credential-vault entegrasyonu.

---

### 3.5 NOTES / TASKS paneli  (yeni: `notes`)  — mevcut: YOK (tam sıfır)

**Claude Design PROMPT iskeleti:**
> "Notes + tasks paneli. Sol sekme: Notes / Tasks. Notes modu: not listesi (başlık + snippet + tarih) + markdown editör. Tasks modu: task listesi (checkbox, başlık, **due + cron rozeti** '@daily'), tamamlanan ayrı grup. Üst: '+ New' + arama. Cron kurulum satırı: doğal-dil ('her gün 09:00') → cron string önizleme. Dört durum: boş, düzenleme, kaydedildi, cron-hatalı. Mock: 3 not + 4 task (2 tamam) + 1 cron'lu task."

**Handoff-bundle:** `handoff/notes/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `TASK_ROW.spec.md`, `CRON_INPUT.spec.md`.

**Claude Code implementasyon hedefi:** yeni `src/components/NotesPanel.tsx`; backend yeni `server/notes.ts` (SQLite/store) + cron scheduler (mevcut `orchestration` cron pattern'i baz). **Mevcut `server/memory-stats.ts` memory katmanına bağlanabilir.**

**TDD adımları:**
1. Test-önce (backend): `notes.test.ts` — CRUD, cron-parse (doğal-dil→cron), scheduler tetik mock.
2. Test-önce (UI): `NotesPanel.test.tsx` — not/task toggle, checkbox complete, cron-önizleme, boş durum.
3. Green: cron scheduler backend'e bağlı; persist doğrulandı.
4. i18n `notes.*` EN+TR.

**Parity kabul:** notes markdown + tasks checkbox + cron scheduler + persist + arama + 4 durum. **(Sıfırdan modül — en yüksek iş.)**

---

### 3.6 CALENDAR paneli  (yeni: `calendar-caldav`)  — mevcut: KISMİ (`GoogleCalendarBrowser` Google-read)

**Claude Design PROMPT iskeleti:**
> "Calendar paneli. Üst: ay/hafta/gün görünüm switcher + bugün + kaynak toggle (Google / CalDAV / ICS import). Ana: takvim grid (hafta görünümü default) event blokları (renk = kaynak). Sağ drawer: event detay (başlık, saat, konum, açıklama) + düzenle/sil. '+ Event' → oluştur formu. ICS import: dosya drop → önizleme → içe-aktar. Dört durum: bağlı-değil, boş hafta, yükleniyor, kaydedildi. Mock: 1 haftalık 4 event (2 kaynak)."

**Handoff-bundle:** `handoff/calendar/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `EVENT_BLOCK.spec.md`, `WEEK_GRID.spec.md`.

**Claude Code implementasyon hedefi:** `src/components/GoogleCalendarBrowser.tsx` genişlet → `CalendarPanel.tsx`; backend yeni `server/calendar.ts` (CalDAV client + ICS parse). **Mevcut Google-read kaynağı korunur, CalDAV/ICS eklenir.**

**TDD adımları:**
1. Test-önce (backend): `calendar.test.ts` — CalDAV fetch mock, ICS parse (RFC 5545), event write, timezone.
2. Test-önce (UI): `CalendarPanel.test.tsx` — hafta grid render, event drawer, ICS drop önizleme.
3. Green: `.env` `ENABLE_CALDAV`; multi-source renk.
4. i18n `calendar.*` EN+TR (mevcut Google anahtarları korunur).

**Parity kabul:** hafta/gün grid + multi-source event + create/edit + ICS import + CalDAV bağlantı + 4 durum.

---

### 3.7 COOKBOOK / LOCAL-MODELS paneli  (yeni: `cookbook`)  — mevcut: KISMİ (`cockpit/ModelsPanel`)

**Claude Design PROMPT iskeleti:**
> "Local-models cookbook paneli. Üst: **donanım kartı** (algılanan RAM/VRAM/CPU + 'senin makinen' rozeti). Ana: **model öneri grid** — her kart: model adı, boyut (GB), quant, hız tahmini (tok/s), **uyum rozeti** (✓ rahat çalışır / ⚠ sınırda / ✗ yetersiz) donanıma göre renklendirilmiş. Filtre: görev (chat/code/embed) + boyut. Kart eylemi: 'pull' (ollama pull progress). Alt: kurulu modeller listesi + RAM kullanımı. Dört durum: tarama, öneri hazır, pull-progress, hata. Mock: 6 model kartı (3 uyumlu, 2 sınırda, 1 yetersiz) + 16GB donanım."

**Handoff-bundle:** `handoff/cookbook/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `MODEL_CARD.spec.md`, `HW_BADGE.spec.md`.

**Claude Code implementasyon hedefi:** yeni `src/components/CookbookPanel.tsx`; backend yeni `server/cookbook.ts` (hw-detect + model katalog + fit-score) + `cockpit/cockpit-models.ts` mevcut model listesine bağla.

**TDD adımları:**
1. Test-önce (backend): `cookbook.test.ts` — hw-detect mock, fit-score fonksiyonu (RAM vs model-boyut → ✓/⚠/✗), pull-progress SSE.
2. Test-önce (UI): `CookbookPanel.test.tsx` — uyum rozeti renk mantığı, filtre, pull-progress.
3. Green: gerçek `ollama pull` progress bağlı; hw-detect canlı.
4. i18n `cookbook.*` EN+TR.

**Parity kabul:** donanım-farkında fit-score + öneri grid + pull-progress + görev filtresi + kurulu-model listesi + 4 durum.

---

### 3.8 SETTINGS / 2FA / RBAC paneli  (yeni: `settings`)  — mevcut: KISMİ (`SecurityPolicies` + `SaaSAdmin`)

**Claude Design PROMPT iskeleti:**
> "Settings + güvenlik paneli. Sol sekme: Genel / Güvenlik (2FA) / Erişim (RBAC) / Görünüm. **2FA sekmesi:** TOTP kurulum akışı — QR kod + secret + doğrulama kodu girişi + backup kodlar. **RBAC sekmesi:** rol tablosu (admin / non-admin) × araç-politikası matrisi (checkbox grid: hangi rol hangi tool-tier'ı çalıştırır). Genel: `.env` toggle'ları görsel switch listesi (config-driven). Görünüm: theme dark/light + dil. Dört durum: 2FA kapalı (enable CTA), QR gösteriliyor, doğrulandı, RBAC kaydedildi. Mock: TOTP-QR + 2-rollü 6-tool RBAC matrisi."

**Handoff-bundle:** `handoff/settings/{PROMPT.md, design.html, screenshot.png, HANDOFF.md, tokens.snippet.css}` + `TOTP_SETUP.spec.md`, `RBAC_MATRIX.spec.md`, `TOGGLE_LIST.spec.md`.

**Claude Code implementasyon hedefi:** `src/components/SecurityPolicies.tsx` genişlet → `SettingsPanel.tsx`; backend `server/mcp/tool-registry.ts` (tier-allowlist mevcut) + yeni `server/auth-totp.ts` + RBAC policy. **Mevcut `capabilities.ts` capability-gate → gerçek RBAC'a evrimleşir.**

**TDD adımları:**
1. Test-önce (backend): `auth-totp.test.ts` — TOTP secret üret, kod doğrula (RFC 6238, time-window), backup-code tek-kullanım; `rbac.test.ts` — rol→tool-tier allowlist enforcement.
2. Test-önce (UI): `SettingsPanel.test.tsx` — QR render, kod-doğrulama akışı, RBAC matris toggle, toggle-list.
3. Green: TOTP login gate backend'e bağlı; RBAC `tool-registry` tier'ına bağlı.
4. i18n `settings.*` EN+TR.

**Parity kabul:** TOTP kurulum+doğrulama+backup-kod + RBAC rol×tool matrisi + config toggle listesi + theme/dil + 4 durum. **(Güvenlik-kritik — backend enforcement zorunlu, UI tek başına yetmez.)**

---

## 4. Uygulama sırası (bağımlılık-sıralı, T0 kapılı)

| Sıra | Panel | Gerekçe | İş büyüklüğü |
|---|---|---|---|
| 1 | **chat** (3.1) | Mevcut, sadece UX yükseltme; en düşük risk, hızlı parity kazancı | S |
| 2 | **cookbook** (3.7) | $0-local kimliğin kalbi; mevcut model katmanına bağlanır | M |
| 3 | **documents** (3.3) | Mevcut WorkspaceTree'yi genişletir; fileWrite-gate hazır | M |
| 4 | **research** (3.2) | Yeni backend (SearXNG); ECySearcher feed'i kaynak | M |
| 5 | **notes** (3.5) | Sıfırdan modül; cron scheduler yeni | L |
| 6 | **calendar** (3.6) | Google-read'i genişletir; CalDAV/ICS yeni | L |
| 7 | **email** (3.4) | IMAP/SMTP + keychain; privacy-hassas | L |
| 8 | **settings/2FA** (3.8) | Güvenlik-kritik; en sona (backend RBAC + TOTP sağlam olmalı) | XL |

**T0 kapıları (her panel için):** Emre onayı → handoff bundle üretildi → TDD kırmızı→yeşil → gate (typecheck+lint+test fresh) → commit. **CRITICAL gizleme YASAK.**

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| K1 | **VARSAYIM** | Claude Design'ın Nisan 2026 export formatı (HTML+screenshot+README bundle) belgede tarif edildiği gibi. Gerçek export şeması doğrulanmadı. | Handoff-bundle şablonu (§3) yanlış olabilir | İlk panelde (chat) gerçek bir export yapıp şablonu kalibre et |
| K2 | **BİLİNMEYEN** | Claude Design canvas'ının ollamas Tailwind v4 `@theme` token'larını ne kadar sadık ürettiği belirsiz (inline CSS üretir, token değişkeni değil). | Handoff'ta manuel token-remap gerekebilir | HANDOFF.md'ye "mock→real map" + tokens.snippet.css zorunlu |
| K3 | **RİSK** | `notes`, `research`, `email`, `calendar-caldav`, `cookbook` için **backend YOK** — Claude Design UI üretir ama Claude Code'un yeni `server/*.ts` + testleri yazması gerekir. Bu O2 (UI) değil O-backend işi. | O2 tek başına çalışan panel üretmez | Bu belge UI-brief; backend planı ayrı odyssey dosyasına (04/05) refere et |
| K4 | **VARSAYIM** | 21 mevcut sekmeye 6+ yeni sekme eklemek sidebar'ı taşırır (dikey nav zaten uzun). | Nav UX bozulur | §3'te olası **kategori-gruplama / ⌘K komut paleti** öner (App.tsx nav refactor ayrı iş) |
| K5 | **BİLİNMEYEN** | PWA parity: `public/pwa-icon.svg` var ama `manifest.json` + service-worker varlığı doğrulanmadı (vite.config.ts okunmadı). | "theming/PWA parity" iddiası eksik | vite PWA plugin + manifest denetimi ayrı görev |
| K6 | **RİSK** | 2FA/RBAC (§3.8) güvenlik-kritik: UI mock kolay, ama TOTP time-window + RBAC enforcement backend'de sağlam olmazsa **sahte güvenlik**. | Güvenlik açığı | Backend-önce TDD (auth-totp.test + rbac.test yeşil olmadan UI ship YASAK) |
| K7 | **VARSAYIM** | `GmailBrowser` metadata-only "privacy hard law" (kod yorumu) korunmalı; yeni `email` paneli bunu ihlal etmemeli (ayrı IMAP kanalı). | Privacy regresyon | EmailPanel Gmail component'ini değiştirmez, ayrı dosya |
| K8 | **BİLİNMEYEN** | SearXNG/ChromaDB (odysseus stack'i) ollamas'ta kurulu değil; `research` deep-research için harici bağımlılık gerekir. | research paneli çalışmaz | `.env` `ENABLE_RESEARCH` + SearXNG-down honest-empty (§3.2) |
| K9 | **VARSAYIM** | i18n: her yeni panel EN+TR anahtar çifti gerektirir (Lingui). Claude Design İngilizce mock üretir; TR çeviri Claude Code aşamasında. | Eksik TR anahtar = runtime `_()` boş | Her HANDOFF.md'ye i18n-anahtar checklist |

---

## 6. odysseus-parity Kabul Kriteri (bu O2 belgesi için — genel)

Bu belge (O2: UI brief katmanı) **DONE** sayılır ancak:

- [ ] **8/8 panel** için Claude Design PROMPT iskeleti + handoff-bundle şablonu + Claude Code hedef dosya + TDD adımları + panel-parity kriteri yazıldı. **(bu belge = ✅)**
- [ ] Her brief §2'deki **8 odysseus UI kalite kriterini** (4-durum, klavye, streaming, config-toggle, a11y, dark/light, responsive, iki-panel düzen) referanslıyor. **(✅)**
- [ ] Mevcut `src/components` envanteri **koda karşı doğrulandı** (VAR/KISMİ/YOK tablosu). **(✅)**
- [ ] Kör-Nokta Ledger ≥ 8 kayıt (bilinmeyen/varsayım/risk). **(✅ — 9 kayıt)**
- [ ] Uygulama sırası bağımlılık-sıralı + T0 kapılı. **(✅)**

**Sonraki belge (04/05) devralır:** her panelin gerçek Claude Design export'u + Claude Code implementasyonu + backend servisleri (`server/*.ts`) + TDD yeşili. Bu O2 belgesi **UI-brief kaynağıdır, implementasyon değil** (K3).

**Parity nihai testi (odysseus vs ollamas, gelecekte):** 8 panel de canlı, `.env` toggle ile açılıp kapanır, 4-durumu render eder, dark/light çalışır, klavye-öncelikli, backend'e gerçek bağlı → ollamas = odysseus-kalitesinde AI-workspace.
