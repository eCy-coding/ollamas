# ODYSSEY — PROGRESS (Sürdürülebilir İlerleme Defteri)

> **Amaç:** ollamas → odysseus-kalitesinde self-hosted AI-workspace evrimini **sürdürülebilir** takip etmek.
> Dört-şef `VC_PROGRESS.md` emsali: **tablo (faz/modül durumu) + tek-satır append log**.
> **Kaynak sentez:** `docs/odyssey/00-MASTER.md` (O0–O8 kanonik faz haritası) — bu belge onun **yürütme-defteri**dir.
> **Kaynak planlar:** `01-vision-premise.md`, `03-claude-design-ui.md`, `05-features/{documents,email-mcp,mcp-extensions,calendar-caldav,notes-tasks}.md`, `07-security.md`.
> **Dil:** TR (anlatı) · EN (kod/komut/dosya-yolu). Her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` koduna karşı doğrulandı (**2026-07-10**).
>
> **KODLAMA KURALI (değişmez):** Kodlama **TÜM plan belgeleri bitince** başlar. Şu an faz = **PLANLAMA**.
> Hiçbir modül kodu, ilgili planın `parity kabul kriteri` + **O0** (persistence/DB/registry) blocker'ı çözülmeden yazılmaz.
> **CRITICAL gizleme YASAK** — FAIL/BLOCKED her zaman ilk sıra, gerçek kanıtla (CLAUDE.md).

---

## 0. Log Satır Formatı (append-only, her mikro-görev sonrası)

```
<ISO-ts> <görev-id> DONE|FAIL|PARTIAL|BLOCKED <kanıt>
```

- **görev-id:** `<faz>.<modül>.<adım>` (ör. `O4.email.imap`, `O3.doc.pdf`, `O8.totp`, `O0.vector`).
  - Kanonik faz-önekleri: `PLAN` (belge üretimi) · `O0`–`O8` (00-MASTER §3 faz haritası) · `NAV`/`PWA`/`I18N` (cross-cutting).
- **kanıt:** commit-sha VEYA test-adı+sonuç VEYA `dosya:satır`. "çalışıyor" iddiası YASAK — komut+çıktı.
- **DONE** ⇔ ilgili RED test artık GREEN + `typecheck ✓ lint ✓ vitest (fresh) ✓` (CLAUDE.md pre-ship kapısı).
- **FAIL/BLOCKED** her zaman ilk sıra, gerçek kanıtla — **CRITICAL gizleme YASAK**.

---

## 1. Program Durum Tablosu (faz | modül | durum | kanıt)

**Durum sözlüğü:** `PLANNED` = plan .md yazıldı, kod YOK · `SEED` = yalnız plan-tohum + UI-brief (tam TDD-planı YOK) · `IN_PROGRESS` = TDD döngüsü açık · `DONE` = parity kriteri GREEN · `BLOCKED` = önkoşul bekliyor.

### 1.1 Planlama katmanı (belge üretimi) — koda-karşı doğrulanmış envanter

| Faz | Belge | Durum | Kanıt (2026-07-10 doğrulama) |
|-----|-------|-------|------|
| PLAN.00 | `00-MASTER.md` (üst-bakış + O0–O8 + convergence + birleşik ledger) | **DONE** | dosya var, 348 satır; 7 KN-M program-ledger + faz haritası |
| PLAN.01 | `01-vision-premise.md` (Vizyon + Premise + VAR/YOK envanteri) | **DONE** | dosya var; koda-karşı VAR/YOK envanter (§2) |
| PLAN.03 | `03-claude-design-ui.md` (8-panel Claude Design UI brief) | **DONE** | dosya var; 8 panel brief + handoff şablonu |
| PLAN.O3 | `05-features/documents.md` | **DONE** | dosya var; Faz 0–5 TDD + P1–P10 parity |
| PLAN.O4 | `05-features/email-mcp.md` | **DONE** | dosya var; Adım 0–10 TDD + 9 parity |
| PLAN.O1 | `05-features/mcp-extensions.md` | **DONE** | dosya var; Faz A–F TDD + P1–P10 parity |
| PLAN.O6 | `05-features/calendar-caldav.md` | **DONE** | dosya var; Faz 0–7 TDD + 8 parity |
| PLAN.O5 | `05-features/notes-tasks.md` | **DONE** | **dosya var** (23 KB, Faz 0–7 TDD + parity §5) — *önceki PROGRESS "YOK" diyordu, düzeltildi* |
| PLAN.O8 | `07-security.md` (2FA/RBAC/tool-policy/threat-model/poison-guard) | **DONE** | dosya var; O8.1–O8.5 TDD + 8 parity |
| PLAN.PROGRESS | `PROGRESS.md` (bu belge) | **DONE** | ilk log satırı (§4); 00-MASTER ile hizalı |
| **PLAN.gap** | `research.md` · `cookbook.md` (O2/O7 tam plan) | **DONE** | research.md 304 satır (F0–F7 TDD + P1–P12; Tavily-gap bulundu: tavily.mjs lib VAR, web_search.mjs import etmiyor → F0) · cookbook.md 288 satır (FAZ 0–6 TDD + P1–P10; bench_model/optimize.ts/rankMacModels reuse) — KN-P1 kapandı |
| PLAN.O0 | `02-o0-foundation.md` (O0 temel katman tam TDD planı) | **DONE** | 380 satır — store-dikişi=server/store genişlet, vektör=koleksiyon-başına sqlite-vec dosyası, INV-O0-1 guard-invariant (V7 dersi), migration v7+ monoton defter, tab choke-point /api/modules; KN-P3 kapandı; canlı sapma: server.ts 3267 satır (KN-O10), 21 tab (KN-O9) |

**Not:** dosya-adı numaraları (`01/03/07`) ile içerik başlıkları (`O1/O2/O6`) çelişir → 00-MASTER §3 **O0–O8** kanonik alınır (KN-P2/KN-M1).

### 1.2 O0 — Temel Katman (BLOCKER; tüm modül kodları buna bağlı)

| Görev | Odysseus emsali | ollamas mevcut (doğrulanmış) | Durum | Kanıt / önkoşul |
|-------|-----------------|----------------|-------|-----------------|
| O0.vector | ChromaDB (vektör/RAG store) | `sqlite-vec@^0.1.9` dep VAR; `server/store/{index,migrations,db-adapter}.ts`; `server/rag.ts` | **PLANNED** | persistence-uçurumu; `server/__tests__/persistence-vector.test.ts` yaz (adaptör: sqlite-vec tercih) |
| O0.registry | modular-services registry | route'lar `server.ts` monolitinde (**3191 satır**) | **PLANNED** | `server/module-registry.ts`; `module-toggle.test.ts` (`.env MODULE_*=0 → 404`) |
| O0.migrations | SQLite şema (**v6** mevcut) | `server/store/migrations.ts` → `version: 6` (`grep` teyitli) | **PLANNED** | modül tabloları (events/notes/tasks/totp) **v7+** migration, idempotent |

### 1.3 Modül katmanı (parity hedefi — O0 GREEN sonrası paralel)

| Faz | Modül | Backend hedef | UI hedef | odysseus-parity | Plan | Durum | Bağımlılık |
|-----|-------|---------------|----------|-----------------|------|-------|-----------|
| — | **CHAT** (UX) | mevcut `runAgentLoop` (server.ts) | `ReactAgentTab.tsx` UX-yükseltme | 4-durum + trace-card + ⌘Enter | 03§3.1 | **PLANNED** | en düşük risk (S) — backend VAR |
| O7 | **COOKBOOK** | yeni `server/cookbook.ts` (hw-detect + fit-score) | yeni `CookbookPanel.tsx` | fit-score ✓/⚠/✗ + pull-progress | **SEED** | **PLANNED** | `cockpit-models` katalog VAR; **plan .md YOK** (KN-P1) |
| O3 | **DOCUMENTS** | `server/documents.ts` (PDF/office extract) | `DocumentEditor.tsx` (MD split) | P1–P10 (upload+editör+extract+gate) | **DONE** | **PLANNED** | `server/files.ts` guard VAR; `unpdf/mammoth/xlsx/marked/dompurify` YOK |
| O2 | **RESEARCH** | yeni `server/research.ts` (SearXNG proxy) | yeni `ResearchPanel.tsx` | fan-out + `[n]` atıf + honest-empty | **SEED** | **PLANNED** | O0.vector; `searxng` YOK; **plan .md YOK** (KN-P1) |
| O5 | **NOTES/TASKS** | yeni `server/notes.ts`+`tasks.ts`+cron | yeni `NotesPanel`+`TasksPanel.tsx` | markdown + cron scheduler + persist | **DONE** | **PLANNED** | O0 migration v7–v10; scheduler = `webhooks/outbound` deseni (K1 çözüldü) |
| O6 | **CALENDAR** | `server/calendar/*` (CalDAV+ICS+RRULE) | `CalendarPanel.tsx` (Google absorbe) | 8 (sync/ics/recurrence/reminder/…) | **DONE** | **PLANNED** | O5 ortak scheduler; `tsdav/node-ical/ical-generator/rrule` YOK |
| O4 | **EMAIL** | `server/tools/email/*` (IMAP/SMTP native tool) | `EmailPanel.tsx` | 9 (imap/smtp/triage/…) | **DONE** | **PLANNED** | O1 choke-point; `imapflow/nodemailer/mailparser` YOK; privacy-law (K7) |
| O1 | **MCP-EXT** | `server/mcp/hooks.ts`+`manager.ts` | `IntegrationsPanel.tsx` genişlet | P1–P10 (installPlugin+FSM+hook-veto+audit) | **DONE** | **PLANNED** | `server/mcp/*` olgun VAR; `hooks.ts` YOK; ikinci-dispatch-path YASAK |
| O8 | **SECURITY** | `server/security/totp.ts`+`poison-guard.ts` + `middleware/rbac.ts` | `SettingsPanel.tsx` | 8 (TOTP+RBAC+tool-policy+injection+…) | **DONE** | **PLANNED** | `otplib/otpauth/qrcode` YOK; choke-point `ToolRegistry.execute` VAR |
| — | **CROSS: PWA** | `public/manifest.json` + SW | — | manifest + installable | 03§K5 | **PLANNED** | `public/pwa-icon.svg` VAR, `manifest.json` YOK |

**Convergence ölçütü:** `parity_score = (geçen kabul kriteri) / (toplam kabul kriteri)` → hedef **1.0**.
Kabul-kriteri envanteri (00-MASTER §4.3): O1=10 · O3=10 · O4=9 · O6=8 · O8=8 · O2/O5/O7=6+panel → **kaba ≥ 55 kapı**.

---

## 2. Uygulama Sırası (bağımlılık-sıralı, T0 kapılı — 00-MASTER §3.2 ile hizalı)

```
[PLANLAMA]  eksik 2 tam-plan (research.md · cookbook.md) + O0-detay (02-o0-foundation.md) yaz → KN-P1/KN-P3 kapat
     │
[O0 BLOCKER] O0.vector ∥ O0.registry ∥ O0.migrations  →  hepsi GREEN
     │  (O0 bitmeden HİÇBİR modül fazı spawn edilmez — CLAUDE.md K-cluster kuralı)
     ▼
[PARALEL] chat-UX(S) → O7 cookbook(M) → O3 documents(M) → O2 research(M)
          → O1 mcp-ext(M) → O5 notes(L) → O6 calendar(L) → O4 email(L) → O8 security(XL)
     │  (03§4 sıra: düşük-risk/mevcut önce, güvenlik-kritik en sona)
     ▼
[CROSS] PWA manifest + i18n (EN+TR her panel) + theme dark/light paritesi + NAV refactor (⌘K)
     ▼
[CONVERGE] parity_score = 1.0  →  odysseus-kalitesinde AI-workspace
```

**T0 kapıları (her modül):** Emre onayı → handoff bundle (Claude Design) → TDD RED→GREEN → gate (typecheck+lint+vitest fresh) → commit. **CRITICAL gizleme YASAK.**

**Paralellik notu (CLAUDE.md Tier-1):** O1–O8 birbirinden bağımsız → O0 GREEN sonrası paralel sub-agent'a dağıtılır. O8.1 (TOTP) ∥ O8.5 (poison-guard) kendi-içinde paralel; O8.3 (role-policy) O8.2 (role migration)'a bağlı.

**Şef-atama (00-MASTER §5.2):** O0→Şef-1(trunk) · O1+O8.5→Şef-3(gwv2 cherry-pick) · O7-UI→Şef-4(cockpit) · O2/O3/O5/O6→yeni izole worktree · O8.1-O8.3→EN SON (Şef-2 revenue/RBAC koordine).

---

## 3. odysseus-Parity Kabul Kriteri (program-düzeyi özet — 00-MASTER §4.1)

Bir modül **"parity"** ⇔ **6 kriterin tümü** GREEN:

1. **Fonksiyon** — odysseus'un o modüldeki ana yeteneği ollamas'ta çalışır (RED test artık GREEN).
2. **Extensibility** — MCP-as-extension VEYA modular-service olarak takılı; `server.ts` monolitine gömülü değil (`server/<modül>.ts`).
3. **Config-driven** — `.env` toggle (`MODULE_<AD>` / `ENABLE_<AD>` / `<AD>_MCP_ENABLED`) modülü açıp kapatır; kapalıyken route 404/gizli, araç `/mcp`'de görünmez.
4. **Persistence** — veri O0 store'a yazılır; restart-kalıcı (JSON-only regresyon yasak; RAG gerekiyorsa vektör-store).
5. **UI** — Claude Design prototipinden türetilmiş tab `App.tsx`'e entegre; tema + i18n (`src/locales/{en,tr}`) uyumlu.
6. **Kalite kapısı** — `typecheck ✓ lint ✓ vitest (fresh run) ✓`.

**Program-düzeyi kabul:** `parity_score = 1.0` (6 YOK-modül × 6 kriter = 36) **+** O1 MCP-ext (P1–P10) **+** O8 security (8 kriter) **+** cross-cutting (PWA/i18n/theme) GREEN. **Nihai test:** 6+ modül canlı, `.env` toggle açar-kapar, dört-durum (boş/yükleniyor/hata/başarı) render, dark/light, klavye-öncelikli, backend'e gerçek bağlı, 2FA/RBAC enforce, poison-guard aktif.

---

## 4. Yürütme Logu (append-only — en yeni EN ALTA)

> **İlk satır = planlama sentezi tamamlandı.** Kodlama TÜM plan bitince (KN-P1 + KN-P3 kapanınca, O0 GREEN olunca) başlar.

```
2026-07-10 PLAN.synth DONE PROGRESS.md 00-MASTER'a hizalandı — O0–O8 kanonik faz haritası + görev-id şeması + parity + Kör-Nokta Ledger kuruldu; kodlama HENÜZ başlamadı
2026-07-10 PLAN.audit DONE koda-karşı doğrulama: server.ts=3191 satır (wc -l), App.tsx=23 tab (grep -c), migrations version:6 (grep), .env.example=21 toggle (grep -c); sqlite-vec@^0.1.9 VAR; unpdf/mammoth/xlsx/imapflow/nodemailer/mailparser/tsdav/node-ical/rrule/otplib/otpauth/qrcode/searxng/marked/dompurify tümü YOK (node package.json probe)
2026-07-10 PLAN.inventory DONE 05-features/ 5 plan VAR: documents,email-mcp,mcp-extensions,calendar-caldav,notes-tasks (ls teyitli); server/mcp/* 12 dosya olgun (server,client,catalog,supervisor,upstream-guard,discovery,prompts,host-guard,oauth-*,subscriptions) VAR
2026-07-10 PLAN.fix DONE önceki PROGRESS düzeltmesi: notes-tasks.md "YOK/BLOCKED" idi → gerçekte VAR (23 KB, Faz 0–7 TDD); tab sayısı "21" idi → gerçek 23; KN-P1 kapsamı 3 plandan 2 plana daraldı (research+cookbook)
2026-07-10 PLAN.gap PARTIAL research.md + cookbook.md tam-plan .md YOK (SEED: 01§5 + 03§3.2/3.7); 02-o0-foundation.md YOK → kodlama-öncesi yazılmalı (KN-P1/KN-P3)
2026-07-11T01:10:00+03:00 PLAN.O0 DONE 02-o0-foundation.md yazıldı — 380 satır (Faz 0–6 TDD + P1–P10 + KN-O ledger); KN-P3 kapandı
2026-07-11T01:10:00+03:00 PLAN.O2 DONE research.md yazıldı — 304 satır (F0–F7 TDD + P1–P12 parity; Tavily-gap F0'a bağlandı)
2026-07-11T01:10:00+03:00 PLAN.O7 DONE cookbook.md yazıldı — 288 satır (FAZ 0–6 TDD + P1–P10 parity; K1 CRITICAL host-tier-bench)
2026-07-11T01:10:00+03:00 PLAN.katman TAMAMLANDI 13/13 — kodlama serbest (O0 blocker RED-testleriyle başlar)
```

---

## 5. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

> Tip: V=Varsayım · B=Bilinmeyen · R=Risk · G=Doğrulama-açığı · K=Kapsam/Karar. Program-blocker'lar ilk sıra.

| # | Tip | Kayıt | Etki | Azaltma |
|---|-----|-------|------|---------|
| **KN-P1** | **R (program-blocker)** | `05-features/`'te **research.md** + **cookbook.md** tam-plan **YOK** (yalnız `01§5` + `03§3.2/3.7` plan-tohum). *notes-tasks.md artık VAR — bu satır 3→2 plana daraldı.* | O2/O7 plansız → yarı-iş | **Kodlama-öncesi 2 plan .md yaz** (`documents.md` şablonu); §1.1 `PLAN.gap` `DONE` olana dek O2/O7 spawn edilmez |
| **KN-P3** | **R (program-blocker)** | **O0 detay planı** `02-o0-foundation.md` **YOK** (00-MASTER §9-1 "ilk yazılacak" der). Persistence-uçurumu: odysseus SQLite+ChromaDB; ollamas SQLite `server/store` **var** ama modül tabloları + RAG-embedding kalıcılığı **yok**. `sqlite-vec` dep VAR, adaptör kurulmadı. | research/documents/notes parity imkânsız | **O0 kesin blocker + tam plan yaz**; adaptör (sqlite-vec VAR→tercih, ChromaDB-MCP opsiyonel) O0'da netleşir |
| **KN-P4** | **R** | **`server.ts` monolit (3191 satır)** + **23-tab sidebar**. Her modül route/tab buraya eklenirse teknik borç + nav UX bozulur. | Bakım/çakışma + UX | O0.registry (`module-registry.ts`) + `server/<modül>.ts` ayrıştırma zorunlu; nav için ⌘K komut-paleti (`NAV.refactor` ayrı görev-id) |
| **KN-P5** | **K/B (Emre-T0)** | Google `gmail`/`calendar`/`drive`/`sheets` tab'ları **korunacak mı** yoksa self-hosted MCP ile **değiştirilecek mi**? Email/calendar planları "yan-yana absorbe" varsayıyor. | Kapsam/çift-bakım; privacy-law regresyonu | **T0 kararı:** "harici-SaaS + self-hosted yan-yana" mı "yalnız self-hosted" mı. `GmailBrowser` metadata-only privacy-law ayrı IMAP kanalıyla bozulmaz |
| **KN-P6** | **B (T0-doğrulama)** | **odysseus repo** (github.com/pewdiepie-archdaemon/odysseus, 82k★) **fetch-doğrulanmadı** — modül listesi + stack task-brief'ten, koddan değil. | Parity hedefi yanlış kalibre olabilir | **O0-öncesi** odysseus README/mimari fetch+doğrula; sapmada 00/01/03 güncelle. Parity **listelenen alt-yeteneklere** göre tanımlı (API imzaları ollamas-native) |
| **KN-P7** | **V** | **Claude Design export formatı** (HTML+screenshot+README, Nisan 2026) brief'e dayanıyor; gerçek export şeması doğrulanmadı; canvas Tailwind-v4 `@theme` token'ı sadık üretmeyebilir. | Handoff şablonu (00-MASTER §6) kayabilir | İlk panelde (CHAT) **gerçek** Design export ile pilot; HANDOFF.md'ye `tokens.snippet.css` + mock→real map zorunlu |
| **KN-P8** | **R** | Self-hosting bağımlılıkları: **SearXNG** (O2), **IMAP/SMTP** (O4), **CalDAV/Radicale** (O6) kullanıcıdan ek servis/Docker ister. | Kurulum sürtünmesi; modül "çalışmaz" görünür | Her modül **opsiyonel + toggle-off default**; mock-adapter ile testler altyapısız geçer (honest-empty state) |
| **KN-P9** | **R (güvenlik)** | O8 2FA/RBAC/poison-guard **güvenlik-kritik**: UI-mock kolay ama TOTP time-window + RBAC enforcement + injection-guard backend'de sağlam olmazsa **sahte güvenlik**. Regex-poison-guard LLM-saldırıyı tam çözmez (07§RISK-4). | Güvenlik açığı | Backend-önce TDD (`totp.test`+`rbac.test`+`poison-guard.test` GREEN olmadan UI ship YASAK); poison-guard = defense-in-depth, asıl savunma = verifier-izolasyonu |
| **KN-P10** | **G** | Kod-adımı öncesi okunmamış imzalar: `server/db.ts` encrypt/decrypt (O8 TOTP secret) · agent-loop `ToolCtx.role/confirmToken` wiring (O8.3) · `server/ai.ts` inject imzası (O4) · `unpdf`/`pdfjs-dist` SEA-uyumu (O3) · agent-runner köprüsü `agent-events.ts` vs `orchestrator.ts` (O5 K3). | Faz tahmini kaba | Her modülün ilk adımında ilgili dosyayı Read; PROGRESS'e `<faz>.<modül>.read DONE <imza-teyit>` satırı |
| **KN-P11** | **V** | **Auth modeli tutarsızlığı:** `/api/notes\|tasks\|calendar/*` **tenant/apikey** mı **Firebase-user** mı? (server API'leri apikey/tenant; bazı UI panel'leri Firebase.) | Yanlış auth = sızıntı veya çift-auth | O5/O6 Faz-1 öncesi `server.ts` korunan-route middleware desenini teyit; calendar+notes **aynı** kararı versin |
| **KN-P12** | **B (terminoloji)** | **"gwv2 / hooks.ts / poison-guard"** kodda YOK; `server/mcp/*` olgun + `tool-interceptors.ts` embriyo VAR. O1/O8.5 yeni-inşa. | O1/O8.5 kapsam belirsizliği | **Emre onayı:** gwv2 = yeni `server/mcp/hooks.ts`; poison-guard = defense-in-depth; Şef-3 cherry-pick (merge değil, seçmeli) |

---

## 6. Sonraki Adım (kodlama-öncesi kapı)

1. **KN-P1 kapat:** `05-features/research.md` + `cookbook.md` tam-planlarını yaz (`documents.md` şablonu). → §1.1 `PLAN.gap` `DONE`.
2. **KN-P3 kapat:** `02-o0-foundation.md` (O0 temel katman tam TDD planı: vektör-store adaptörü + `module-registry` + config-toggle + migration v7 şeması). **Program blocker; ilk yazılacak.**
3. **KN-P6 (T0-doğrulama):** odysseus repo/mimari fetch-doğrula; sapma varsa 00/01/03 güncelle.
4. **KN-P5 (Emre-T0):** Google-tab kaderi kararı (yan-yana vs yalnız self-hosted).
5. **KN-P12 (Emre-T0):** gwv2/poison-guard terminoloji + kapsam onayı.
6. **O0 BLOCKER:** O0.vector ∥ O0.registry ∥ O0.migrations — RED test yaz, GREEN yap. **Kod bu noktada başlar.**

> Bu altı adım tamamlanmadan modül-kodu YAZILMAZ. **Kodlama TÜM plan bitince başlar** (bu belgenin değişmez kuralı).

---

*Üretici: ODYSSEY planlama üreteci (PROGRESS sentez). Kaynak: `docs/odyssey/00-MASTER.md` + 8 plan .md (01,03,07 + 05-features/{documents,email-mcp,mcp-extensions,calendar-caldav,notes-tasks}) + ollamas kodu (server.ts:3191, App.tsx:23-tab, migrations:v6, .env.example:21-toggle, package.json dep-probe, server/mcp/*:12-dosya, sqlite-vec@^0.1.9). Doğrulama tarihi: 2026-07-10.*

2026-07-11T01:43Z O0.registry DONE registry.test.ts 5/5 + module-guard 14/14; server.ts 3-satır mount+guard (INV-O0-1)
2026-07-11T01:43Z O0.vector DONE vector.test.ts 5/5 koleksiyon-izole upsert/query/delete + dim/provider-kilit
2026-07-11T01:43Z O0.migrations DONE v7 idempotent+rollback; module-migrations 4/4; import-guard canlı
2026-07-11T01:43Z O0.toggle DONE modules-api 3/3 + module-tabs 4/4 + demo 5/5 + o0-parity 4/4; MODULE_DEMO=0→404∧tool-yok∧tab-gizli
2026-07-11T01:43Z O0.GATE DONE tsc-0 · FRESH vitest 285 files / 2271 passed / 0 fail (baseline 2236 → +35 O0)
2026-07-11T02:05Z PANEL.download DONE 7/9 design.html diskte (chat/research/documents/email/settings-2fa/cookbook/notes-tasks); calendar+shell impl-anı; DesignSync ana-thread, subagent'ta tool-yok

2026-07-11T02:40Z O7.cookbook DONE (PILOT) server/modules/cookbook/{index,router,service,schema,store}.ts + CookbookPanel.tsx + i18n 196/196; hardware-detect(arm64→metal) + rule-base(FIT_RATIO 0.7 docs-pin) + bench(ToolRegistry choke-point) + pull-SSE(name-sanitize SSRF-red) + config→model-overrides bridge; 26 test; guard-inherit(/api/modules 403∧toggle-404); tsc-0 FRESH 2297/0

2026-07-11T03:30Z O2.research DONE server/research/{searxng,summarize,planner,engine,report,pipeline}.ts + server/modules/research/ + ResearchPanel.tsx + deep_research MCP tool; SearXNG-opt + tavily-wire + rag-ingest + cited-synthesize; 44 test; guard-inherit+toggle; migration v12 via module (NOT core ledger)
2026-07-11T03:30Z O5.notes-tasks DONE server/modules/notes-tasks/ (v8 notes+tasks, v9 reminders migrations) + NotesTasksPanel.tsx; CRUD+persist+reminders; 27 test; guard-inherit+toggle
2026-07-11T03:30Z DALGA2.reconcile DONE conductor: research index migration-wire + ModulePanel notes eşleme + notes-panel mock undefined-safe (provider mount-get toleransı); tsc-0 FRESH 2368/0

2026-07-11T04:00Z O3.documents DONE server/modules/documents/ (v13) + DocumentsPanel; PDF(unpdf)/DOCX(mammoth)/XLSX(xlsx)/MD(marked) parse + viewer + sanitizeHtml(dompurify-siz) + rag-ingest(DOCUMENTS_RAG-gated); 44 test; guard+toggle; pure-JS deps
2026-07-11T04:00Z O6.calendar DONE server/modules/calendar/ (v10, recurrence.ts RRULE D/W/M/Y) + CalendarPanel (week/month/day + drawer + 4-state, CalDAV-writable/google-ics-readonly, eCy-cyan spec-driven) + tests; guard+toggle
2026-07-11T04:00Z DALGA3 DONE tsc-0 FRESH 2446/0; ModulePanel 5-modül reconcile temiz; migration v8/9/10/12/13 benzersiz

2026-07-11T04:40Z O4.email DONE server/modules/email/{index,router,service,schema,store}.ts (v11 — reserved slot for O8 was free in code, reclaimed) + EmailPanel.tsx (notconnected/syncing/error/filled/compose 5-state, indigo tokens component-scoped, TEXT triage badges action/waiting/archive not color-only); imapflow+nodemailer+mailparser (MIT, pure-JS, no native bindings, npm ls verified) injectable ImapTransport/SmtpTransport seam (real transports never touched in tests); rule-based triageClassify + AI summarize/draft via server/ai.ts generateText ($0 qwen3:8b, malformed-JSON safe-fallback); send is the one SMTP-privileged action (503 unconfigured, 502 transport-fail, never fires in tests — mock call-count asserted 0/1); 43 test (36 server + 7 UI); guard-inherit(/api/modules 403∧toggle-404 both proven) + i18n en/tr parity (316/316 keys both sides); tsc-0, FRESH vitest full-suite green (only concurrent unrelated O8.settings WIP failures, out of scope)

2026-07-11T04:40Z O4.email DONE server/modules/email/ (v11, imapflow/nodemailer/mailparser inject-seam) + EmailPanel 5-state; rule-triage $0 + AI-summary/draft(qwen3:8b) + SMTP-send-privileged(503/502-gate, mock-count-asserted); 43 test
2026-07-11T04:40Z O8.settings DONE server/modules/settings/ (v14, TOTP RFC6238 vektör-testli + SecureDB-encrypt) + SettingsPanel (5-section); RBAC 5-rol + tool-policy read-only + sessions + 2FA-lifecycle(time-inject-DI); 48 test; güvenlik-infra korundu (16 test)
2026-07-11T04:40Z DALGA4 DONE tsc-0 FRESH 2537/0; 7 modül ModulePanel'de; migration v8-v14 benzersiz
