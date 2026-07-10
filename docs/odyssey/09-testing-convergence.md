# ODYSSEY O8 — Testing & Convergence (Parity Kabul Matrisi + Gate + Kör-Nokta Kapanma Kanıtı)

> **Belge amacı:** Odyssey programının **convergence sözleşmesi**. Her modülün TDD +
> e2e + odysseus-parity kabul kriterlerini **tek matriste** toplar, kalite-gate'i
> tanımlar, ve her modülün Kör-Nokta ledger'ını **kapanma-kanıtı** (closing evidence)
> ile bağlar. Convergence tanımı: **her modül parity + gate-yeşil + kör-nokta-sıfır.**
>
> **Kaynak-of-truth:** modül .md'leri (`01-vision-premise.md`, `03-claude-design-ui.md`,
> `07-security.md`, `05-features/{documents,email-mcp,calendar-caldav,mcp-extensions}.md`)
> + `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek kodu (Read/Grep, 2026-07-10).
> **Dil:** TR (anlatı) · EN (kod/komut/dosya-yolu). **Yöntem:** test-once (RED→GREEN→REFACTOR).

---

## 0. TL;DR (tek nefes)

Odyssey'nin **6 modülü** (Faz-0 temel + Research + Documents + Email + Notes/Tasks + Calendar +
Cookbook) ve **2 cross-cutting** (Security O6, Design/PWA O2) planlandı. Bu belge onların
**kabul kriterlerini birleştirir** ve `convergence = Σ(parity) ∧ gate-green ∧ ledger-closed`
tek denklemine indirir. Bugün ollamas'ta gerçek test tabanı **güçlü** (**221 app-suite test dosyası**:
`tests/` 182 + `tests/ui/` 36 + `server/` 3; tüm-repo ~435'e orchestration/tunnel/contract lane'leri
dahil — convergence yalnız app-suite'e bağlanır, bkz §3 not) `vitest@4` (**`projects` ile bölünmüş**:
`unit`/`ui`/`scripts`/`orchestra`) + `@playwright/test@1.61` + RTL, ve store **SQLite**
(`server/store/` + `sqlite-vec@0.1.9` + `server/rag.ts`), ama **6 modülün hiçbirinin
bağımlılığı/testi/kodu henüz yok** ve `server/module-registry.ts` **YOK**. **PWA ise beklenenin aksine
zaten VAR** (`vite-plugin-pwa` + `public/pwa-icon.svg` + index.html iOS-meta; manifest build-generate,
bkz KN-C2 → CLOSED). Bu O8, hangi **59 kabul-kapısının** + 8 gate-çıktısının + 60+ kör-nokta maddesinin
**yeşil olması gerektiğini** ve **nasıl kanıtlanacağını** tanımlar.

> **Bu revizyonda (2026-07-10) kod-ile-kapatılan doğrulama açıkları:** KN-C2 (PWA gerçekte VAR),
> KN-C3 (`server.ts` = **3191 satır**, "163k" o değil dosya-boyutu-byte), KN-C5 (vitest **`projects`**
> ile zaten bölünmüş; "tek run" varsayımı düzeltildi). Detay §7.7 + §10.

---

## 1. Convergence Tanımı (formal)

Bir **modül M** *converged* sayılır ⇔ üç bileşen aynı anda doğru:

```
converged(M)  ⇔  parity(M) = 1.0            (tüm kabul kriterleri GREEN)
             ∧  gate(M)   = GREEN           (typecheck ∧ lint ∧ vitest-fresh ∧ e2e)
             ∧  ledger(M) = CLOSED          (her kör-nokta maddesi kanıtla kapandı)
```

**Program-düzeyi convergence:**
```
CONVERGED(Odyssey)  ⇔  ∀ M ∈ {Faz0, Research, Documents, Email, Notes, Calendar, Cookbook,
                                Security-O6, Design/PWA-O2} :  converged(M)
```

**Tek-sayı ölçüt:** `convergence_score = (Σ geçen_kapı) / (Σ toplam_kapı)` → hedef **1.0**.
Toplam kapı sayımı §5 matrisinde; **CRITICAL kapılar** (güvenlik/izolasyon/regresyon) `convergence_score`
1.0'a ulaşsa bile **her biri ayrıca GREEN** olmalı (gizleme yasağı — bir CRITICAL RED ise program RED).

**Ledger-CLOSED kuralı:** bir kör-nokta maddesi kapanır ⇔ (a) **doğrulama testi/komutu** eklenir ve
yeşil, VEYA (b) **Emre kararı** (T0) kayda geçer ve plan güncellenir, VEYA (c) madde **kapsam-dışı**
işaretlenip gerekçesi yazılır. "Bilinmeyen" durumda bırakmak = ledger AÇIK = modül **converged değil**.

---

## 2. Modül Envanteri ve Bağımlılık Grafiği (koda karşı doğrulanmış)

| Modül | Plan .md | Kod bugün | Bağımlılık (npm) bugün | Test bugün |
|---|---|---|---|---|
| **Faz-0 Temel** (vector-store + module-registry + config-toggle) | `01` §5 Faz 0 | `server/store/` SQLite VAR, `server/rag.ts` VAR, `sqlite-vec@0.1.9` VAR; **`module-registry.ts` YOK** | `sqlite-vec` ✓ | `tests/rag.e2e.test.ts` VAR; module-toggle testi YOK |
| **Research** (deep_research + SearXNG) | `01` §5 Faz 1 | ❌ YOK | — | `tests/web-search-*` (farklı) VAR; research YOK |
| **Documents** (PDF/office/md + editör + upload-validate) | `05/documents.md` | ❌ processor YOK; `server/files.ts` temel VAR | unpdf/mammoth/xlsx/marked/dompurify **hepsi MISSING** | `tests/file-transfer.test.ts` VAR; documents YOK |
| **Email** (IMAP/SMTP + triage) | `05/email-mcp.md` | ❌ YOK; ToolRegistry choke-point VAR | imapflow/nodemailer/mailparser **MISSING** | `tests/tool-registry.test.ts` VAR; email YOK |
| **Notes/Tasks** (memory + scheduler) | `01` §5 Faz 4 | ❌ kalıcı not/task YOK; `webhooks`/`notify` altyapı ipucu VAR | — | `tests/webhooks.test.ts`, `tests/notify.test.ts` VAR (yakın); notes YOK |
| **Calendar** (CalDAV/ICS) | `05/calendar-caldav.md` | ❌ self-hosted YOK; `GoogleCalendarBrowser.tsx` read-only VAR | tsdav/node-ical/rrule/ical-generator **MISSING** | `tests/ui/GoogleCalendarBrowser.test.tsx` VAR; caldav YOK |
| **Cookbook** (donanım-farkında öneri) | `01` §5 Faz 6 | ❌ öneri motoru YOK; `embed-catalog`/`cockpit-models` VAR | — | `tests/embed-catalog.test.ts`, `tests/cockpit-models.test.ts` VAR (yakın); cookbook YOK |
| **MCP-Extensions** (hooks/manifest/audit) | `05/mcp-extensions.md` | choke-point + interceptors + supervisor VAR; **`hooks.ts`/`manager.ts` YOK** | `@modelcontextprotocol/sdk` ✓, `zod` ✓ | `tests/upstream-guard.test.ts`, `tests/tool-interceptors.test.ts` VAR; hooks/manager YOK |
| **Security O6** (2FA/RBAC/tool-policy/poison-guard/threat-model) | `07-security.md` | tier+scope+adminGuard VAR; **TOTP/role/poison-guard YOK** | `jose` ✓; otplib/qrcode **MISSING** | `tests/security-*` VAR; totp/rbac/poison YOK |
| **Design/PWA O2** (Claude Design handoff + PWA) | `03-claude-design-ui.md` | tab-shell VAR, `ThemeToggle` VAR; **PWA VAR** (`vite-plugin-pwa` + `public/pwa-icon.svg` + index.html iOS-meta; statik `manifest.json` YOK çünkü VitePWA build-generate) | `vite-plugin-pwa` ✓ | `tests/ui/pwa.test.ts` VAR ve **DES-3'ü kaynak-seviyede zaten korur** (VitePWA/standalone/runtimeCaching assert), `tests/ui/theme.test.tsx` VAR |

**Bağımlılık grafiği (convergence sırası):**
```
Faz-0 Temel (vector-store + module-registry + config-toggle)   ◄── BLOCKER, herkes buna bağlı
   │
   ├──► Research ─┐
   ├──► Documents ┤  (Faz 1–6 birbirinden bağımsız → Faz-0 GREEN sonrası PARALEL)
   ├──► Email ────┤
   ├──► Notes ────┤
   ├──► Calendar ─┤
   └──► Cookbook ─┘
