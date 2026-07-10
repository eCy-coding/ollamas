# ODYSSEY · 05-Features · Calendar (CalDAV / ICS)

> Modül: **Takvim** — CalDAV senkronizasyon + ICS import/export + tekrarlayan olaylar (recurrence) + hatırlatıcılar (reminders).
> Referans: odysseus `calendar` modülü (self-hosted AI workspace, CalDAV/ICS).
> Hedef: ollamas'ı odysseus-parity seviyesinde, `$0-local` prensibiyle kendi kendine barındırılan takvim çekirdeğine kavuşturmak.
> Dil: TR (anlatı) · EN (kod/komut/dosya-yolu). Her adım TDD (test-once).

---

## 1. Mevcut Durum (ollamas'ta gerçekte ne var — koda karşı doğrulandı)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` üzerinde `Read`/`Grep` ile **birebir doğrulandı** (varsayım değil):

### 1.1 VAR olanlar
- **`src/components/GoogleCalendarBrowser.tsx`** (166 satır) — TEK takvim yüzeyi.
  - **Read-only**: yalnızca `GET https://www.googleapis.com/calendar/v3/calendars/primary/events` çağırıyor (`maxResults=20`, `orderBy=startTime`, `singleEvents=true`).
  - **Browser-side only**: dosyanın başında açık yorum → "events go straight from googleapis.com to this component; **nothing touches the ollamas server**". Yani server-side takvim mantığı YOK.
  - Firebase Google sign-in token'ını (Drive/Sheets ile aynı consent) tekrar kullanıyor (`useAuth`).
  - `singleEvents=true` → Google recurrence'ı sunucu tarafında düzleştiriyor; **client recurrence/RRULE mantığı YOK**.
  - Interface `CalendarEvent`: `{id, summary?, htmlLink?, start{dateTime?,date?}, end{...}, location?}` — sadece görüntüleme.
- **`src/App.tsx`** — tab `"calendar"` (satır 118, 330-332) → `<GoogleCalendarBrowser/>` render ediyor. Sekme ikonu turuncu `Calendar` (lucide).
- **Deferred MCP `mcp__c7f423f1-6371-435d-ab0a-b7e762391de0__*`** — `list_calendars`, `list_events`, `create_event`, `update_event`, `delete_event`, `get_event`, `respond_to_event`, `suggest_time`. Bu bir **harici claude.ai connector** (Google/Outlook Calendar), ollamas kod tabanının parçası **DEĞİL**; ollamas server'ına bağlı değil, .mcp.json'da yok. → **c7f423f3 "calendar MCP zaten bağlı mı" sorusunun cevabı: HAYIR, ollamas'a bağlı değil; sadece bu Claude oturumuna açık harici bir connector.**
- **`.mcp.json`** — yalnızca 3 server: `ollamas` (kendi HTTP /mcp), `context7`, `deepwiki`. Takvim upstream'i YOK.
- **`server/mcp/catalog.ts`** — küratörlü MIT/stdio upstream kataloğu (memory, filesystem, everything...). **Takvim/CalDAV girişi YOK.**
- **Store**: `server/store/index.ts` + `migrations.ts` — SQLite tabanlı (adapter: `server/store/db-adapter.ts`; dep: `sqlite-vec`). Migration versiyonları **v1→v6** (usage_events, oauth_clients/codes/tokens/refresh_tokens, ukp_stage_events). **Takvim/event/reminder tablosu YOK.**
  - **Kritik mimari nüans (doğrulandı — `migrations.ts:3-9`):** *"initStore()'s `CREATE TABLE IF NOT EXISTS` DDL is the BASELINE — a fresh DB already gets the current schema. Migrations carry schema EVOLUTION from here forward."* Yani yeni tablolar hem `server/store/index.ts` baseline DDL'ine (taze DB) **hem de** yeni bir `MIGRATIONS` girişine (mevcut DB evrimi) eklenmelidir — ikisinden biri unutulursa taze-DB veya upgrade-DB ayrışır. `runMigrations()` `db.withLock` (cross-replica advisory lock) altında versiyon başına tam-bir-kez, sırayla uygular; duplicate versiyon module-load'da fail-fast eder (`migrations.ts:174-177`).
