# ODYSSEY 10 — Roadmap: Fazlı Yürütme Sırası + Bağımlılık Grafiği + Tahmin

> **Belge:** `docs/odyssey/10-roadmap.md`
> **Rol:** Odyssey programının **sentez/orkestrasyon** belgesi. Modül planlarını (vision, claude-design-ui,
> security, features/{documents,email-mcp,calendar-caldav,mcp-extensions,notes-tasks}, extensibility,
> testing-convergence) **tek bir yürütme sırasına + bağımlılık grafiğine + efor tahminine** bağlar.
> Bu belge yeni plan **üretmez**; mevcut planları **sıralar, zamanlar ve her faza ön-koşul + efor(S/M/L) atar**.
> **Kaynak-of-truth:** `docs/odyssey/*` modül .md'leri + `/Users/emrecnyngmail.com/Desktop/ollamas`
> gerçek kodu. Her iddia Read/Grep/wc ile doğrulandı (tarih 2026-07-10; §9 doğrulama günlüğü).
> **Dil:** TR (anlatı) · EN (kod/komut/dosya-yolu). **Yöntem:** her faz TDD (test-önce, RED→GREEN→REFACTOR).

---

## 0. TL;DR — Tek Nefes

Odyssey = ollamas'ı (Vite+React frontend, Node `server.ts`, MCP host, orchestra fleet, $0-local
qwen3:8b + cloud katalog) **odysseus-kalitesinde self-hosted AI-workspace**'e evrimleştirmek. Görev-brief'in
istediği **kanonik faz sırası** (dört-şef convergence → mimari → design → handoff → feature → extensibility
→ security → deploy → test) aşağıda **8 O-faza + 8 yürütme dalgasına (W0–W7)** oturtuldu:

```
O0  dört-şef convergence (altyapı)  ── BLOCKER; rag-service + module-registry + scheduler + migration-v7
O1  mimari (registry-mount + role)  ── O0'a bağlı; server.ts monolit refactor + role kolonu (O6 ön-koşulu)
O2  design-ui (Claude Design brief) ── O1 token-katmanına bağlı; backend-BAĞIMSIZ → O1 ile paralel
O3  handoff (bundle→Claude Code)     ── O2'ye bağlı, panel-başına; backend-bağlı paneller O4'ü bekler
O4  feature-moduller (7 modül)       ── O1+O3'e bağlı; iç bağımlılık: rag←documents/research/notes,
                                        scheduler←notes/calendar/email, MCP-ext←email/calendar (yumuşak)
O5  extensibility (MCP-as-extension) ── O1'e bağlı; O4 email/calendar'ı ZENGİNLEŞTİRİR (bloklamaz)
O6  security (2FA/RBAC/poison-guard) ── O1 role kolonuna bağlı; O4 tool'larını gate'ler
O7  deploy (boot/Docker/PWA)         ── O4+O6 GREEN sonrası
O8  test (parity-gate, e2e)          ── her fazın kapısı + program-sonu tam-parity
```

**Kritik gerçek (koda karşı doğrulandı):** ollamas altyapısı **beklenenden olgun**. `server/rag.ts`
(sqlite-vec, `rag_index`/`rag_search`) **VAR**, MCP choke-point (`tool-registry.ts` 971 satır) **VAR**,
`vite-plugin-pwa` **VAR**, `server/tools/` dizini **VAR**, 425 test dosyası + vitest+playwright+RTL **VAR**.
Dolayısıyla O0 çoğunlukla **yeni-inşa değil entegrasyon+formalizasyon** — bu program eforunu 01-vision'ın
ilk sezgisine göre **aşağı çeker** (§8). Buna karşılık **7 modülün 16 npm-deps'inin hiçbiri yüklü değil**
(§9 tablo) ve `module-registry.ts`/`scheduler.ts`/`hooks.ts`/`manager.ts`/`server/{notes,tasks,calendar}`
**YOK** — yeni-inşa yüzeyi buradadır.