MCP-Extensions ─── choke-point'e paralel (Faz-0'dan bağımsız başlar; store audit tablosu için Faz-0 store'a değer)
Security O6 ─────── RBAC.role → tool-policy zinciri; poison-guard tam paralel
Design/PWA O2 ───── her modülün UI'ı için handoff üretir (sürekli, modüllere paralel)
```
**Kural (CLAUDE.md Tier-1):** Faz-0 GREEN olmadan hiçbir modül fazı spawn edilmez.

---

## 3. Kalite-Gate Tanımı (her modülde zorunlu, `converged` ön-koşulu)

`gate(M) = GREEN` ⇔ aşağıdaki **8 çıktının** tümü temiz (CLAUDE.md pre-ship + modül .md'leri):

| # | Gate | Komut | Kabul | Kaynak |
|---|---|---|---|---|
| G1 | **Typecheck** | `npm run lint` (= `tsc --noEmit`) | 0 hata | `package.json` scripts |
| G2 | **Lint** | `eslint .` (fix'siz doğrula) | 0 hata | `eslint@9` VAR |
| G3 | **Unit/integration (fresh)** | `npx vitest run` (convergence-bağlayıcı: `unit`+`ui` projeleri) | ilgili proje suite'i yeşil (modül testleri dahil) | `vitest@4.1.8` (`projects` bölünmüş) |
| G4 | **E2E (ilgili)** | `npx playwright test` (modülün happy-path'i) | ilgili senaryo yeşil | `@playwright/test@1.61` |
| G5 | **Build** | `npm run build` (vite + esbuild server + mcp-stdio) | çıktı üretilir, hata yok | `package.json` build |
| G6 | **SEA/binary uyumu** (native-binding guard) | `npm ls` C++ addon taraması + `npm run build:sea` (documents/email/calendar deps girdiğinde) | native-binding girmedi | `documents.md` P9, `sea-config.json` |
| G7 | **Migration idempotent** (DB dokunan modüller) | migration testi 2× uygula = tek uygulama | v-zinciri kırılmadı | `calendar.md` Faz0 DoD, `mcp-ext.md` Faz C |
| G8 | **Supply-chain** (yeni deps) | `npm audit` + `tob-supply-chain-risk-auditor` + lisans MIT/ISC pin | 0 kritik, lisans temiz | `email-mcp.md` R1, `07` §5 |

**Gate uygulanabilirlik matrisi** (hangi modül hangi gate'e tabi):

| Modül | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8 |
|---|---|---|---|---|---|---|---|---|
| Faz-0 Temel | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – |
| Research | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓(searxng opsiyonel) |
| Documents | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** | – | **✓** |
| Email | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | **✓** |
| Notes/Tasks | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Calendar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✓** | **✓** |
| MCP-Extensions | ✓ | ✓ | ✓ | ✓(mcp e2e) | ✓ | – | **✓** | – |
| Security O6 | ✓ | ✓ | ✓ | ✓(2fa e2e) | ✓ | – | ✓(role/totp migration) | **✓** |
| Design/PWA O2 | ✓ | ✓ | ✓(RTL) | ✓(pwa/a11y) | ✓ | – | – | – |

(**✓ kalın** = o modül için özellikle kritik/riskli gate.)

> **G3 kapsam notu (kod-doğrulandı, KN-C5 kapanışı):** `vitest.config.ts` **`projects`** ile bölünmüş —
> `unit` (`tests/**` + `server/**`, e2e `RUN_E2E` opt-in), `ui` (`tests/ui/**`), `scripts`
> (`scripts/tests/**`), `orchestra` (yalnız seçili `orchestration/**` dosyaları; geniş suite gate-wired
> değil). **Convergence G3 yalnız `unit`+`ui` projelerine bağlanır** (yeni modül testleri buraya girer);
> `orchestra`/`tunnel`/`contract` lane'leri Odyssey-dışıdır. "Tek `vitest run` tüm-repo yeşil" **yanlış
> varsayım**dı — payda app-suite ≈ **221** dosya (435 değil). Live-gated (`*.e2e`, `*-live`) testler
> `RUN_E2E`/env-guard ile ayrı; convergence deterministik projelere bağlanır (O8-K5).

---

## 4. Convergence Kabul Matrisi — Modül × Kriter (parity, kaynağıyla)

> Her satır bir kabul kriteri; kaynağı ilgili modül .md'sinden **birebir** toplandı.
> Durum bugün hepsi **RED** (kod yok) — bu matris "GREEN olması gereken" hedef listesidir.
> `id` kolonu convergence dashboard'unda izlenir (`convergence_score` paydası = tüm `id` sayısı).

### 4.1 Faz-0 Temel (vector-store + module-registry + config-toggle) — 4 kapı

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| F0-1 | Embedding yaz → benzerlik sorgusu doğru döner | `server/__tests__/persistence-vector.test.ts` (`01` §5 Faz0) | – |
| F0-2 | `.env` `MODULE_RESEARCH=0` iken `/api/research` 404 | `server/__tests__/module-toggle.test.ts` | – |
| F0-3 | `module-registry.ts` route kaydını sürer (server.ts monolit hafifler) | registry unit + route smoke | **✓** (KN-4 monolit) |
| F0-4 | Persistence kalıcı: süreç restart sonrası veri durur (JSON-only regresyon yasak) | store restart testi | **✓** (KN-3 uçurum) |

### 4.2 Documents — 10 kapı (kaynak: `05/documents.md` §4 P1–P10)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| DOC-P1 | PDF/DOCX/XLSX/Markdown → metne çıkarılıyor | `documents.test.ts` fixture yeşil | – |
| DOC-P2 | `POST /api/documents/extract`; traversal/permission/404 doğru kod | `documents-route.test.ts` | **✓** (traversal) |
| DOC-P3 | Upload validation: ext+magic-byte allowlist; `.pdf`=exe reddi | `upload-validate.test.ts` (415/413) | **✓** (spoof) |
| DOC-P4 | Writing-first editör: md preview + sanitize + save + dirty-guard | `DocumentEditor.test.tsx` | – |
| DOC-P5 | Config-driven: `DOCUMENTS_MAX_MB`/`DOCUMENTS_ALLOWED_EXT` etkili | env toggle testi | – |
| DOC-P6 | Agent `extract_document` tool ReAct'te PDF/DOCX okur | tool-registry schema + exec | – |
| DOC-P7 | Demo mode kırılmadı (`VIRTUAL_FILES` md/text extract) | demo-path testi | **✓** (regresyon) |
| DOC-P8 | Regresyon yok: `workspace/upload\|download\|file\|tree` yeşil | mevcut suite | **✓** (regresyon) |
| DOC-P9 | Build: `tsc`+`build`+SEA temiz (native-binding girmedi) | G5+G6 | **✓** (SEA) |
| DOC-P10 | Güvenlik: sanitize HTML (XSS yok) + path guard reuse + `logSecurity` | XSS + audit testi | **✓** (XSS) |

### 4.3 Email — 9 kapı (kaynak: `05/email-mcp.md` §5)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| EM-1 | IMAP okuma: `email_search`+`email_get` inbox listeler + mesaj döner | `imap-client.test.ts` (mock transport) + canlı smoke | – |
| EM-2 | SMTP gönderim: `email_send` (privileged, RBAC-gated) + audit | `smtp-client.test.ts` + `register.test.ts` | **✓** (privileged) |
| EM-3 | Triage: `{priority,category,labels}`; $0 qwen3:8b | `triage.test.ts` | – |
| EM-4 | Summary: çok-mesajlı thread → tek özet | `summarize.test.ts` | – |
| EM-5 | Reply-draft: göndermeden taslak (SMTP çağrısı = 0) | `draft.test.ts` (mock count 0) | **✓** (yan-etki yok) |
| EM-6 | Config-driven: `EMAIL_MCP_ENABLED=0` → araçlar görünmez; `=1` görünür | `register.test.ts` | **✓** (kapalı-varsayılan) |
| EM-7 | MCP-as-extension parity: `/mcp` üzerinden ayrı süreç olmadan expose | `email-mcp.expose.test.ts` | – |
| EM-8 | Güvenlik: parola vault'ta şifreli; log/return sızıntı yok; scope-gate | grep-no-plaintext + gate testi | **✓** (secret) |
| EM-9 | Kalite kapısı: typecheck ✓ lint ✓ vitest ✓ (email suite dahil) | G1+G2+G3 | – |

### 4.4 Calendar — 8 kapı (kaynak: `05/calendar-caldav.md` §5)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| CAL-1 | CalDAV sync artımlı: ctag no-op / delta / 412 çakışma çökmeden | `caldav.test.ts` (mock HTTP) + Radicale opsiyonel | **✓** (conflict) |
| CAL-2 | ICS round-trip: RRULE+VALARM import→edit→export (RFC5545 geçerli) | `ics.test.ts` round-trip | – |
| CAL-3 | Recurrence: `singleEvents` sağlayıcıdan bağımsız; EXDATE/RDATE/UNTIL/COUNT; DST kayması yok | `recurrence.test.ts` | **✓** (DST/OOM) |
| CAL-4 | Reminders: offset'te tek tetik; restart catch-up; recurrence yeniden-plan | `reminders.test.ts` (fake timers) | **✓** (çift-tetik) |
| CAL-5 | Provider-agnostic: ≥2 provider aynı `CalendarProvider` (CalDAV+ICS); Google 3. | provider arayüz testi | – |
| CAL-6 | Tenant izolasyon + auth: `/api/calendar/*` apikey/tenant; çapraz-tenant sızıntı yok | `routes.test.ts` | **✓** (izolasyon) |
| CAL-7 | $0/self-hosted: env'siz açılışta ICS+local çalışır, CalDAV opsiyonel | boot-no-env testi | – |
| CAL-8 | Kalite kapısı: typecheck+lint+vitest yeşil; v6 migration zinciri kırılmadı | G1+G2+G3+G7 | **✓** (migration) |

### 4.5 MCP-Extensions — 10 kapı (kaynak: `05/mcp-extensions.md` §5 P1–P10)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| MCP-P1 | Tek ekleme protokolü: `installPlugin(manifest)` (global/tenant/katalog aynı yol) | `mcp-manager.test.ts` | – |
| MCP-P2 | Lifecycle FSM: `validating→active\|rejected\|vetoed\|quarantined→removed` API'de | `mcp-manager.test.ts` + status endpoint | – |
| MCP-P3 | Hook framework: `onRegister/onDiscover/onToolCall/onError/onQuarantine/onRemove` + veto; interceptor bozulmaz | `mcp-hooks.test.ts` | – |
| MCP-P4 | Audit trail: her olay `plugin_events`'e tenant-scope yazılır+listelenir | `mcp-audit.test.ts` | **✓** (tenant-scope) |
| MCP-P5 | list_changed: install/remove sonrası client bildirim alır (opt-in) | `mcp-list-changed.test.ts` | – |
| MCP-P6 | Config-driven genişleme: kaynak-kopyalamadan (npx/uvx/http); uzak katalog fail-soft | `mcp-catalog-remote.test.ts` | – |
| MCP-P7 | Güvenlik-korunur: tüm yollar `validateUpstreamConfig`+`sanitizeUpstreamOutput`+manifest-pin | guard by-pass yok testi | **✓** (SSRF/allowlist) |
| MCP-P8 | Tenant-izolasyon: `owner` her geçişte korunur; cross-tenant invoke reddi | owner-preservation testi (Faz 24 invariant) | **✓** (izolasyon) |
| MCP-P9 | Tek dispatch: ikinci tool-dispatch path yok; her şey `ToolRegistry.execute` | mimari invariant testi | **✓** (choke-point) |
| MCP-P10 | Test yeşil: hooks/manager/audit/list-changed/catalog-remote/e2e + mevcut guard/stdio-e2e | `npx vitest run` tam yeşil | **✓** (regresyon) |

### 4.6 Security O6 — 8 kapı (kaynak: `07-security.md` §6)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| SEC-1 | TOTP enrollment+verify+recovery | `totp.test.ts` + `POST /api/security/2fa/*` e2e | **✓** (auth) |
| SEC-2 | Step-up 2FA admin işlemde: `totp_enabled=1` iken `X-TOTP`'siz → 401 | step-up gate testi | **✓** (step-up) |
| SEC-3 | RBAC admin/non-admin: non-admin → 403 admin rotada | `rbac.test.ts` | **✓** (yetki) |
| SEC-4 | Tehlikeli tool non-admin'e kapalı: privileged+non-admin → `tool_not_permitted` | `execute()` role-gate testi | **✓** (elevation) |
| SEC-5 | Config-driven policy: `TOOL_POLICY_DENY_TIERS` env | tool-policy pure-fn testi | – |
| SEC-6 | Prompt-injection nötrleme: upstream payload flag | `poison-guard.test.ts` | **✓** (injection) |
| SEC-7 | threat-model dokümante + STRIDE traceability | `07-security-threat-model.md` + izlenebilirlik tablosu | – |
| SEC-8 | Auth event audit: `audit_events` 2FA/role-deny kaydeder | audit testi | **✓** (repudiation) |

### 4.7 Design/PWA O2 (cross-cutting) — 4 kapı (kaynak: `01` §7 + `03`)

| id | Kriter | Test / Kanıt | CRITICAL? |
|---|---|---|---|
| DES-1 | Her modül UI'ı Claude Design bundle'dan türetildi (HTML+screenshot+README → `.tsx`) | handoff kayıt/izleme (Emre görsel onay) | – |
| DES-2 | Design bundle asla `localhost`/MCP'ye bağlanmaz; canlı veri Claude Code'da gelir | handoff-disiplin denetimi (premise §1.2) | **✓** (premise) |
| DES-3 | PWA: VitePWA build-generate manifest + iOS web-clip + installability | `tests/ui/pwa.test.ts` **kaynak-seviye GREEN'e hazır** (VitePWA/standalone/runtimeCaching/pwa-icon assert; KN-C2 CLOSED) | – |
| DES-4 | Tema + i18n uyumu: her yeni tab `src/locales/{en,tr}` + `ThemeToggle` ile çalışır | `theme.test.tsx` + `i18n.test.tsx` genişletme | – |

### 4.8 Research + Notes + Cookbook (henüz ayrı .md yok — `01` §5'ten türetilmiş placeholder kriterleri)

> **UYARI (KN-C1):** Bu üç modülün ayrı feature .md'si `05-features/` altında **YOK**
> (yalnız documents/email/calendar/mcp-extensions var). Aşağıdaki kriterler `01-vision-premise.md`
> §5 Faz 1/4/6'dan **türetilmiş taslaktır**; ilgili feature .md yazılınca **kesinleşir**.

| id | Modül | Taslak kriter | Test (planlanan) |
|---|---|---|---|
| RES-1 | Research | Sorgu → kaynak listesi + sentez (mock SearXNG) | `server/__tests__/research.test.ts` |
| RES-2 | Research | Vektör-store'a yazma (Faz-0 store) + toggle `MODULE_RESEARCH` | store + toggle testi |
| NOT-1 | Notes/Tasks | Not oluştur → cron tetikler → hatırlatma event'i | `server/__tests__/notes-scheduler.test.ts` |
| NOT-2 | Notes/Tasks | Memory Faz-0 vektör-store'a bağlanır | memory persist testi |
| CBK-1 | Cookbook | RAM/VRAM girdisi → uygun qwen/model önerisi | `server/__tests__/cookbook.test.ts` |
| CBK-2 | Cookbook | `embed-catalog`/`cockpit-models` ile eşleşme | catalog-map testi |

---

## 5. Convergence Skor Tablosu (paydalar + CRITICAL sayımı)

| Modül | Toplam kapı | CRITICAL kapı | Gate seti | Bugün GREEN |
|---|---|---|---|---|
| Faz-0 Temel | 4 | 2 | G1,G2,G3,G5,G6,G7 | 0 |
| Documents | 10 | 6 | G1–G6 | 0 |
| Email | 9 | 4 | G1,G2,G3,G5,G6,G8 | 0 |
| Calendar | 8 | 5 | G1–G5,G7,G8 | 0 |
| MCP-Extensions | 10 | 5 | G1–G5,G7 | 0 |
| Security O6 | 8 | 6 | G1–G5,G7,G8 | 0 |
| Design/PWA O2 | 4 | 1 | G1–G5 | 0 (DES-3 PWA kaynak-seviye hazır — KN-C2 CLOSED; run-doğrulaması bekliyor) |
| Research (taslak) | 2 | 0 | G1–G5,G8 | 0 |
| Notes (taslak) | 2 | 0 | G1–G5,G7 | 0 |
| Cookbook (taslak) | 2 | 0 | G1–G5 | 0 |
| **TOPLAM** | **59 kapı** | **29 CRITICAL** | **8 gate** | **0 / 59** |

`convergence_score = 0 / 59 = 0.00` (başlangıç). **Hedef = 59/59 = 1.00 + tüm 29 CRITICAL GREEN.**

> **Not:** taslak modüller (Research/Notes/Cookbook) feature .md yazılınca kapı sayısı artacak
> (her biri ~8–10'a çıkar, documents/email emsali). Payda o zaman **güncellenir**; bu O8 belgesi
> convergence dashboard'un **canlı paydası**dır (feature .md eklendikçe revize).

---

## 6. E2E Convergence Senaryoları (Playwright — modül-üstü akış)

Unit/integration testler modül-içi; convergence **modüller-arası akışı** da ister. Minimum e2e set:

| id | Senaryo | Zincir | Gate |
|---|---|---|---|
| E2E-1 | Belge → agent okuma | upload PDF → tree'de görün → `extract_document` tool → agent-chat cevabında metin | G4 (Documents) |
| E2E-2 | Email → triage → draft | mock IMAP inbox → `email_triage` → `email_draft_reply` (SMTP çağrısı 0) | G4 (Email) |
| E2E-3 | Calendar ICS round-trip | `.ics` import → CalendarPanel'de görün → export.ics → harici-parse geçerli | G4 (Calendar) |
| E2E-4 | Plugin install → tool görün | `POST /api/saas/upstreams` → `installPlugin` FSM `active` → `/mcp` tools/list'te görün → list_changed | G4 (MCP-Ext) |
| E2E-5 | 2FA step-up | enroll → verify → admin-op `X-TOTP`'siz 401 → token ile 200 | G4 (Security) |
| E2E-6 | Design handoff regresyon | yeni modül tab'ı tema+i18n+a11y ile render, `localhost`-bağımsız mock veri | G4 (Design) |
| E2E-7 | Toggle-off boot | tüm `MODULE_*=0` ile server boot hatasız + ilgili route 404 | G3/G5 (Faz-0) |
| E2E-8 | Full regresyon | mevcut `conformance.e2e.test.ts` + `mcp-stdio.e2e.test.ts` + `rag.e2e.test.ts` yeşil kalır | G3/G4 (tüm) |

**Convergence e2e-kapısı:** E2E-1..8 hepsi yeşil olmadan program `CONVERGED` ilan edilmez.

---

## 7. Modül-Bazlı Kör-Nokta Ledger — Kapanma Kanıtı (closing evidence)

> **Format:** her modülün .md'sindeki ledger maddeleri buraya **kapanma-kanıtı kolonu** ile taşındı.
> `Kapanış` = madde nasıl CLOSED olur (test/komut/karar). `Durum` bugün hepsi **AÇIK** (kanıt üretilmedi).

### 7.1 Program-düzeyi (kaynak: `01` §8)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| KN-1 | Bilinmeyen | odysseus repo (github.com/pewdiepie-archdaemon/odysseus, 82k★) **doğrulanmadı** — brief'ten | `WebFetch` odysseus README/mimari → sapma varsa `01` güncelle | **AÇIK** |
| KN-2 | Varsayım | Claude Design "HTML+screenshot+README" export şeması doğrulanmadı | İlk modülde gerçek Design export pilotu → `03`/`06` ampirik düzelt | **AÇIK** |
| KN-3 | Risk | Persistence uçurumu (JSON→SQLite+vektör). **Kısmen kapandı:** `server/store/` SQLite + `sqlite-vec@0.1.9` + `server/rag.ts` **KODDA VAR** | Faz-0 F0-1/F0-4 testi GREEN → tam CLOSED | **YARI-AÇIK** (temel var, adaptör testi yok) |
| KN-4 | Risk | `server.ts` monolit (**3191 satır** doğrulandı `wc -l`; "163k" = byte-boyutu ≈163 KB, satır değil — bkz KN-C3) + `server/module-registry.ts` **YOK** | F0-3 `module-registry` testi GREEN | **AÇIK** (monolit sürüyor; satır-sayısı CLOSED) |
| KN-5 | Belirsizlik | Google gmail/calendar tab'ları korunacak mı / self-hosted mu | Emre T0 kararı → `01`+`calendar.md`+`email-mcp.md` güncelle | **AÇIK (Emre)** |
| KN-6 | Varsayım | `.env` ~21→40+ toggle gerçekten gerekli mi (YAGNI) | Modül ihtiyaç doğunca ekle; §7-3 minimum `MODULE_*` | **AÇIK (YAGNI-izle)** |
| KN-7 | Risk | SearXNG/IMAP/CalDAV self-hosting altyapı ister | Her modül toggle-off default + mock-adapter → altyapısız test geçer | **AZALTILDI** (mock-strateji planlı) |
| KN-8 | Bilinmeyen | 2FA/TOTP kütüphane seçimi + entegrasyon yüzeyi | `07` §7 GAP-1/GAP-2 ile aynı → aşağı bkz | **AÇIK** |

### 7.2 Documents (kaynak: `05/documents.md` §5)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| DOC-K1 | Varsayım | unpdf/pdfjs saf-JS + SEA-uyumlu | T0.1 `npm ls` native-binding tara + G6 | **AÇIK** |
| DOC-K2 | Bilinmeyen | SEA bundling dompurify/jsdom taşır mı | `isomorphic-dompurify` veya client-only render; G6 | **AÇIK** |
| DOC-K3 | Risk | XLSX/PPTX büyük dosya → bellek | `MAX_EXTRACT_CHARS` + per-tür limit (Faz3) testi | **AÇIK** |
| DOC-K4 | Varsayım | demo-mode md/text yeterli | Küçük gerçek PDF/DOCX fixture ekle; DOC-P7 | **AÇIK** |
| DOC-K5 | Bilinmeyen | `permissions.fileRead/Write` hangi kapı | Faz2 `fileRead`; DOC-P2 testi | **AÇIK** |
| DOC-K6 | Risk | Global `express.raw` 1gb DoS yüzeyi | Faz3 erken-red (magic-byte header sonrası); DOC-P3 | **AÇIK** |
| DOC-K7 | Bilinmeyen | CodeMirror mı textarea+preview mi (bundle) | MVP textarea+marked; `size-limit` ölç | **AÇIK (YAGNI)** |
| DOC-K8 | Varsayım | MCP `resources/read` belge-extract sunmalı mı | Faz5 opsiyonel; şimdilik `text/plain` | **AÇIK (kapsam)** |
| DOC-K9 | Risk | odysseus repo link doğrulanmadı (= KN-1) | KN-1 ile birlikte kapanır | **AÇIK** |
| DOC-K10 | Bilinmeyen | orchestra pipeline'a bağlanmalı mı | Kapsam-dışı; Faz5 agent tool köprüsü yeter | **KAPSAM-DIŞI** |

### 7.3 Email (kaynak: `05/email-mcp.md` §6)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| EM-A1 | Varsayım | imapflow/nodemailer/mailparser MIT+host-yalın | `npm view <pkg> license` + G8 | **AÇIK** |
| EM-A2 | Varsayım | `server/ai.ts` `aiCall` temiz inject edilebilir | Adım5 öncesi `server/ai.ts` Read → imza teyit | **AÇIK (Read gerek)** |
| EM-A3 | Varsayım | `db.encrypt/decrypt` çift-yönlü + string yazar | `server/db.ts` encrypt/decrypt Read → teyit | **AÇIK (Read gerek)** |
| EM-A4 | Varsayım | `server.ts` bootstrap'te register hook var | `server.ts` `ToolRegistry.register`/`autoconnect*` çağrı noktası Read | **AÇIK (Read gerek)** |
| EM-R1 | Risk | 3 yeni npm supply-chain yüzeyi | pin + G8 (`tob-supply-chain-risk-auditor`) | **AÇIK** |
| EM-R2 | Risk | IMAP/SMTP parola hassas (OAuth değil) | vault + app-password/XOAUTH2 dokümante; EM-8 | **AZALTILDI** (vault planlı) |
| EM-R3 | Risk | SSRF vs self-hosted çelişkisi | `EMAIL_ALLOW_INTERNAL_HOST` opt-in; Adım9 host-guard testi | **AZALTILDI** |
| EM-R4 | Risk | Uzun IMAP çağrıları timeout | `ToolCtx.onProgress`+`abortSignal` (choke-point'te var) | **AZALTILDI** |
| EM-R5 | Risk | 020ccfa7 connector karışıklığı | Netleştirildi (§1.13): connector ≠ ollamas backend | **CLOSED** (belgede netleşti) |
| EM-R6 | Risk | HTML e-posta XSS / ek güvenliği | frontend sanitize (backend kapsam-dışı, not düşüldü) | **KAPSAM-DIŞI** |
| EM-D1 | Karar | Sağlayıcı-agnostik IMAP/SMTP mi Gmail-API mi | Emre T0 (öneri: IMAP/SMTP+opsiyonel XOAUTH2) | **AÇIK (Emre)** |
| EM-D2 | Karar | Triage varsayılan model qwen3:8b, cloud fallback? | Emre T0 | **AÇIK (Emre)** |
| EM-D3 | Karar | Çok-kiracı per-tenant vault? | Öneri: tek-kiracı önce, tenant-scoping Faz-2 | **AÇIK (Emre)** |

### 7.4 Calendar (kaynak: `05/calendar-caldav.md` §6)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| CAL-K1 | Bilinmeyen | notes/tasks ortak scheduler var mı (grep: bağımsız reminder YOK; `webhooks/outbound` retry VAR) | Faz5 öncesi `server/` periyodik tick döngüsü ara; yoksa `setInterval` | **AÇIK** |
| CAL-K2 | Varsayım | SQLite adapter yeni tablo+range-query kaldırır | Faz0 gerçek-adapter range-query + `dtstart` index testi | **AÇIK** |
| CAL-K3 | Risk | tsdav gerçek CalDAV uyumu (iCloud/Google quirks) | Unit mock + Radicale docker; known-quirks notu; CAL-1 | **AZALTILDI** (mock planlı) |
| CAL-K4 | Risk | RRULE sonsuz kural → OOM | `expand()` zorunlu pencere + max-cap 1000; CAL-3 | **AZALTILDI** |
| CAL-K5 | Bilinmeyen | `/api/calendar/*` auth: tenant/apikey mi Firebase mi | Faz4 öncesi `server.ts` korunan-route middleware teyit; CAL-6 | **AÇIK (Read gerek)** |
| CAL-K6 | Varsayım | RBAC bu modülde kapsam-dışı (O6'ya devir) | Route tenant-scoped kalır; O6 kesişimi | **KAPSAM-DIŞI (O6)** |
| CAL-K7 | Risk | GoogleCalendarBrowser absorpsiyonu consent/token bozabilir | Değiştirmeden wrap; mevcut `GoogleCalendarBrowser.test.tsx` koru; CAL-5 | **AZALTILDI** |
| CAL-K8 | Bilinmeyen | TZID depolama: UTC mi TZID+wallclock mi | `dtstart` UTC + ayrı `tzid` + `all_day` bayrağı; CAL-3 DST testi | **AÇIK** |
| CAL-K9 | Kapsam | c7f423f3 harici connector self-hosted plana dahil değil | Netleştirildi (§1.1): connector ≠ modül | **CLOSED** (belgede netleşti) |

### 7.5 MCP-Extensions (kaynak: `05/mcp-extensions.md` §6)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| MCP-K1 | Varsayım | "gwv2 hooks" kodda YOK; interceptors.ts embriyo | Emre onayı: "gwv2"=`hooks.ts` sabitle; MCP-P3 | **AÇIK (Emre)** |
| MCP-K2 | Risk | `listChanged:true` conformance kırabilir | `MCP_LIST_CHANGED=1` opt-in gate; MCP-P5 | **AZALTILDI** |
| MCP-K3 | Bilinmeyen | Uzak katalog registry Emre host edecek mi (SSRF) | Faz E opsiyonel; env-yokken bit-aynı; MCP-P6 | **AÇIK (Emre)** |
| MCP-K4 | Varsayım | `manifestFromUpstream` backward-compat | Default policy = mevcut davranış; MCP-P1 regresyon | **AÇIK** |
| MCP-K5 | Risk | `plugin_events` unbounded büyür | `MCP_AUDIT_RETENTION_DAYS` purge (v2 notu); MCP-P4 | **AÇIK (v2)** |
| MCP-K6 | Bilinmeyen | per-plugin `rateLimit/adminOnly` enforce noktası (RBAC'da) | Alan manifest'te; enforce O6'ya devir (kesişim işaretli) | **KAPSAM-DIŞI (O6)** |
| MCP-K7 | Varsayım | SSRF residual (DNS-rebind connect-anında pin yok) | Plan-dışı; ayrı güvenlik-lane işi (dürüst taşındı) | **KAPSAM-DIŞI** |
| MCP-K8 | Risk | Boot fan-out `installPlugin`'e taşımak Faz-24 izolasyonu kırabilir | Faz B owner-preservation testi zorunlu; MCP-P8 | **AÇIK (CRITICAL)** |
| MCP-K9 | Bilinmeyen | catalog/supervisor/interceptors characterization testi YOK | Faz F refactor öncesi characterization test yaz | **AÇIK** |

### 7.6 Security O6 (kaynak: `07-security.md` §7)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| SEC-VAR1 | Varsayım | "Şef-3 poison-guard" kodda YOK; verifier deseninin uzantısı | Emre onayı: yeni-inşa mı; SEC-6 | **AÇIK (Emre)** |
| SEC-VAR2 | Varsayım | RBAC `role` `tenants`'ta (users tablosu yok); tenant=user | Çok-kullanıcılı-tek-tenant kapsam-dışı kabul | **AÇIK (Emre)** |
| SEC-VAR3 | Varsayım | TOTP secret `db` AES master-key ile şifreli | O6.1 öncesi `server/db.ts` encrypt API Read (= GAP-1) | **AÇIK (Read gerek)** |
| SEC-BIL1 | Bilinmeyen | Lokal mod owner'a 2FA uygulanmalı mı | Öneri: 2FA yalnız SAAS_ENFORCE=1 admin; Emre kararı | **AÇIK (Emre)** |
| SEC-BIL2 | Bilinmeyen | otplib vs otpauth (supply-chain) | G8 `tob-supply-chain-risk-auditor` ile teyit | **AÇIK** |
| SEC-BIL3 | Bilinmeyen | Poison-guard false-positive eşiği (korpus yok) | Gerçek upstream-tool çıktı korpusu topla; SEC-6 kalibrasyon | **AÇIK** |
| SEC-BIL4 | Bilinmeyen | redact→poison sıralaması guard'ı köreltir mi | O6.5 adım2 edge-case testi | **AÇIK** |
| SEC-R1 | Risk | RBAC migration owner'ı yanlışlıkla non-admin yapar | migration "tek tenant → role='admin'" backfill + idempotent test | **AÇIK (CRITICAL)** |
| SEC-R2 | Risk | Step-up gate yanlış zincir (kilit/bypass) | `authMiddleware→requireRole→requireTotp` sıra e2e sabitle; SEC-2 | **AÇIK (CRITICAL)** |
| SEC-R3 | Risk | In-memory replay-koruma çok-replica'da paylaşılmaz | store-backed replay penceresi (O6.1 adım1 notu) | **AÇIK** |
| SEC-R4 | Risk | Poison-guard güvenlik-teatro (regex LLM saldırıyı çözmez) | Dürüst kabul: defense-in-depth; asıl savunma verifier izolasyonu | **CLOSED** (dürüst-kabul, kapsam netleşti) |
| SEC-R5 | Risk | O-serisi header/format tutarsızlığı | Şablon-header standardı (bu O8 + `03` emsal) | **AZALTILDI** (bu belge şablon veriyor) |
| SEC-GAP1 | Doğrulama açığı | `server/db.ts` encrypt/decrypt imzası okunmadı | İlk kod-adımından önce Read (= SEC-VAR3, EM-A3) | **AÇIK (Read gerek)** |
| SEC-GAP2 | Doğrulama açığı | `ToolCtx` role/confirmToken wiring (`server.ts` agent-loop) okunmadı | O6.3 öncesi agent-loop ctx-inşa (`server.ts:~1468`) Read; SEC-4 | **AÇIK (Read gerek)** |
| SEC-GAP3 | Doğrulama açığı | MASTER_TASKLIST.md'de O6 yok (roadmap'e bağlı değil) | Emre onayıyla tasklist'e ekle | **AÇIK (Emre)** |

### 7.7 O8-özgü yeni kör-noktalar (bu sentez sırasında keşfedilen)

| id | Tip | Madde | Kapanış Kanıtı | Durum |
|---|---|---|---|---|
| KN-C1 | Doğrulama açığı | **Research / Notes / Cookbook feature .md'leri `05-features/`'da YOK** — kabul kriterleri `01` §5'ten türetilmiş taslak; convergence paydası eksik | O2/O4/… feature .md'leri yaz → §4.8 kesinleş → §5 payda güncelle | **AÇIK** |
| KN-C2 | Nüans | **`01`/`03` "PWA yok" varsayımı YANLIŞ** — PWA gerçekte VAR: `vite-plugin-pwa` (`vite.config.ts:5,14` `registerType:'autoUpdate'`+`display:'standalone'`+`runtimeCaching` NetworkFirst `/api/*`), `public/pwa-icon.svg` (412B) VAR, `index.html` iOS web-clip meta'ları (`apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`, `viewport-fit=cover`) VAR. Statik `public/manifest.json` YOK çünkü **VitePWA build-time üretir**. DES-3 gate `tests/ui/pwa.test.ts` ile kaynak-seviyede zaten korunuyor | Kod okundu (`vite.config.ts`+`index.html`+`public/pwa-icon.svg`+`tests/ui/pwa.test.ts`) → DES-3 kaynak-seviye GREEN'e hazır | **CLOSED** (kod-doğrulandı 2026-07-10) |
| KN-C3 | Nüans | `server.ts` satır sayısı **kesinleşti: 3191 satır** (`wc -l` doğrulandı). "163k" = **dosya-boyutu byte** (≈163 KB), satır değil. `00-MASTER` §0/§7 zaten böyle düzeltmiş; bu O8 KN-4 metni ("163k satır") de yanlıştır → §7.1 KN-4 satırı düzeltildi | `wc -l server.ts` = 3191 (bu oturum) | **CLOSED** (kod-doğrulandı 2026-07-10) |
| KN-C4 | Risk | **59-kapı paydası taslak-modüller eklenince değişir** — `convergence_score` kararsız payda | Feature .md'ler tamamlanınca payda dondur; ara-raporlarda "payda vN" işaretle | **AÇIK** |
| KN-C5 | Varsayım | "Tüm modül testleri **tek `vitest run`**" varsayımı YANLIŞ — `vitest.config.ts` **`projects`** ile zaten bölünmüş (`unit`/`ui`/`scripts`/`orchestra`); geniş `orchestration/tests/**` gate-wired değil. App-suite ≈ **221** dosya (435 tüm-repo değil). Convergence G3 yalnız `unit`+`ui`'ye bağlanır | `vitest.config.ts:57-96` `projects` okundu; app-suite dosya sayımı = 221 | **CLOSED** (kod-doğrulandı; G3 kapsamı §3 notunda kalibre) |
| KN-C6 | Bilinmeyen | E2E-8 "full regresyon" mevcut `conformance.e2e`/`mcp-stdio.e2e`/`rag.e2e` **hâlâ yeşil mi** bilinmiyor (bu oturumda koşulmadı) | Faz-0 öncesi `npx vitest run` + `playwright test` baseline al → yeşil-taban kaydet | **AÇIK (baseline gerek)** |
| KN-C7 | Doğrulama açığı | odysseus-parity kriterleri odysseus **davranışına** değil, brief'teki **modül-listesine** dayanıyor (tüm modüllerde tekrarlanan uyarı) | KN-1 kapanınca (odysseus fetch) her modülün kriteri davranışa göre kalibre edilir | **AÇIK (KN-1'e bağlı)** |

---

## 8. Convergence Yürütme Protokolü (nasıl 1.0'a ulaşılır)

```
[Adım 0]  BASELINE      → `npx vitest run` (`unit`+`ui` proj.) + `RUN_E2E=1 playwright test` → mevcut ~221 app-suite test yeşil-taban (KN-C6 kapat)
[Adım 1]  KN-1 kapat    → odysseus README/mimari fetch → parity kriterlerini davranışa kalibre (KN-C7)
[Adım 2]  Faz-0 GREEN   → F0-1..F0-4 (vector-store adaptör + module-registry + toggle) — BLOCKER
[Adım 3]  PARALEL spawn → Documents ∥ Email ∥ Calendar ∥ MCP-Ext ∥ Security(O6.1/O6.5) ∥ Research ∥ Notes ∥ Cookbook
                          (her biri: RED→GREEN→REFACTOR→gate(M)→ledger(M) kapat)
[Adım 4]  SEC zincir     → O6.2(role) → O6.3(tool-policy) → O6.1(step-up) → O6.4(threat-model, EN SON)
[Adım 5]  E2E           → E2E-1..8 modüller-arası akış yeşil
[Adım 6]  LEDGER SWEEP  → §7 tüm maddeler CLOSED/KAPSAM-DIŞI (hiç AÇIK yok) — Emre-kararı maddeleri T0'da onaylandı
[Adım 7]  CONVERGE      → convergence_score = payda/payda = 1.0 ∧ 29 CRITICAL GREEN ∧ 8 gate GREEN → İLAN
```

**Değişmez kapılar (her adımda):** test-önce · implementer ≠ verifier · Faz-0 bitmeden modül spawn yok ·
CRITICAL gizleme yasak · tek-dispatch (MCP) · owner-preservation · secret sızıntı yok · WHY-only yorum.

---

## 9. Convergence Kontrol Listesi (tek bakışta "bitti mi?")

- [ ] **Baseline:** mevcut ~221 app-suite test (`unit`+`ui`) + e2e yeşil-taban alındı (KN-C6).
- [ ] **KN-1:** odysseus repo doğrulandı, parity kriterleri davranışa kalibre (KN-C7).
- [ ] **Faz-0:** F0-1..F0-4 GREEN (vector-store + module-registry + toggle) — BLOCKER açıldı.
- [ ] **Feature .md tamlığı:** Research/Notes/Cookbook .md yazıldı, §4.8 kesinleşti, §5 payda donduruldu (KN-C1/KN-C4).
- [ ] **Documents:** DOC-P1..P10 GREEN + gate(G1–G6).
- [ ] **Email:** EM-1..9 GREEN + gate(G1,2,3,5,6,8) + `server/ai.ts`/`db.ts`/`server.ts` Read açıkları kapandı (EM-A2/A3/A4).
- [ ] **Calendar:** CAL-1..8 GREEN + gate(G1–5,7,8) + auth-model Read (CAL-K5).
- [ ] **MCP-Extensions:** MCP-P1..P10 GREEN + owner-preservation (MCP-P8/K8) + characterization test (MCP-K9).
- [ ] **Security O6:** SEC-1..8 GREEN + `db.ts`/agent-loop Read (SEC-GAP1/GAP2) + role-migration backfill (SEC-R1) + step-up sıra (SEC-R2).
- [x] **PWA gerçek-durum netleşti (KN-C2 CLOSED):** VitePWA + pwa-icon + iOS-meta VAR; DES-3 kaynak-seviye hazır. Kalan: DES-1/2/4 GREEN + handoff-disiplin denetlendi (DES-2) + `RUN_E2E` ile pwa a11y run-doğrulaması.
- [ ] **E2E:** E2E-1..8 yeşil (modüller-arası + full regresyon).
- [ ] **Emre-kararları (T0):** KN-5, EM-D1/D2/D3, MCP-K1/K3, SEC-VAR1/VAR2/BIL1/GAP3 onaylandı.
- [ ] **Ledger sweep:** §7'de AÇIK madde YOK (hepsi CLOSED/KAPSAM-DIŞI/Emre-onaylı).
- [ ] **Convergence:** `convergence_score = 1.0` ∧ 29 CRITICAL GREEN ∧ 8 gate GREEN → **CONVERGED**.

---

## 10. Kör-Nokta Ledger (bu O8 belgesinin kendi bilinmeyenleri)

| # | Tip | Madde | Etki | Azaltma |
|---|---|---|---|---|
| O8-K1 | Doğrulama açığı | Kapı sayımı (59) **taslak modüller** (Research/Notes/Cookbook, her biri 2 placeholder) yüzünden eksik-tahmin; gerçek payda feature .md'lerle ~2× olabilir | `convergence_score` paydası kayar (KN-C4 ile aynı kök) | Feature .md tamamlanınca §5 paydayı dondur; bu belge "payda vN" versiyonlar |
| O8-K2 | Varsayım | Her modül .md'sindeki kabul kriterleri **doğru ve tam** kabul edildi (bu O8 onları kopyaladı, yeniden-doğrulamadı) | Bir modül .md'si hatalıysa O8 matrisi de hatalı | Her modül .md'si kendi kod-doğrulamasını yaptı (Read/Grep referanslı); O8 meta-katman, kod-tekrar-doğrulama yapmaz |
| O8-K3 | Bilinmeyen | CRITICAL etiketi (29 kapı) **bu sentezde atandı** — modül .md'lerinde explicit "CRITICAL" işareti yoktu; güvenlik/izolasyon/regresyon sezgisiyle seçildi | Yanlış-CRITICAL → gereksiz katılık; eksik-CRITICAL → gizli risk | Emre CRITICAL listesini gözden geçirsin; sınır vakalar (ör. DOC-P5 config) tartışmaya açık |
| O8-K4 | Risk | `pwa.test.ts`/`sqlite-vec`/`rag.ts` gibi **"YOK sanılan ama VAR olan"** parçalar başka modüllerde de olabilir — vizyon belgesi bazı VAR'ları kaçırmış | Fazla-inşa (zaten var olanı yeniden yazma) | Her modül Faz-0'ında ilk iş: ilgili `grep`/`ls` ile "gerçekten yok mu" re-verify (KN-C2/KN-C3 emsali) |
| O8-K5 | Varsayım | Convergence "tek `vitest run` yeşil" varsayımı **düzeltildi** (KN-C5 CLOSED): `vitest.config.ts` `projects` + `RUN_E2E` opt-in zaten var; live-gated (`*.e2e`, `*-live`) ağ-ister. Kalan risk: yeni modül testleri yanlış projeye düşerse (ör. `tests/ui/**` yerine `tests/**`) izolasyon bozulur | Gate G3 kararsız (flaky RED) | Yeni modül testleri **doğru `projects` include glob'una** yaz (`unit`=`server/**`+`tests/**` non-ui; `ui`=`tests/ui/**`); live-gated'ı `RUN_E2E`/env-guard'la ayır; convergence deterministik `unit`+`ui`'ye bağlanır |
| O8-K6 | Bilinmeyen | Bu O8 `08-*.md` yerine `09-*.md` olarak yazıldı; ara sıra numaraları (`02,04,05-root,06,08`) atlanmış — O-serisi numaralandırma **seyrek** | Belge-navigasyon karışıklığı | Bir `docs/odyssey/00-index.md` ile O-serisi haritası (hangi numara hangi konu) çıkar |

---

## 11. Sonraki Belge / Aksiyon

1. **KN-C1 kapat:** `05-features/{research,notes-tasks,cookbook}.md` yaz (documents/email emsali) → §4.8 kesinleştir → §5 payda dondur (KN-C4).
2. **KN-C6 kapat:** `npx vitest run` (`unit`+`ui` projeleri) + `RUN_E2E=1 playwright test` baseline koş, yeşil-taban kaydet (bu oturum kod-Read yaptı, run yapmadı).
3. **KN-1 kapat:** odysseus repo fetch → parity kriterlerini davranışa kalibre (tüm modülleri etkiler; bu oturum harness'te WebFetch deferred, koşulmadı).
4. **Emre-kararları (T0):** §9 checklist'teki 9 Emre-maddesi (KN-5, EM-D*, MCP-K1/K3, SEC-VAR*/BIL1/GAP3) tek oturumda onaya sun.
5. Bu belge **canlı convergence dashboard**'un kaynağı: her modül GREEN oldukça §5 skor + §7 ledger durumu güncellenir.