- **Ortak scheduler altyapısı (doğrulandı — K1 için kanıt):** ollamas'ta ayrı bir "notes/tasks scheduler" **yok**, ancak `setInterval`-tabanlı periyodik tick deseni **defalarca** kullanılıyor: `server/webhooks/outbound.ts:74-83` (outbound retry drain), `server/mcp/supervisor.ts:137` (`tickOnce`), `server/oauth-gc.ts:18` (expired OAuth purge), `server/ecysearch.ts:188` + `server/ecysearcher.ts:130` (health tick). Reminder scheduler (Faz 5) bu **kanıtlanmış desene** kancalanır — sıfırdan zamanlayıcı icat etmeye gerek yok.
- **Choke-point tool kaydı (doğrulandı):** `server/tool-registry.ts` var — *"Single choke-point for ALL workspace tool execution"* (satır 1), `type ToolTier = "safe" | "host" | "privileged" | "host_upstream"` (satır 43), tek `execute()` choke-point. Faz 7 MCP-as-extension buraya `calendar_*` araçları ekler; `/mcp` expose otomatik olur (registry → server).

### 1.2 YOK olanlar (net eksik parçalar)
| Yetenek | Durum | Kanıt |
|---|---|---|
| CalDAV client (sync, PROPFIND/REPORT, ctag/etag) | ❌ YOK | `grep -rin "caldav"` → 0 sonuç |
| RRULE / recurrence expansion (client-side) | ❌ YOK | `grep -rin "rrule\|recurrence\|RRULE"` → 0 sonuç |
| ICS/iCalendar parse+generate (VEVENT/VCALENDAR) | ❌ YOK | `grep -rin "VEVENT\|VCALENDAR\|icalendar\|node-ical\|ical-generator"` → 0 sonuç |
| Reminder / alarm scheduler | ❌ YOK (ama tick deseni VAR) | `grep node-cron` → 0; `reminder` scheduler yok. Kanıtlanmış `setInterval` tick deseni var (webhooks/outbound, mcp/supervisor, oauth-gc) — bkz §1.1 |
| Calendar CRUD server API (`/api/calendar/*`) | ❌ YOK | server.ts + server/*.ts'de calendar route yok |
| Takvim DB tabloları (`calendars`, `events`, `reminders`) | ❌ YOK | migrations v6'da bitiyor |
| İki-yönlü yazma (create/update/delete event) | ❌ YOK | GoogleCalendarBrowser sadece GET |
| Bağımlılıklar (`tsdav`, `ical.js`/`node-ical`, `rrule`, `ical-generator`) | ❌ YOK | package.json'da yok |

**Özet:** ollamas'ta takvim = "Google'a read-only pencere". odysseus'un sağlayıcı-bağımsız, self-hosted CalDAV/ICS çekirdeği tamamen eksik. Bu plan o çekirdeği kurar; Google browser'ı **provider adapter** olarak korur.

---

## 2. Odysseus Referansı (parity hedefi)

odysseus `calendar` modülü (FastAPI + SQLite, self-hosted):
- **CalDAV sync** — herhangi bir CalDAV sunucusuna (Nextcloud, Radicale, Fastmail, iCloud, Google via CalDAV) bağlanır; koleksiyon keşfi, `ctag`/`sync-token` ile artımlı senkron, `etag` ile çakışma tespiti.
- **ICS/iCalendar** — `.ics` dosyası import (VEVENT parse) + export (VCALENDAR üret). Tek olay ve tam takvim export.
- **Recurrence** — RRULE/RDATE/EXDATE genişletme; bir pencere içinde tekil örnekleri (occurrences) üretir; `singleEvents` mantığını **kendi** yapar (sağlayıcıya bağımlı değil).
- **Reminders** — VALARM / göreli hatırlatıcılar; cron/scheduler ile tetiklenir, notes/tasks modülüyle aynı zamanlayıcı altyapısını paylaşır.
- **Config-driven** — `.env` toggle'ları (CalDAV URL/kullanıcı/parola, sync aralığı, reminder kanalı).
- **MCP-as-extension** — takvim bir MCP server olarak da expose edilir (agent event okuyabilir/oluşturabilir).

**ollamas'a taşıma stratejisi:** FastAPI değil → mevcut **Node `server.ts` + `server/store` (SQLite)** üzerine; VanillaJS değil → mevcut **Vite+React `src/components`**; MCP → mevcut **`server/mcp`** choke-point. Provider soyutlaması: `CalendarProvider` arayüzü (CalDAV | ICS-file | Google-readonly).

---

## 3. Hedef Mimari (ollamas'a özgü)

```
src/components/CalendarPanel.tsx        ← yeni birleşik UI (GoogleCalendarBrowser'ı sarar/emekli eder)
  └─ month/agenda görünüm, event CRUD formu, .ics import/export butonu

server/calendar/
  ├─ provider.ts        ← CalendarProvider arayüzü (list/get/create/update/delete/sync)
  ├─ caldav.ts          ← tsdav tabanlı CalDAV client (PROPFIND/REPORT, ctag/etag)
  ├─ ics.ts             ← ICS parse (node-ical) + generate (ical-generator)
  ├─ recurrence.ts      ← rrule genişletme (window → occurrences, EXDATE/RDATE)
  ├─ reminders.ts       ← reminder scheduler (setInterval tabanlı, notes/tasks ile ortak)
  └─ routes.ts          ← /api/calendar/* REST (server.ts'e mount)

server/store/migrations.ts (v7,v8,v9)   ← calendars / events / reminders tabloları
server/mcp/catalog.ts                    ← (opsiyonel) CalDAV MCP upstream girişi
.env.example                             ← CALDAV_* + CALENDAR_REMINDER_* toggle'ları
```

**Bağımlılıklar (yeni):** `tsdav` (CalDAV), `node-ical` (ICS parse), `ical-generator` (ICS üret), `rrule` (recurrence). Hepsi MIT/ISC, `$0`, self-hosted uyumlu.

**Choke-point kuralı (mevcut N-012):** takvim server mantığı `server/calendar/`'da izole; MCP tarafı yalnız HTTP `/mcp` + `/api/*` üzerinden erişir, tool-registry'yi doğrudan import ETMEZ.

---

## 4. Hedef Plan — TDD Adımlı (test-once)

Her faz: **önce test yaz (kırmızı) → implementasyon (yeşil) → refactor**. Kalite kapısı: `typecheck ✓ lint ✓ vitest ✓` → sonra commit. Fazlar bağımsız olduğu ölçüde paralelize edilebilir; DB (Faz 0) tüm sunucu fazlarının ön koşuludur.

### Faz 0 — DB şeması + migrations (temel)
- **Test-once:** `server/store/__tests__/calendar-migrations.test.ts` — v7/v8/v9 uygulandıktan sonra `calendars`, `events`, `reminders` tabloları var; kolonlar (aşağıdaki şema) mevcut; idempotent (iki kez migrate = tek uygulama).
- **Implement (İKİ yere ekle — baseline sözleşmesi gereği, bkz §1.1):**
  1. **Baseline DDL** → `server/store/index.ts` `initStore()` içindeki `CREATE TABLE IF NOT EXISTS` bloğu (taze DB doğrudan güncel şemayı alsın).
  2. **MIGRATIONS girişi** → `migrations.ts`'e `version: 7/8/9` (mevcut DB evrimi). Tablolar:
  - `calendars(id, tenant_id, name, color, source, caldav_url, sync_token, ctag, read_only, created_at)`
  - `events(id, tenant_id, calendar_id, uid, summary, description, location, dtstart, dtend, all_day, tzid, rrule, exdate, rdate, etag, sequence, status, updated_at)` + index `(tenant_id, dtstart)`
  - `reminders(id, event_id, trigger_offset_sec, method, fired_at, next_fire_at)`
- **Store API:** `createEvent/getEvent/listEvents(range)/updateEvent/deleteEvent`, `upsertCalendar`, `dueReminders(now)` fonksiyonları `server/store/index.ts`'e.
- **DoD:** migration idempotent (iki-kez-run no-op, `db.withLock` altında); taze-DB (baseline) ile upgrade-DB (migration) **aynı** şemayı üretir; mevcut v6 zinciri kırılmadı; duplicate-version fail-fast korunur.

### Faz 1 — Recurrence engine (saf, bağımsız — Google `singleEvents`'i biz yapalım)
- **Test-once:** `server/calendar/__tests__/recurrence.test.ts` — RRULE `FREQ=WEEKLY;BYDAY=MO,WE` verilen pencerede doğru occurrence sayısı; `EXDATE` bir örneği çıkarır; `RDATE` ekler; `UNTIL`/`COUNT` sınırları; tüm-gün (all-day) TZ kayması yok.
- **Implement:** `server/calendar/recurrence.ts` — `rrule` ile `expand(event, {from, to}) → EventOccurrence[]`. Saf fonksiyon, I/O yok.
- **DoD:** DST sınırında (ör. Europe/Istanbul) kayma testi geçer; edge — sonsuz kural pencereyle sınırlanır (OOM guard).

### Faz 2 — ICS import/export
- **Test-once:** `server/calendar/__tests__/ics.test.ts` — bilinen fixture `.ics` (tek VEVENT + RRULE + VALARM) parse → beklenen event nesnesi; round-trip (parse→generate→parse) alan kaybı yok; birden çok VEVENT; bozuk ICS → hata değil, kısmi + uyarı.
- **Implement:** `server/calendar/ics.ts` — `parseIcs(text) → EventInput[]` (node-ical), `generateIcs(events) → string` (ical-generator). Fixture: `tests/fixtures/calendar/sample.ics`.
- **DoD:** RFC5545 zorunlu alanlar (UID, DTSTAMP, DTSTART) korunur; VALARM → reminder eşlenir.

### Faz 3 — CalendarProvider arayüzü + CalDAV client
- **Test-once:** `server/calendar/__tests__/caldav.test.ts` — `tsdav` HTTP çağrıları **mock** (nock/msw-node); `sync()` ctag değişmediyse no-op; değiştiyse etag-delta çeker; create → PUT + döndürülen etag saklanır; 412 (etag çakışması) → conflict sinyali. **Canlı CalDAV sunucusuna bağlanma testi YOK** (deterministik olsun).
- **Implement:**
  - `server/calendar/provider.ts` — `interface CalendarProvider { list, get, create, update, delete, sync }`.
  - `server/calendar/caldav.ts` — `tsdav` ile CalDAV adapter (PROPFIND koleksiyon keşfi, REPORT olay çekme, ctag/sync-token artımlı).
- **DoD:** çakışma (412) çökme değil, kullanıcıya "reload" sinyali; sync artımlıdır (tam-çekim değil).

### Faz 4 — REST API (`/api/calendar/*`) + server.ts mount
- **Test-once:** `server/calendar/__tests__/routes.test.ts` — supertest ile `GET /api/calendar/events?from&to` (recurrence genişletilmiş), `POST /api/calendar/events`, `PUT/DELETE /:id`, `POST /api/calendar/import` (ics), `GET /api/calendar/export.ics`. Auth: mevcut tenant/apikey middleware zorunlu; tenant izolasyonu (başka tenant event'i görünmez).
- **Implement:** `server/calendar/routes.ts` → `server.ts`'e mount (mevcut route kayıt desenini izle). Store + recurrence + ics'i birleştirir.
- **DoD:** tenant izolasyon testi geçer; export.ics geçerli VCALENDAR üretir (parse ile doğrula).

### Faz 5 — Reminder scheduler
- **Test-once:** `server/calendar/__tests__/reminders.test.ts` — sahte saat (`vi.useFakeTimers`) ile `dueReminders(now)` doğru olayları döndürür; tetiklenen reminder `fired_at` set edilir (çift-tetik yok); tekrarlayan olayda bir sonraki occurrence için `next_fire_at` yeniden hesaplanır.
- **Implement:** `server/calendar/reminders.ts` — periyodik tarayıcı; **mevcut `setInterval` tick desenini kopyala** (`server/webhooks/outbound.ts:74-83`'ün retry-drain döngüsü en yakın referans). Kanal: başta in-app/log; sonra webhook (mevcut `server/webhooks/outbound.ts` `scheduleRetry` altyapısını yeniden kullan). Timer lifecycle: modül-seviyesi `let timer` + `start()/stop()` (oauth-gc.ts:10-18 deseni).
- **DoD:** idempotent tetikleme (aynı reminder iki kez ateşlenmez); sunucu yeniden başlatınca kaçan reminder'lar telafi edilir (catch-up).

### Faz 6 — Frontend (CalendarPanel) + GoogleCalendarBrowser entegrasyonu
- **Test-once:** `tests/ui/calendar-panel.test.tsx` (vitest + RTL) — panel `/api/calendar/events` (mock) çeker ve agenda render eder; event oluşturma formu POST atar; .ics import butonu dosya yükler; boş durum + hata durumu.
- **Implement:** `src/components/CalendarPanel.tsx` — ay/agenda görünümü, CRUD formu, import/export. `GoogleCalendarBrowser`'ı "Google (read-only)" bir provider sekmesi olarak içine al (sil değil, absorbe et). `App.tsx` `"calendar"` tab'ini `CalendarPanel`'e yönlendir. i18n: `src/locales/en.ts` + `tr.ts` anahtarları.
- **DoD:** mevcut Google read-only akışı bozulmadan çalışır; yeni self-hosted CRUD çalışır.

### Faz 7 — Config + (opsiyonel) MCP-as-extension
- **Test-once:** `.env.example` toggle'ları belgeli; MCP eklenirse `server/mcp/__tests__` catalog testi.
- **Implement:** `.env.example`'a `CALDAV_URL/CALDAV_USER/CALDAV_PASS/CALENDAR_SYNC_INTERVAL_SEC/CALENDAR_REMINDER_ENABLED`. Opsiyonel: takvimi `/mcp` üzerinden agent'a expose et (list/create event tool'ları).
- **DoD:** toggle'sız (env yok) sistem hatasız açılır (takvim CalDAV-devre-dışı, ICS+local yine çalışır).

---

## 5. Odysseus-Parity Kabul Kriterleri

Modül "parity" sayılır ⇔ **tüm** aşağıdakiler yeşil:

1. **CalDAV sync:** Bir CalDAV sunucusu (Radicale/Nextcloud, local docker) eklenip artımlı senkron çalışır; ctag değişmeden no-op, değişince delta; etag çakışması (412) çökmeden ele alınır. *(entegrasyon testi opsiyonel; unit mock testi zorunlu)*
2. **ICS round-trip:** Harici bir `.ics` (RRULE + VALARM içeren) import edilir, düzenlenir, export edilir; harici bir takvim uygulaması onu geri okuyabilir (RFC5545 geçerli).
3. **Recurrence:** `singleEvents` mantığı **sağlayıcıdan bağımsız** kendi motorumuzda; EXDATE/RDATE/UNTIL/COUNT doğru; DST kayması yok.
4. **Reminders:** Göreli hatırlatıcı belirtilen offset'te bir kez tetiklenir; sunucu restart sonrası kaçanlar telafi edilir; tekrarlayan olayda sonraki occurrence için yeniden planlanır.
5. **Provider-agnostic:** En az 2 provider arkasında aynı `CalendarProvider` arayüzü çalışır (CalDAV + ICS-file); Google read-only üçüncü olarak korunur.
6. **Tenant izolasyonu + auth:** `/api/calendar/*` mevcut apikey/tenant middleware'iyle korunur; çapraz-tenant sızıntı yok.
7. **$0 / self-hosted:** Hiçbir zorunlu ücretli servis yok; env'siz açılışta ICS+local çalışır, CalDAV opsiyonel.
8. **Kalite kapısı:** `npm run typecheck && npm run lint && npx vitest run` (calendar test dosyaları dahil) yeşil; mevcut v6 migration zinciri kırılmamış.

---

## 6. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tür | Madde | Etki | Azaltma |
|---|---|---|---|---|
| K1 | ~~Bilinmeyen~~ **ÇÖZÜLDÜ** | odysseus'un paylaşımlı "notes/tasks scheduler"ı ollamas'ta **yok** — DOĞRULANDI. Ancak `setInterval` tick deseni **defalarca var**: `webhooks/outbound.ts:74-83`, `mcp/supervisor.ts:137`, `oauth-gc.ts:18`, `ecysearch/ecysearcher.ts`. | Faz 5 riski düştü: ortak scheduler icat etmeye gerek yok. | Reminder scheduler'ı `webhooks/outbound.ts` retry-drain desenine (`let timer` + `start/stop`) kancala. Artık plan bu kararı içeriyor (Faz 5 güncellendi). |
| K2 | Varsayım | SQLite adapter (`db-adapter.ts` + `sqlite-vec`) yeni tabloları ve tarih-aralığı sorgularını sorunsuz kaldırır. | Migration/sorgu performansı. | Faz 0 testinde gerçek adapter üzerinde range-query çalıştır; index (`dtstart`) ekle. |
| K3 | Risk | `tsdav` gerçek CalDAV sunucularıyla uyum (iCloud app-specific password, Google CalDAV OAuth farkı) değişkendir. | CalDAV Faz 3 canlı entegrasyon kırılgan olabilir. | Unit testler mock ile; canlı doğrulama Radicale (local docker, en uyumlu) ile; iCloud/Google ayrı "known-quirks" notu. |
| K4 | Risk | RRULE sonsuz kurallar (UNTIL/COUNT yok) pencere sınırı olmadan OOM üretebilir. | Recurrence Faz 1 DoS/OOM. | `expand()` zorunlu `{from,to}` penceresi + max-occurrence hard cap (ör. 1000). |
| K5 | Bilinmeyen | Auth modeli: `/api/calendar/*` **tenant/apikey** mı yoksa Firebase-user mı korunacak? (GoogleCalendarBrowser Firebase token kullanıyor, server API'leri apikey/tenant.) | Yanlış auth katmanı = ya sızıntı ya çift-auth. | Faz 4'ten önce `server.ts` mevcut korunan route middleware desenini teyit et; aynısını kullan. |
| K6 | Varsayım | 2FA/RBAC (odysseus admin/non-admin tool-policy) bu modülde kapsam dışı; salt takvim CRUD. | RBAC boşluğu. | Bu plan RBAC'ı ayrı modüle (04-security) bırakır; calendar route'ları tenant-scoped kalır. |
| K7 | Risk | Frontend absorpsiyon: `GoogleCalendarBrowser` mevcut `useAuth`/Firebase akışını kullanıyor; `CalendarPanel`'e gömerken consent/token akışı bozulabilir. | Faz 6 regresyon. | GoogleCalendarBrowser'ı **değiştirmeden** provider-sekmesi olarak wrap et; mevcut UI testleri koru. |
| K8 | Bilinmeyen | Zaman dilimi (TZID) depolama stratejisi: UTC mi, TZID+wallclock mı? all-day vs zamanlı olay karışımı. | Recurrence + görüntüleme TZ hataları. | `dtstart` UTC + ayrı `tzid` kolonu; all-day için `all_day=1` bayrağı ve tarih-only saklama. |
| K9 | Kapsam | c7f423f3 harici calendar MCP connector'ı (Google/Outlook) bu self-hosted plana **dahil edilmedi** — ollamas'a bağlı değil, farklı consent modeli. | Emre "MCP zaten bağlı" beklentisiyle çakışabilir. | Netleştirildi (§1.1): harici connector ≠ ollamas modülü; istenirse ayrı "provider: connector-bridge" fazı eklenebilir. |

---

## 7. Uygulama Sırası (özet)

`Faz 0 (DB)` → `Faz 1 (recurrence) ∥ Faz 2 (ICS)` → `Faz 3 (CalDAV/provider)` → `Faz 4 (REST)` → `Faz 5 (reminders)` → `Faz 6 (UI)` → `Faz 7 (config/MCP)`.
Her fazda: **test-once (kırmızı) → implement (yeşil) → typecheck+lint+vitest → commit** (`feat(calendar): <faz>`).