**Program-düzeyi kabul (tek sayı):** `parity_score = geçen_kabul_kriteri / toplam_kabul_kriteri → 1.0`
(O8'de 59+ kapı; 7 modül parity + cross-cutting 2FA/RBAC/PWA + extensibility P1–P10 + security 8 kriter).

---

## 1. Modül .md Envanteri (bu roadmap'in girdileri) — DOĞRULANDI

Bu roadmap aşağıdaki **okunmuş** modül planlarını orkestra eder (`ls docs/odyssey/` ile teyit):

| Belge | Kapsam | Faz eşlemesi | Durum |
|---|---|---|---|
| `00-MASTER.md` | Üst-bakış + O0–O8 kanonik faz haritası + birleşik ledger | tüm | ✅ okundu |
| `01-vision-premise.md` | Vizyon, VAR/YOK envanteri, Faz 0–7 iskeleti, convergence | O0+O1 (temel) | ✅ okundu |
| `03-claude-design-ui.md` | 8 panel Claude Design brief + handoff sözleşmesi + UI-sıra | O2+O3 | ✅ okundu |
| `06-extensibility.md` | config.ts + route-split + extension-manifest + DEVELOPER.md | O5 (sistem-extensibility) | ✅ okundu |
| `07-security.md` | 2FA/TOTP + RBAC + tool-policy + threat-model + poison-guard | O6 (security) | ✅ okundu |
| `09-testing-convergence.md` | parity kabul matrisi + 8 gate + ledger kapanma-kanıtı | O8 (test) | ✅ okundu |
| `05-features/documents.md` | PDF/office/md extract + writing-editör + upload-validate | O4 (documents) | ✅ okundu |
| `05-features/email-mcp.md` | IMAP/SMTP + triage/summary/draft, ToolRegistry-native | O4 (email) + O5 | ✅ okundu |
| `05-features/calendar-caldav.md` | CalDAV sync + ICS + recurrence + reminders | O4 (calendar) + O5 | ✅ okundu |
| `05-features/mcp-extensions.md` | Plugin-manifest + lifecycle FSM + gwv2 hooks + audit | O5 (feature-extensibility) | ✅ okundu |
| `05-features/notes-tasks.md` | notes CRUD + tasks + cron scheduler + agent-assign | O4 (notes) + O5 | ✅ okundu **(YENİ — artık VAR)** |

**⚠️ Backlog güncellemesi (önemli):** 09-testing-convergence ve önceki roadmap `research/notes/cookbook`
üçünü "feature .md YOK" sayıyordu. **`notes-tasks.md` ARTIK YAZILMIŞ** (2026-07-10, 192 satır, Faz 0–7
TDD + 11-madde ledger). Kalan eksik: **`research.md` + `cookbook.md`** (§7 backlog). Yani belge-boşluğu
3'ten 2'ye düştü.

**Henüz yazılmamış (bu roadmap'in işaret ettiği boşluklar):** `02-foundation.md` (O0 detay TDD),
`04-research.md`, `04-cookbook.md`, `08-deploy-pwa.md`. Bunlar §7 backlog'da listelenir. `09-*` (test)
**yazıldı** — 00-MASTER'ın "yazılacak" listesi bu noktada güncel değil.

---

## 2. Faz Tanımları (O0–O8) — her biri: amaç · ön-koşul · efor(S/M/L) · çıkış-kapısı

> **Efor ölçeği:** S = ≤1 ajan-oturumu (dar, tek-dosya) · M = 2–4 oturum (modül) · L = 5–8 oturum
> (sıfırdan modül) · XL = >8 oturum (güvenlik-kritik/çok-dosya). Ölçek **ajan-oturumu**dur, takvim değil
> (sub-agent orkestrasyonu paralelleştirir). Kalibrasyon §8. Her fazın **ön-koşulu** kalın işaretli.

### O0 — Dört-Şef Convergence (Altyapı Temeli) · efor **M** · BLOCKER

**Amaç:** 4 çapraz-kesen altyapı parçasını GREEN yapmak; tüm modül fazları buna dayanır. Bu, CLAUDE.md
komuta zincirindeki **dört-şef modelinin** (00-MASTER §5) somut altyapı yüzeyi — her şef bir alt-parçaya
sahip olabilir ama **O0 GREEN olmadan hiçbir modül dalgası spawn edilmez**.

1. **Vektör-store entegrasyonu (rag-service)** — `server/rag.ts` (VAR) modül-erişilebilir yap:
   research/documents/notes memory `rag_index`/`rag_search` üzerinden yazar. **Yeni-inşa DEĞİL** —
   mevcut RAG'ı servis-katmanına aç. Efor: **S**.
2. **Module-registry + config-toggle** — `server/module-registry.ts` (**YENİ, doğrulandı: YOK**): `.env`
   `MODULE_<AD>=0/1` ile route açıp kapatma. 01-vision Faz 0 GREEN kriteri. Efor: **S–M**.
3. **Scheduler çekirdeği** — ortak tick döngüsü (`server/scheduler.ts`, **YENİ, doğrulandı: YOK**);
   notes-cron + calendar-reminder + email-poll bunu paylaşır. Baz desen: `webhooks/outbound.ts` claim/retry
   + `oauth-gc.ts` start/stop timer (her ikisi doğrulandı). **Genel cron YOK** → sıfırdan ama küçük. Efor: **M**.
4. **Migration hattı v7+** — `server/store/migrations.ts` **v6'da bitiyor (doğrulandı)**; yeni modül tabloları
   v7+ zinciri hazır (duplicate-guard + baseline-DDL çift-yazım sözleşmesi var). Efor: **S**.

**Ön-koşul:** **yok (program başlangıcı).** Yürütme-öncesi T0: KN-R1 (odysseus doğrulama) + KN-R4 (Emre
kapsam kararı) kapanmalı (§10).

**TDD çıkış-kapısı:**
- **RED:** `server/__tests__/module-toggle.test.ts` — `MODULE_RESEARCH=0` iken ilgili route 404.
- **RED:** `server/__tests__/scheduler.test.ts` — kayıtlı job tick'te tetiklenir, idempotent, restart catch-up.
- **RED:** `server/__tests__/rag-service.test.ts` — modül-katmanı embed yaz → benzerlik sorgusu doğru.
- **RED:** `server/store/__tests__/migration-v7.test.ts` — v7 idempotent + v1–v6 zinciri kırılmadı.
- **GREEN + gate:** `npm run lint` (tsc) ✓ · `eslint` ✓ · `npm test` (fresh) ✓.

### O1 — Mimari (Modüler Servis Ayrıştırması + Role Kolonu) · efor **S–M** · **O0'a bağlı**

**Amaç:** `server.ts` (**3191 satır monolit — doğrulandı**) yeni modül route'larını **doğrudan yutmasın**;
`module-registry` üzerinden `server/<modül>.ts` servisleri mount edilsin. RBAC `role` kolonu şeması
(O6 ön-koşulu) burada v7 migration olarak açılır (07-security O6.2). Bu faz 06-extensibility'nin
route-split (O5-Adım 4) işiyle kesişir — **koordine edilmeli** (KN-R12).

**Ön-koşul:** **O0 GREEN.** **TDD:** route-registry `mountRoutes(app, deps)` mount testi + `role`
kolon-migration idempotent + owner→admin backfill testi (07-security RISK-1). **Çıkış-kapısı:** yeni modül
eklerken `server.ts`'e satır eklemeden registry'e kayıt yeter; `role` kolonu `resolveKey`/`mcpCtxFactory`'de
dolar (07-security GAP-2 doğrulandı: `server.ts:2385-2394`).

### O2 — Design-UI (Claude Design Brief'leri) · efor **M** · **O1 ile paralel (backend-bağımsız)**

**Amaç:** 03-claude-design-ui'deki **8 panel brief**inin her biri için gerçek Claude Design prototipi üret →
`docs/odyssey/handoff/<panel>/` bundle (PROMPT.md + design.html + screenshot + HANDOFF.md + tokens.snippet.css).
**Claude Design = UI-tasarım aracı, app-runtime DEĞİL** (mock veri; localhost/MCP'ye bağlanmaz — 01-vision §1,
03-ui §0). Çıktı asla "çalışan modül" sayılmaz.

**Ön-koşul:** **O1 token-katmanı sabit** (mevcut `src/styles/tokens.css` — VAR). Backend'e bağımlı DEĞİL →
**O1 ile paralel başlayabilir** (tasarım kod beklemez). **Çıkış-kapısı:** Emre görsel onay + bundle şablonu
dolu. **KN-R5 (export formatı doğrulama) ilk panelde (chat) kalibre edilir.**

### O3 — Handoff (Bundle → Claude Code Implement) · efor **S/panel** · **O2'ye bağlı**

**Amaç:** her panel bundle'ını mevcut ollamas frontend'e implemente et (`src/components/*.tsx`). Bu faz
**UI-katmanı**dır; backend O4'te. Panel-başına S; 8 panel → toplam M–L.
**Ön-koşul:** ilgili panel **O2 bundle'ı hazır** + (backend-bağlı paneller için) ilgili **O4 route'u GREEN**.
**Kritik ayrım (03-ui K3):** O3 tek başına "çalışan panel" üretmez — backend O4'e bağlı; kombine kapı §4.

### O4 — Feature Modülleri (7 modül) · efor **değişken** · **O1+O3'e bağlı**

**Amaç:** 7 YOK/KISMİ modülü backend+persistence olarak inşa (01-vision §2.2). **İç bağımlılık grafiği §3.**

| Modül | Belge | Efor | İç ön-koşul | Not (kod-doğrulandı) |
|---|---|---|---|---|
| **chat** (UX yükseltme) | 03-ui §3.1 | **S** | — (`ReactAgentTab.tsx` VAR) | En düşük risk, hızlı parity |
| **cookbook** (hw-aware öneri) | 03-ui §3.7 | **M** | `cockpit-models.ts` (VAR) | $0-local kimliğin kalbi; **feature .md YOK** (backlog §7) |
| **documents** (extract+editör) | documents.md | **M** | `server/files.ts` (VAR) + **RAG (O0)** | rag←documents; 5 deps (unpdf/mammoth/xlsx/marked/dompurify) **hepsi YOK** |
| **research** (deep+SearXNG) | 03-ui §3.2 | **M** | **RAG (O0)** + SearXNG (opsiyonel) | **feature .md YOK** (backlog §7); ECySearcher feed kaynak |
| **notes/tasks** (memory+cron) | notes-tasks.md | **L** | **scheduler (O0)** + RAG (O0) | Sıfırdan modül; `croner` (opsiyonel) YOK; agent-assign köprüsü |
| **calendar** (CalDAV/ICS) | calendar-caldav.md | **L** | **scheduler (O0)** + **MCP-ext (O5, yumuşak)** | recurrence/ICS/reminder; 4 deps (tsdav/node-ical/rrule/ical-generator) YOK |
| **email** (IMAP/SMTP+triage) | email-mcp.md | **L** | **MCP-ext (O5, yumuşak)** + vault (VAR) | ToolRegistry-native; 3 deps (imapflow/nodemailer/mailparser) YOK |

**Ön-koşul:** **O1 (registry) + ilgili panel O3 (UI) + iç bağımlılıklar (RAG/scheduler O0'dan).**
**Paralellik:** chat/cookbook/documents/research birbirinden bağımsız → O0 sonrası paralel sub-agent.
calendar/email O5'e **yumuşak** bağlı (aşağıda KN-R8): tool ToolRegistry-native olduğu için O5-core sonrası güvenli.

### O5 — Extensibility (MCP-as-Extension + Sistem-Katmanı) · efor **M–L** · **O1'e bağlı**

**Amaç:** İKİ kaynak birleşir — (a) `05-features/mcp-extensions.md`: plugin-manifest + lifecycle FSM +
gwv2 hooks (`server/mcp/hooks.ts` **YENİ, doğrulandı: YOK**, `tool-interceptors.ts` embriyosu üstüne) +
audit; (b) `06-extensibility.md`: `config.ts` merkezi şema + route-split + `installExtension` birleştirme +
`DEVELOPER.md`. **ollamas MCP katmanı %70 hazır** (doğrulandı) → sıfırdan-plugin-sistemi DEĞİL.
**Kısmen O4 ile paralel:** email/calendar'ın MCP-expose'u O5'in manager/manifest soyutlamasını bekler ama
**tool'un kendisi** ToolRegistry-native olduğu için (email-mcp.md) O5 tamamlanmadan da `/mcp`'de görünür.
→ O5 email/calendar'ı **zenginleştirir, bloklamaz** (KN-R8).

**Ön-koşul:** **O1.** **KN-R12:** 06-extensibility O5.1/O5.2 ile 05-features/mcp-extensions'ın kapsam sınırı
00-MASTER'da netleşmeli (config+route-split = sistem-katmanı; plugin-protokol = feature-katmanı).
**Çıkış-kapısı:** mcp-extensions P1–P10 (Faz A→F) + 06-extensibility 6 kabul kriteri.

### O6 — Security (2FA/RBAC/Tool-Policy/Poison-Guard) · efor **XL** · **O1 role'e bağlı**

**Amaç:** 07-security O6.1–O6.5. **Güvenlik-kritik → backend enforcement zorunlu, UI tek başına yetmez**
(03-ui K6). O4 tool'larını (email_send=privileged, run_command) role-aware gate'ler. GAP-1/GAP-2
**doğrulandı-KAPALI** (07-security §7): `db.encrypt` AES-256-GCM (`db.ts:312`), `role` wiring
(`server.ts:2385`) hazır.

**Ön-koşul:** **O1 `role` kolonu (v7).** **İç sıra (07-security §5):**
```
O6.2 (RBAC role) ─┬→ O6.3 (role-aware tool-policy)
                  └→ O6.1 step-up gate
O6.1 (TOTP core) ── bağımsız başlar (otplib+qrcode — YOK, eklenecek)
O6.5 (poison-guard) ── tamamen bağımsız (paralel, interceptor)
O6.4 (threat-model.md) ── EN SON (diğerlerini referanslar)
```
**Çıkış-kapısı:** 07-security §6 parity tablosu (8 kriter GREEN).

### O7 — Deploy (Boot / Docker / PWA) · efor **M** · **O4+O6 sonrası**

**Amaç:** mevcut boot pipeline (`start.sh`, `Dockerfile`, `docker-compose.yml` — VAR) yeni modül
env-toggle'larını taşısın; PWA parity (`vite-plugin-pwa` **VAR** → manifest+SW etkinleştir; `manifest.json`
**YOK, doğrulandı** → üretilecek); `.env.example` (**21 toggle — doğrulandı**) yeni `MODULE_*`/`ENABLE_*`
toggle'larıyla güncellensin.

**Ön-koşul:** **O4 modülleri + O6 GREEN.** **Çıkış-kapısı:** `/api/health` yeşil + PWA lighthouse geçer +
toggle-off default'ta hatasız boot (her modül opsiyonel — 01-vision KN-7).

### O8 — Test (Parity-Gate + E2E) · efor **M** · **her fazın kapısı + program-sonu**

**Amaç:** 09-testing-convergence'in **59-kapı matrisini** tek gate'e topla; program-sonu
`convergence_score=1.0` doğrula. Mevcut test-altyapısı: **vitest+playwright+RTL, 425 test dosyası
(doğrulandı)**. **E2E-1..8** (09 §6): upload→extract, email-triage→draft, calendar-ICS-roundtrip,
plugin-install, 2FA-step-up, design-handoff, toggle-off-boot, full-regresyon.

**Ön-koşul:** **ilgili faz GREEN + baseline (KN-R13: 425 test yeşil-taban).** **Çıkış-kapısı:** 09 §9
kontrol listesi tam GREEN + 29 CRITICAL kapı ayrıca GREEN (gizleme yasak).

---

## 3. Bağımlılık Grafiği (yönlü, doğrulanmış)

```
                         ┌─────────────────────────────────────────────┐
                         │  O0  DÖRT-ŞEF CONVERGENCE (BLOCKER)          │
                         │  1.rag-service(S)  2.module-registry(S-M)    │
                         │  3.scheduler(M)    4.migration-v7(S)         │
                         └───────┬─────────────────────┬───────────────┘
                                 │                     │
                    ┌────────────▼────────┐   ┌────────▼─────────┐
                    │ O1 mimari (S-M)     │   │ (rag+scheduler   │
                    │ registry mount +    │   │  modül-erişimi   │
                    │ role kolonu v7      │   │  O0'dan sızar)   │
                    └───┬──────────┬──────┘   └────────┬─────────┘
                        │          │                   │
              ┌─────────▼──┐   ┌───▼──────────┐        │
              │ O2 design  │   │ O5 mcp-ext + │        │
              │ (M,paralel │   │ config+route │        │
              │  backend-  │   │ split (M-L)  │        │
              │  bağımsız) │   └───┬──────────┘        │
              └─────┬──────┘       │                   │
                    │              │                   │
              ┌─────▼──────┐       │                   │
              │ O3 handoff │       │                   │
              │ (S/panel)  │       │                   │
              └─────┬──────┘       │                   │
                    │              │                   │
         ┌──────────▼──────────────▼───────────────────▼──────────────┐
         │ O4  FEATURE MODÜLLERİ (7)                                   │
         │                                                            │
         │  chat(S) ─ cookbook(M) ─ documents(M)◄─rag ─ research(M)◄─rag│
         │       └────────── paralel (O0 sonrası) ──────────┘         │
         │                                                            │
         │  notes(L)◄─scheduler,rag   calendar(L)◄─scheduler,MCP-ext  │
         │  email(L)◄─MCP-ext(yumuşak),vault                          │
         └───────────────────────────┬────────────────────────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ O6 security (XL)         │◄── O1 role kolonu
                         │ RBAC→tool-policy→step-up │    O4 tool'larını gate'ler
                         │ TOTP ∥ poison-guard      │
                         │ threat-model (SON)       │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ O7 deploy (M)           │◄── O4 + O6 GREEN
                         │ boot/Docker/PWA/toggle  │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ O8 test parity=1.0 (M)  │◄── her faz kapısı
                         └──────────────────────────┘
```

**Kenar gerekçeleri (kanıt):**
- `rag ← documents, research, notes` — 01-vision KN-3 + `server/rag.ts` (VAR); embed/similarity bu modüllerin memory'si.
- `scheduler ← notes, calendar, email` — calendar-caldav K1 + notes-tasks K1 (**ikisi de doğrulandı**: genel scheduler YOK; ortak `setInterval`; notes-tasks Faz 3 `cron.ts` calendar reminders'ı **paylaşır** — tek-kaynak).
- `MCP-ext ← email, calendar` — **yumuşak** kenar: email-mcp.md "registry→/mcp otomatik" + mcp-extensions manifest zenginleştirir (bloklamaz — KN-R8).
- `role(O1) ← O6` — 07-security O6.2/GAP-2; RBAC role kolonu O1 migration'da.
- `O1 route-split ↔ O5 route-split` — 06-extensibility O5-Adım 4 ile O1 refactor **aynı yüzey** → koordinasyon (KN-R12).
- `O4+O6 ← O7` — deploy gate güvenlik enforcement olmadan ship YASAK (03-ui K6).

---

## 4. Yürütme Sırası (T0-kapılı, paralellik-optimize) — 8 Dalga

> **CLAUDE.md Tier-1 kuralı:** bağımsız fazlar TEK MESAJDA paralel sub-agent; T=max(T_i). Aşağıdaki
> "dalga"lar paralel-güvenli grupları gösterir. **O0 bitmeden hiçbir modül fazı spawn edilmez** (01-vision §5).

| Dalga | Fazlar (paralel-güvenli) | Ön-koşul | Toplam efor (paralel) | T0 kapısı |
|---|---|---|---|---|
| **W0** | O0 (4 alt-parça: rag/registry/scheduler/migration) | KN-R1+KN-R4 karar | **M** | temel testler GREEN |
| **W1** | O1 (mimari+role) ∥ O2 (design başlar) | O0 GREEN | **S–M** | registry mount + role-migration + ilk bundle |
| **W2** | O5-core (mcp-ext A–B + config.ts) ∥ O3-chat ∥ O4-chat ∥ O4-cookbook | O1 GREEN | **M** | mcp P1–P3 + config + chat/cookbook parity |
| **W3** | O4-documents ∥ O4-research ∥ O3-panels ∥ O5-rest (C–F, route-split) | O0-rag + O1 | **M–L** | documents+research parity (rag-bağlı) |
| **W4** | O4-notes ∥ O4-calendar ∥ O4-email | O0-scheduler + O5-core | **L** | 3 sıfırdan/ağır modül parity (en ağır dalga) |
| **W5** | O6 (TOTP ∥ poison-guard, sonra RBAC→policy→step-up, threat-model SON) | O1-role + O4-tools | **XL** | 07-security §6 tablo GREEN |
| **W6** | O7 (deploy/PWA) | O4 + O6 | **M** | health yeşil + PWA + toggle-off boot |
| **W7** | O8 (program parity-gate + E2E-1..8) | tüm | **M** | `convergence_score=1.0` |

**Her T0 kapısı (değişmez):** Emre onayı → (UI ise) handoff bundle → TDD kırmızı→yeşil →
gate (`npm run lint`=tsc + `eslint` + `npm test` fresh) → commit `feat(<faz>): <özet>`.
**CRITICAL gizleme YASAK** (CLAUDE.md kural-4). **implementer ≠ verifier** (her modül A2-validator geçer).

**En kritik yol (critical path):** `O0 → O1 → O5-core → O4-email/calendar → O6 → O7 → O8`.
En uzun zincir W4 (L-modüller) + W5 (XL-security). Program süresini bu belirler; W2–W3 paralelde emilir.

---

## 5. Efor Tahmini — Toplam + Gerekçe

| Faz | Efor | Ajan-oturumu (tahmin) | Gerekçe (koda-dayalı) |
|---|---|---|---|
| O0 | M | 3–4 | rag VAR (entegrasyon), registry+scheduler yeni-küçük, migration zinciri hazır (v6→v7) |
| O1 | S–M | 2–3 | registry mount + role-migration; `server.ts` 3191-satır refactor riski (monolit) |
| O2 | M | 3–4 | 8 panel brief → gerçek Design export (Emre-loop, iterasyon) |
| O3 | M–L | 8×S≈4–6 | panel-başına implement; token-remap (K2) sürtünmesi |
| O4 | değişken | chat 1 · cookbook 3 · documents 3 · research 3 · notes 6 · calendar 6 · email 6 ≈ **28** | 3 L-modül ağır; 16 npm-deps + parse + recurrence yeni |
| O5 | M–L | 5–7 | MCP %70 hazır → manifest+hooks+FSM+audit (6 faz A–F) + config.ts + route-split (06-ext) |
| O6 | XL | 8–10 | güvenlik-kritik; TOTP+RBAC+policy+poison+threat, backend-enforce zorunlu |
| O7 | M | 2–3 | boot/Docker VAR, PWA plugin VAR → çoğunlukla toggle+manifest+SW |
| O8 | M | 3–4 | parity-gate toplama + E2E-1..8 happy-path'ler |
| **Toplam (seri)** | — | **~58–74 oturum** | seri üst-sınır |
| **Toplam (paralel W0–W7)** | — | **~30–38 oturum** | Tier-1 paralellik ile ~%45 kısalma |

**Kalibrasyon uyarısı:** bu ajan-oturumu tahminidir, **takvim/insan-saat değil**. Sub-agent paralelliği
(CLAUDE.md Tier-1) W2–W4'ü sıkıştırır. Gerçek sürtünme kaynakları (aşağı-doğru risk): odysseus doğrulaması
(KN-R1), Claude Design export şeması (KN-R5), **16 npm-deps'in supply-chain + SEA-bundle audit'i** (KN-R7),
O6 güvenlik enforcement sağlamlığı. **Tahmin ±%30 belirsizlik taşır** (§10 KN-R3).

---

## 6. Program-Düzeyi Parity Kabul Kriteri

Odyssey **DONE** ⇔ tüm aşağıdakiler GREEN (`convergence_score=1.0` — 09-testing-convergence §5):

- [ ] **Modül-parity (7 modül):** research · documents · email · notes/tasks · calendar · cookbook · chat —
      her biri: fonksiyon + extensibility + config-toggle + persistence + UI + kalite-kapısı (01-vision §7).
- [ ] **Extensibility-parity (P1–P10):** manifest + lifecycle-FSM + hooks + audit + tek-dispatch (mcp-extensions §5)
      + config.ts merkezi + route-split + DEVELOPER.md (06-extensibility §5).
- [ ] **Security-parity (8 kriter):** TOTP + step-up + RBAC + role-aware tool-policy + config-policy +
      poison-guard + threat-model + audit (07-security §6).
- [ ] **Cross-cutting:** PWA (manifest+SW) + theming dark/light + i18n EN+TR (her panel).
- [ ] **Kalite kapısı (fresh):** `npm run lint` (tsc 0) ✓ · `eslint` ✓ · `npm test` ✓ · `npm run test:e2e` happy-path ✓.
- [ ] **$0-local korunur:** her modül default toggle-off VEYA $0-local (qwen3:8b); zorunlu ücretli servis YOK.
- [ ] **Regresyon-yok:** mevcut 21-tab + conformance + migration v1–v6 zinciri kırılmadı + 425-test baseline korundu.

**Ölçüm:** `convergence_score = geçen_kapı / toplam_kapı → 1.0` (09-testing-convergence §5: **59+ kapı, 29 CRITICAL**;
payda research/cookbook .md yazılınca dondurulur — KN-R9).

---

## 7. Belge-Üretim Backlog (bu roadmap'in işaret ettiği eksik planlar)

Aşağıdaki modül .md'leri **henüz YOK** — ilgili faz spawn edilmeden önce yazılmalı (01-vision §9 zinciri):

| Eksik belge | Kapsam | Bloklar | Öncelik |
|---|---|---|---|
| `02-foundation.md` | O0 detay TDD (rag-service + registry + scheduler + migration-v7) | O0 başlangıcı | **P0 (ilk)** |
| `04-research.md` | deep_research + SearXNG adapter + citation (03-ui §3.2 genişletir) | O4-research | P1 |
| `04-cookbook.md` | hw-detect + fit-score + pull-progress (03-ui §3.7 genişletir) | O4-cookbook | P1 |
| `08-deploy-pwa.md` | boot toggle + Docker + PWA manifest/SW + lighthouse | O7 | P2 |

**✅ Backlog'dan düşen:** `notes-tasks.md` **yazıldı** (artık VAR); `09-*` (test/parity-gate) **yazıldı**
(`09-testing-convergence.md`). documents/email/calendar/mcp-extensions/security/extensibility **zaten var**.
Yani belge-boşluğu 6'dan **4'e** düştü; research/cookbook için 03-ui panel-brief'i **UI-katmanı** verir ama
**backend feature planı yok** (03-ui K3) → yukarıda P1.

---

## 8. Efor Tahmini — Gerekçe Notu (koda-dayalı düzeltmeler)

01-vision'daki ilk sezgiye göre **program eforu aşağı düzeltildi**, çünkü koda karşı doğrulama şunları buldu:

1. **RAG uçurumu kapandı** — 01-vision KN-3 "JSON store → SQLite+vektör-DB geçişi Faz 0'da yapılmazsa
   parity imkansız" dedi. Ama `server/rag.ts` (v1.13, sqlite-vec, `rag_index`/`rag_search`, injectable
   embedder, dedicated DB) **ZATEN VAR (doğrulandı)**. O0 = yeni-inşa değil **modül-servis açımı**. → **-2 oturum.**
2. **MCP %70 hazır** — mcp-extensions.md doğruladı; O5 sıfırdan-plugin değil manifest+hooks formalize. → **-2.**
3. **PWA plugin VAR** — `vite-plugin-pwa` devDep'te (doğrulandı); O7 = etkinleştir+manifest (manifest.json YOK),
   yeni-plugin değil. → **-1.**
4. **`server/tools/` dizini VAR** — email-mcp.md `server/tools/email/` beklentisi dizin-oluşturma sürtünmesi yaşamaz. → nötr.
5. **`notes-tasks.md` yazıldı** — O4-notes plansız-başlama riski kalktı; scheduler tek-kaynak kararı netleşti. → **-0.5.**

**Yukarı-doğru düzeltmeler (efor artıran):**
- O6 güvenlik XL kaldı — TOTP+RBAC+poison backend-enforce sağlamlığı test-ağır (07-security RISK-2/4).
- **16 yeni npm deps** (documents 5 + email 3 + calendar 4 + security 2 + cookbook/notes ~2) → her biri
  supply-chain audit + SEA-bundle uyumu (email-mcp A1, calendar K3, documents K1). **Hiçbiri şu an yüklü değil (doğrulandı).**
- `server.ts` 3191-satır monolit — O1 registry-refactor çakışma riski (01-vision KN-4) + O5 route-split kesişimi (KN-R12).

**Net:** paralel yürütmede **~30–38 ajan-oturumu**, seri **~58–74**. ±%30 belirsizlik.

---

## 9. Doğrulama Günlüğü (bu roadmap'in kanıt tabanı)

Bu belge yazılırken `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek kodu okundu (2026-07-10, bu oturumda):

| İddia | Kanıt (komut/dosya) | Sonuç |
|---|---|---|
| `server.ts` = 3191 satır | `wc -l server.ts` → 3191 | ✅ monolit (00-MASTER "163k byte / 3191 satır" tutarlı) |
| RAG/vektör-store VAR | `server/rag.ts` (sqlite-vec, `rag_index/rag_search`, dedicated DB, v1.13) | ✅ O0 hafifledi |
| Migration v6'da bitiyor | `grep version: migrations.ts` → son v6 | ✅ v7+ yeni tablolar |
| `module-registry.ts` YOK | `ls server/module-registry.ts` → yok | ✅ O0 registry yeni |
| `server/scheduler.ts` YOK | `ls server/scheduler.ts` + `server/scheduler/` → yok | ✅ O0 scheduler yeni (tick deseni baz) |
| `hooks.ts`/`manager.ts` YOK | `ls server/mcp/{hooks,manager}.ts` → yok | ✅ O5 yeni-inşa (interceptors embriyo üstü) |
| `server/{notes,tasks,calendar}` YOK | `ls -d` → yok | ✅ O4 modül dizinleri yeni |
| MCP choke-point olgun | `server/tool-registry.ts` 971 satır + `tool-interceptors.ts` | ✅ O5 %70 hazır |
| PWA plugin VAR, manifest YOK | `grep vite-plugin-pwa package.json` ✓; `ls public/manifest.json` → yok | ✅ O7 = etkinleştir+manifest |
| `server/tools/` VAR | dizin mevcut (`search_browser.ts`) | ✅ email dizini sorunsuz |
| `.env.example` = 21 toggle | `grep -cE "^[A-Z_]+=" .env.example` → 21 | ⚠️ modül .md'lerin "38/40+/46" iddiasıyla çelişki (§10 KN-R2) |
| App.tsx = 21 tab | `grep -c "id:" src/App.tsx` → 21 | ✅ 03-ui K4 (nav taşma) doğrulandı |
| Gate komutları | `package.json`: `lint`=`tsc --noEmit`, `test`=`vitest run`, `test:e2e`=`playwright test`, `build`=vite+esbuild×2 | ✅ kapı komutları net |
| Test altyapısı | `vitest@4.1.8` + `@playwright/test@1.61` + `@testing-library/react@16.3.2`; **425 test dosyası** (worktree hariç) | ✅ O8 tabanı güçlü |
| 16 modül-deps HEPSİ YOK | `grep package.json`: unpdf/mammoth/xlsx/marked/dompurify/imapflow/nodemailer/mailparser/tsdav/node-ical/rrule/ical-generator/otplib/qrcode/croner/searxng → hepsi yok | ✅ O4/O6 supply-chain iş yükü (KN-R7) |
| `notes-tasks.md` YAZILMIŞ | `ls docs/odyssey/05-features/` → notes-tasks.md (192 satır) | ✅ backlog 3→2 (§7) |
| GAP-1/GAP-2 KAPALI | 07-security §7: `db.encrypt` AES-256-GCM `db.ts:312`; `role` wiring `server.ts:2385` | ✅ O6 ön-okuma azaldı |

---

## 10. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN-R1** | Bilinmeyen | **odysseus repo (github.com/pewdiepie-archdaemon/odysseus, 82k★) DOĞRULANMADI** — modül listesi + stack task-brief'ten; tüm modül .md'leri bu varsayıma dayanıyor (00-MASTER KN-M2, 09 KN-1, her feature .md son ledger satırı) | Parity hedefi yanlış kalibre olabilir; **program-geneli risk** | O0 öncesi odysseus README/mimari **fetch+doğrula** (WebFetch); sapmada roadmap + modül .md'leri güncelle. Parity **listelenen alt-yeteneklere** göre tanımlı, API imzaları ollamas-native |
| **KN-R2** | Çelişki | `.env.example` gerçekte **21 toggle** (bu oturumda doğrulandı) ama email-mcp.md "40+", mcp-extensions.md/06-extensibility "38/~46", 01-vision "~21" diyor | Config-parity iddiası şişirilmiş; fazla-mühendislik riski | YAGNI: toggle modül-ihtiyaç doğunca eklenir (01-vision KN-6); "40+" hedef değil doğal-sonuç; O5 `config.ts` şeması kesin sayıyı üretir |
| **KN-R3** | Varsayım | **Efor tahmini "ajan-oturumu"** cinsinden; paralel sub-agent kapasitesi + Claude Design iterasyon hızı bilinmiyor | Takvim tahmini yapılamaz; ±%30 | Tahmin oturum-sayısı, saat değil; ilk dalga (W0) sonrası hız kalibre edilir |
| **KN-R4** | Bilinmeyen | **Google gmail/calendar tab'ları korunacak mı yoksa self-hosted MCP ile değiştirilecek mi** — Emre T0 kararı henüz yok (00-MASTER KN-M6, calendar K7, email R5) | O4-email/calendar kapsamı + çift-bakım | calendar-caldav.md kararı: Google-read'i **provider olarak koru** (absorbe, GmailBrowser değiştirilmez); Emre onayı gerek |
| **KN-R5** | Varsayım | **Claude Design export formatı** (HTML+screenshot+README, Nisan 2026) doğrulanmadı (03-ui K1/K2, 00-MASTER KN-M3) | O2/O3 handoff sözleşmesi kayabilir; token-remap gerekebilir | İlk panel (chat) gerçek export ile pilot → §2-O2 şablonu ampirik düzelt |
| **KN-R6** | Risk | **`server.ts` 3191-satır monolit** — O1 registry-refactor + 7 modül route eklemesi çakışma/regresyon üretebilir | Bakım borcu, merge-çakışma | O1'de `module-registry` zorunlu; her modül `server/<ad>.ts` ayrı dosya; characterization-test önce (mcp-extensions K9); route-split küçük partiler + supertest regresyon (06-ext KN-4) |
| **KN-R7** | Risk | **16 yeni npm deps HEPSİ YOK** (doğrulandı) → supply-chain + SEA-bundle yüzeyi büyük | Build kapısı + güvenlik | her dep `tob-supply-chain-risk-auditor` + `npm audit` + lisans MIT/ISC pin; documents K1 SEA native-binding taraması (`npm ls`); email A1 host-yalın teyit; `croner` zero-transitive doğrula |
| **KN-R8** | Risk | **O5 email/calendar bağımlılığı yumuşak-mı-sert-mi** — email-mcp.md "registry→/mcp otomatik" (O5 bloklamaz) ama mcp-extensions manifest email'i "zenginleştirir" | Sıralama yanlışsa W4 erken/geç | Kabul: email/calendar **tool'ları** O5'siz çalışır (ToolRegistry-native); O5 yalnız manifest/lifecycle katar → W4, O5-core (Faz A–B) sonrası güvenli |
| **KN-R9** | Bilinmeyen | **2 backend feature .md eksik** (research/cookbook — §7 backlog; notes-tasks ARTIK VAR) — roadmap onları 03-ui panel-brief'ine dayandırıyor ama backend TDD planı yok | O4-research/cookbook plansız başlar; convergence paydası kararsız (09 KN-C1/KN-C4) | §7 P1: `04-research.md` + `04-cookbook.md` O4-ilgili-dalga öncesi yazılır (blocker); yazılınca 09 §5 payda dondurulur |
| **KN-R10** | Varsayım | **Poison-guard "Şef-3"** ve **gwv2-hooks** isimleri task-brief'ten; kodda karşılık YOK (07-security VAR-1, mcp-extensions K1, 00-MASTER KN-M7) | Terminoloji/kapsam kayması | Emre onayı: "Şef-3"=yeni interceptor (verifier deseni uzantısı), "gwv2"=`hooks.ts` sabitlensin; plan bunları yeni-inşa kabul ediyor; poison-guard=defense-in-depth (RISK-4: regex LLM-saldırı atlar, asıl savunma verifier-izolasyonu) |
| **KN-R11** | Risk | **2FA lokal-mod kapsamı** (07-security BIL-1): SAAS_ENFORCE≠1 owner'a TOTP uygulanmalı mı? | O6 UX + kapsam | Varsayılan: 2FA yalnız SAAS_ENFORCE=1 admin işlemlerde; Emre kararı (lokal-owner UX bozulmasın) |
| **KN-R12** | Risk | **O1 route-split ↔ O5 (06-extensibility O5-Adım 4) aynı `server.ts` yüzeyi** — iki faz aynı monoliti böler; koordinasyonsuz çakışır (06-ext KN-3/KN-4) | Çift-iş + merge-çakışma + auth/CORS/middleware-order kırılması | 00-MASTER'da sınır: O1=registry-mount + role; O5=config.ts + tam route-split. Route-split **tek sahip** (O5), O1 yalnız registry-seam açar; middleware-order snapshot testi zorunlu |
| **KN-R13** | Doğrulama-açığı | **425 mevcut test + e2e yeşil-taban bu oturumda KOŞULMADI** (09 KN-C6) — bazı `*.e2e`/`*-live` ağ ister, flaky olabilir | Gate G3/G4 kararsız; regresyon-tabanı bilinmiyor | O0 öncesi `npx vitest run` + `playwright test` baseline al; live-gated'leri `describe.skipIf(!LIVE)` ile ayır; convergence yalnız deterministik suite'e bağlanır (09 O8-K5) |

---

## 11. Sonraki Adım (T0 kapısı)

1. **KN-R1 kapat:** odysseus repo fetch+doğrula (sapma varsa modül .md'leri + bu roadmap güncelle).
2. **KN-R4 + KN-R10 + KN-R11 kapat:** Emre T0 kararları (Google-tab kaderi · Şef-3/gwv2 isim · 2FA lokal-mod).
3. **KN-R13 kapat:** `npx vitest run` + `playwright test` baseline koş, 425-test yeşil-taban kaydet.
4. **§7-P0 yaz:** `02-foundation.md` (O0 detay TDD) — program-başlangıç blocker. (P1: research + cookbook .md.)
5. **W0 spawn:** O0 dört-şef convergence (rag-service ∥ module-registry ∥ scheduler ∥ migration-v7),
   test-önce (RED→GREEN→gate), sonra W1 (O1 ∥ O2) paralel dalgası.

**Değişmez:** O0 GREEN olmadan hiçbir modül fazı spawn edilmez (01-vision §5). Her faz TDD + kalite-kapısı +
implementer≠verifier + CRITICAL gizleme YASAK (CLAUDE.md).

---

*Üretici: ODYSSEY planlama üreteci (sentez/roadmap katmanı). Girdi: `docs/odyssey/{00,01,03,06,07,09}.md` +*
*`05-features/{documents,email-mcp,calendar-caldav,mcp-extensions,notes-tasks}.md`. Kod-doğrulama (bu oturum):*
*`wc -l server.ts`=3191, `server/rag.ts`, `server/store/migrations.ts`=v6, `server/tool-registry.ts`=971,*
*`ls` module-registry/scheduler/hooks/manager/{notes,tasks,calendar}=YOK, `grep` 16-deps=YOK,*
*`vite-plugin-pwa`=VAR / `manifest.json`=YOK, `.env.example`=21 toggle, App.tsx=21 tab, 425 test dosyası. Tarih: 2026-07-10.*