**Bu revizyonda (2026-07-10) kod-ile-kapatılanlar:** KN-C2 (PWA VAR → CLOSED), KN-C3 (`server.ts`=3191 satır → CLOSED), KN-C5 (vitest `projects` bölünmüş, app-suite≈221 → CLOSED). Kalan AÇIK: KN-C1/C4/C6/C7 (feature .md + baseline-run + odysseus-fetch — hepsi harness/run gerektirir).

---

*Üretici: ODYSSEY planlama üreteci (O8: Testing & Convergence). Kaynak .md'ler okundu:*
*`00-MASTER.md`, `01-vision-premise.md`, `03-claude-design-ui.md`, `07-security.md`,*
*`05-features/{documents,email-mcp,calendar-caldav,mcp-extensions}.md`. Kod doğrulaması (Read/Grep/wc):*
*`package.json` (scripts/deps — documents/email/calendar/security deps MISSING; sqlite-vec/vitest/*
*playwright/jose/zod/sdk VAR), `server.ts` (**3191 satır**, `wc -l`), `server/module-registry.ts` **YOK**,*
*`vitest.config.ts` (**`projects` bölünmüş**: unit/ui/scripts/orchestra), app-suite ≈ **221** test dosyası*
*(`tests/` 182 + `tests/ui/` 36 + `server/` 3; tüm-repo ~435), `vite.config.ts` + `index.html` +*
*`public/pwa-icon.svg` + `tests/ui/pwa.test.ts` (**PWA VAR**). Rev-2 kapatılan: KN-C2/C3/C5. Tarih: 2026-07-10.*
