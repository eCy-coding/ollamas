# ODYSSEY-DESIGN — Panel: Calendar (CalDAV / ICS) (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/calendar.md`
> **Odak:** Calendar paneli — self-hosted CalDAV/ICS takvim yüzeyi. odysseus `calendar` modülü parity hedefi (CalDAV sync + recurrence/RRULE + reminders + ICS import/export).
> **Kritik kısıt (KN-M6 / K7):** ollamas'ta **self-hosted takvim YOK** — mevcut tek yüzey `GoogleCalendarBrowser` (Google, **read-only**). Bu panel yeni bir `CalendarPanel` iskeleti tasarlar; **`GoogleCalendarBrowser` ayrı kalır** (silinmez, provider-sekmesi olarak absorbe edilir — mevcut Firebase/`useAuth` consent akışı bozulmaz).
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** (backend/API/localhost YOK). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Backend planı ayrı belgede:** `docs/odyssey/05-features/calendar-caldav.md` (tsdav / node-ical / rrule / ical-generator; reminder scheduler O5-cron desenini paylaşır; DB Faz 0). Bu belge yalnızca **UI-brief**tir, implementasyon değil.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Durum (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas/src/components/GoogleCalendarBrowser.tsx` (166 satır) + `docs/odyssey/05-features/calendar-caldav.md` §1 okundu (2026-07-10).

### 1.1 VAR olan tek yüzey — `GoogleCalendarBrowser.tsx` (Google, read-only)

| Özellik | Gerçek | Kanıt (dosya:satır) |
|---|---|---|
| **Read-only** | Yalnız `GET .../calendar/v3/calendars/primary/events` (`maxResults=20`, `orderBy=startTime`, `singleEvents=true`) | `GoogleCalendarBrowser.tsx:39-48` |
| **Browser-side only** | "events go straight from googleapis.com to this component; **nothing touches the ollamas server**" — server-side takvim mantığı YOK | `GoogleCalendarBrowser.tsx:5-7` |
| **Consent paylaşımı** | Firebase Google sign-in token (Drive/Sheets/Gmail ile **aynı consent**); `useAuth()` | `GoogleCalendarBrowser.tsx:3, 27` |
| **Recurrence** | `singleEvents=true` → Google **sunucu-tarafında** düzleştiriyor; **client RRULE mantığı YOK** | `GoogleCalendarBrowser.tsx:42` |
| **Görünüm** | Düz **agenda listesi** (upcoming events). Ay/hafta/gün grid **YOK** | `GoogleCalendarBrowser.tsx:147-163` |
| **Event modeli** | `{id, summary?, htmlLink?, start{dateTime?,date?}, end{...}, location?}` — salt görüntüleme | `GoogleCalendarBrowser.tsx:8-15` |
| **Mevcut durumlar** | `isConfigured===false` (Firebase yok) / `needsAuth` (giriş) / `error` (401/403 iki-tip) / boş / dolu | `GoogleCalendarBrowser.tsx:78-145` |
| **App.tsx sekmesi** | `"calendar"` tab → `<GoogleCalendarBrowser/>`; turuncu `Calendar` (lucide) ikon | `App.tsx:118, 330-332` (03-belgesi §1.3) |

### 1.2 YOK olanlar (bu panelin tasarlayacağı yüzeyler)

| Yetenek | Durum | Not |
|---|---|---|
| Ay / hafta / gün **grid görünümü** | ❌ YOK | Mevcut yalnız düz agenda listesi |
| Event **create / edit / delete** formu | ❌ YOK | Mevcut yalnız GET |
| **Tekrar-kuralı (RRULE)** UI | ❌ YOK | Google `singleEvents` düzleştiriyor; kendi motor YOK (backend Faz 1) |
| **Reminder / hatırlatıcı** UI | ❌ YOK | Backend reminder scheduler yok (Faz 5, O5-cron paylaşır) |
| **CalDAV hesap durumu** / bağlantı yüzeyi | ❌ YOK | tsdav client yok (backend Faz 3) |
| **ICS import/export** butonu + önizleme | ❌ YOK | node-ical/ical-generator yok (backend Faz 2) |
| **Multi-source** (Google + CalDAV + ICS) toggle | ❌ YOK | Tek kaynak (Google) |
| **TZ görselleştirme** (TZID, all-day vs zamanlı) | ❌ KISMİ | `formatStart()` yerel saat basıyor; DST/tzid görseli yok |

**Özet:** ollamas takvimi = "Google'a read-only agenda penceresi". Bu panel odysseus-parity **self-hosted takvim UI**'sini tasarlar (grid + CRUD + recurrence + reminder + CalDAV-durum + ICS). **Kritik koruma (KN-M6):** `GoogleCalendarBrowser` **değiştirilmeden** `CalendarPanel` içine "Google (read-only)" provider-sekmesi olarak absorbe edilir.

---

## 2. Hedef Panel — CalendarPanel (odysseus-parity UI iskeleti)

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır; grid state, `/api/calendar/*` fetch, recurrence genişletme, reminder tetikleme **Claude Code handoff** aşamasında implemente edilir (bkz `05-features/calendar-caldav.md` Faz 1/4/5/6). Claude Design yalnız **görsel iskeleti + mock durumları** üretir.

**Panel iskeleti (3 bölge + drawer):**

```
┌─ TOOLBAR ────────────────────────────────────────────────────────────
│  [◀ ▶ Bugün]  Temmuz 2026        [Ay|Hafta|Gün] toggle    [+ Etkinlik]
│  Kaynaklar: ◉ Google(read) ◉ CalDAV ◉ ICS   |  CalDAV: ● Senkron 2dk önce
├─ GRID (default: Hafta) ──────────────────────────────────┬─ DRAWER ───
│   Pzt  Sal  Çar  Per  Cum  Cmt  Paz                      │ Etkinlik   │
│   ┌──┐                     ┌──┐                           │  detayı    │
│   │  │ event bloğu         │  │ (renk = kaynak)           │  başlık    │
│   └──┘  (all-day şeridi üstte, saatli bloklar altta)      │  saat+TZ   │
│    ↑ tekrar-rozeti ⟳ + reminder-zili 🔔                   │  konum     │
│                                                            │  tekrar    │
│                                                            │  reminder  │
│                                                            │ [Düzenle]  │
│                                                            │ [Sil]      │
└────────────────────────────────────────────────────────────────────────
```

**Bölge sözleşmeleri:**
- **Toolbar:** ay/hafta/gün toggle (segmented control), bugün/prev/next navigasyon, kaynak toggle'ları (renk-kodlu checkbox), **CalDAV hesap-durumu rozeti** (senkron/hata/bağlı-değil), `+ Etkinlik` birincil buton, `ICS ↑ İçe-aktar / ↓ Dışa-aktar`.
- **Grid:** hafta görünümü default; all-day şeridi (üst) + saatli sütunlar; event bloğu **kaynak-rengi** (Google=turuncu, CalDAV=indigo, ICS=cyan); bloklarda **tekrar-rozeti** (⟳ RRULE varsa) + **reminder-zili** (🔔 hatırlatıcı varsa).
- **Sağ drawer (event detay):** başlık, saat + **TZID görseli** (örn. `10:00–11:00 · Europe/Istanbul`, all-day için `Tüm gün` rozeti), konum, açıklama, **tekrar-kuralı** (insan-okunur: "Her Pzt & Çar, 12 tekrar"), **reminder** (offset: "15 dk önce"), kaynak rozeti, `Düzenle` / `Sil`. Google-kaynaklı event'te `Düzenle/Sil` **disabled** (read-only) + "Google'da aç ↗".
- **Hızlı-ekle (`+ Etkinlik`):** modal/inline form — başlık, tarih+saat (all-day toggle), TZID seçici, konum, açıklama, **tekrar-kuralı builder** (freq + interval + byday + until/count), **reminder** (offset presets: yok / 15dk / 1sa / 1gün), hedef takvim (CalDAV yazılabilir kaynaklardan).

**Provider absorpsiyonu (KN-M6 koruma):** kaynak toggle'ında "Google (read)" seçilince grid'e mevcut `GoogleCalendarBrowser` agenda çıktısı (read-only, düzenlenemez bloklar) beslenir; CalDAV/ICS kaynakları yazılabilir. `GoogleCalendarBrowser` **silinmez** — `CalendarPanel` onu bir provider olarak sarar.

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul).

```
[GOAL]
Design the CALENDAR panel for a self-hosted, local-first AI workspace ("ollamas",
odysseus-parity). This panel is a provider-agnostic calendar surface: it renders
events from multiple sources (self-hosted CalDAV, imported ICS files, and an
existing read-only Google feed), supports month/week/day views, recurring events
(RRULE), reminders, and full create/edit/delete for writable sources. It REPLACES
a plain read-only "upcoming events" agenda list — but must PRESERVE the existing
Google read-only feed as one source among several (never delete it). NOT the app
shell — just the calendar content panel that mounts in the main area.

[LAYOUT]
- Full-height flex column: TOOLBAR (top) / GRID (fluid) with an optional right DRAWER.
- TOOLBAR (single row, wraps on tablet):
    • Left: prev/next chevrons + "Today" button + current period label ("July 2026").
    • Center: a segmented view toggle — Month | Week | Day (Week is default/active).
    • Right: "+ Event" primary button + an ICS split-button (Import ↑ / Export ↓).
    • Second sub-row: SOURCE toggles as colored checkboxes — Google (read-only,
      amber dot), CalDAV (indigo dot), ICS (cyan dot) — plus a CalDAV ACCOUNT-STATUS
      pill on the far right ("● Synced 2m ago" / "● Sync error" / "○ Not connected").
- GRID (default = WEEK): 7 day-columns (Mon–Sun) with a top ALL-DAY strip and an
  hourly time grid below. Events render as colored blocks (color = source). Each
  block may carry a small RECURRENCE badge (⟳) and a REMINDER bell (🔔). A faint
  "now" line marks current time. MONTH view = 6×7 day cells with up to 3 event
  chips + "+N more". DAY view = single wide column, hourly.
- RIGHT DRAWER (event detail, slides in when a block is clicked): title, time range
  with TZID shown (e.g. "10:00–11:00 · Europe/Istanbul"; all-day → "All day" chip),
  location, description, RECURRENCE rule in human-readable form ("Every Mon & Wed,
  12 times"), REMINDER offset ("15 min before"), a source badge, and Edit / Delete
  actions. For a Google-sourced event, Edit/Delete are DISABLED (read-only) and an
  "Open in Google ↗" link is shown instead.
- QUICK-ADD (from "+ Event"): a compact form (modal or inline) — title, date+time
  (with an all-day toggle), TZID picker, location, description, a RECURRENCE builder
  (freq dropdown + interval + weekday chips + until/count), a REMINDER offset picker
  (None / 15 min / 1 hour / 1 day before), and a target-calendar selector (writable
  CalDAV sources only).

[CONTENT]
Mock a single WEEK (Mon 6 Jul – Sun 12 Jul 2026) with 4 events across 2 sources:
  • "Standup" — Google (read-only, amber) — Mon & Wed 09:00–09:15, RECURRING (⟳),
    reminder 10 min before (🔔).
  • "Design review" — CalDAV (indigo) — Tue 14:00–15:00, Europe/Istanbul, location
    "Meet", reminder 1 hour before.
  • "Ali's birthday" — CalDAV (indigo) — Thu, ALL-DAY, recurring yearly (⟳).
  • "Q3 planning" — ICS-imported (cyan) — Fri 11:00–12:30, no reminder.
View toggle default = Week. CalDAV status pill = "● Synced 2m ago". Drawer open on
"Design review" showing full detail (editable, indigo source). Recurrence builder in
quick-add shows "Weekly · every 1 week · Mon, Wed · ends after 12".

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  Source colors: Google = amber #fbbf24 · CalDAV = indigo #6366f1 · ICS = cyan #22d3ee.
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Dark is primary; ALSO produce a light variant (token-driven, no dark: prefixes).
Motion: drawer slide-in 0.25s + fade; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR panel states:
  1. EMPTY CALENDAR — a writable source connected but no events this week: grid
     rendered with day columns + "now" line, a centered "No events this week —
     press + Event or import an .ics" hint. CalDAV pill "● Synced".
  2. SYNCING / LOADING — CalDAV pulling: status pill "● Syncing…" pulsing, grid
     shows skeleton shimmer blocks in a few slots, toolbar interactive.
  3. CALDAV ERROR — sync failed (e.g. 412 etag conflict / auth): red status pill
     "● Sync error", a non-blocking inline banner "CalDAV sync failed — showing
     last-known events. Reconnect?" with a retry link; grid still shows cached
     events (stale, not blank).
  4. FILLED — the 4-event mock week above, drawer open on "Design review".
Responsive:
  • DESKTOP (≥1024px): full week grid (7 columns) + drawer as a right side-panel.
  • TABLET (768–1023px): week grid horizontally scrollable OR auto-switch to DAY
    view; drawer becomes a bottom sheet; toolbar wraps to two rows.
Accessibility: role="grid" on the calendar, event blocks are buttons with aria-labels
("Design review, Tuesday 14:00 to 15:00, CalDAV"), drawer is a focus-trapped dialog
with aria-modal, view toggle is a radiogroup, source toggles are labeled checkboxes,
focus-visible rings, contrast AA. Keyboard: arrow keys move day focus, Enter opens
drawer, Esc closes.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Panel görünümü | Kritik detay |
|---|---|---|
| **1. Boş takvim** | Yazılabilir kaynak bağlı ama bu hafta event yok; grid + "now" çizgisi render; ortada `Bu hafta etkinlik yok — + Etkinlik veya .ics içe-aktar` ipucu; CalDAV pill `● Senkron` | Boş ≠ bağlantısız; grid iskeleti yine görünür |
| **2. Senkronize / yükleniyor** | CalDAV çekerken pill `● Senkron ediliyor…` pulse; grid'de birkaç slotta skeleton shimmer blok; toolbar etkileşimli | `.ollamas-skeleton` shimmer deseni |
| **3. CalDAV hata** | Sync başarısız (412 etag çakışması / auth); kırmızı pill `● Senkron hatası` + non-blocking banner `CalDAV senkron başarısız — son bilinen etkinlikler gösteriliyor. Yeniden bağlan?` + retry; grid **cache'li event'leri** gösterir (stale, boş değil) | non-blocking (panel çökmez, stale gösterir) |
| **4. Dolu etkinlik** | §3'teki 4-event mock hafta; drawer `Design review` üzerinde açık (düzenlenebilir, indigo kaynak) | happy-path referans; tekrar-rozeti + reminder-zili görünür |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema).

---

## 5. Responsive (desktop + tablet)

| Viewport | Grid | Drawer | Not |
|---|---|---|---|
| **Desktop (≥1024px)** | Tam hafta grid (7 sütun) + saatli ızgara | Sağ yan-panel (side drawer) | Mevcut `App.tsx` `.lg:col-span-3` content bölgesi baz |
| **Tablet (768–1023px)** | Hafta grid yatay-kaydırılabilir **VEYA** otomatik Gün görünümüne düş; toolbar 2 satıra sarar | Alt-sheet (bottom sheet) | Ay görünümü tablet'te en yoğun; gün-görünümü taşma vanası |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` §2.8 "mobil bozulmayan grid" genel kriteri geçerli ama detay tasarımı ayrı iş (Kör-Nokta KN7).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk calendar iskeletini üretir (muhtemel: tek-kaynak hafta grid, drawer yok).
2. **İnline-comment #1:** "Sağ drawer ekle — event bloğuna tıklayınca açılan focus-trapped dialog; başlık/saat+TZID/konum/tekrar/reminder + Düzenle/Sil. Google event'te Düzenle/Sil disabled + 'Google'da aç ↗'."
3. **Chat iterasyon #2:** "Kaynak toggle satırını ekle — Google(amber)/CalDAV(indigo)/ICS(cyan) renk-kodlu checkbox + CalDAV hesap-durum pill'i (senkron/hata/bağlı-değil 3 durum). Event blokları kaynak-rengiyle boyansın."
4. **İnline-comment #3:** "Event bloklarına tekrar-rozeti (⟳) + reminder-zili (🔔) mikro-ikonları ekle. Ay ve Gün görünümü varyantlarını da üret (toggle default Hafta)."
5. **Chat iterasyon #4:** "+ Etkinlik hızlı-ekle formunu üret — tekrar-kuralı builder (freq + interval + gün-chip + until/count) + reminder offset presets + hedef-takvim seçici (yazılabilir CalDAV)."
6. **Chat iterasyon #5:** "4 panel durumunu ayrı frame üret: boş-takvim / senkronize-yükleniyor / CalDAV-hata / dolu-etkinlik (drawer açık)."
7. **İnline-comment #6:** "Light varyantı token-driven üret (dark: prefix yok). Tablet: hafta-grid yatay-scroll VEYA gün-görünümüne düşüş + drawer bottom-sheet varyantı."
8. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (K1 azaltma); TZID + all-day görselini gözden geçir (KN4).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/calendar/` altına:

```
calendar/
  PROMPT.md              # §3'teki tam brief (token + mock + 4-state)
  design.html            # Claude Design export (self-contained, inline CSS)
  screenshot-empty.png   # 4 durum × dark
  screenshot-syncing.png
  screenshot-error.png
  screenshot-filled.png
  screenshot-*-light.png # her durumun light varyantı
  screenshot-tablet.png  # gün-görünümü düşüşü + bottom-sheet drawer
  HANDOFF.md             # ↓ zorunlu içerik
  tokens.snippet.css     # src/styles/tokens.css alt-kümesi + kaynak-renk map (brief'e gömülü)
  EVENT_BLOCK.spec.md    # event bloğu prop imzası (source, recurring?, reminder?, allDay?, tzid)
  WEEK_GRID.spec.md      # hafta grid prop imzası (days[], allDayRow, hourRange, nowLine)
  EVENT_DRAWER.spec.md   # detay drawer prop imzası + read-only (Google) davranışı
  RECURRENCE_BUILDER.spec.md # RRULE builder → rrule string sözleşmesi (freq/interval/byday/until/count)
```

**HANDOFF.md zorunlu içeriği:**
- Component ağacı: `CalendarPanel` → `CalendarToolbar` (view-toggle + source-toggle + CalDAV-status-pill + ICS-buttons) / `WeekGrid | MonthGrid | DayGrid` / `EventBlock[]` / `EventDrawer` / `QuickAddForm(RecurrenceBuilder, ReminderPicker)`.
- **Mevcut→yeni map:** `GoogleCalendarBrowser` **KORUNUR** — `CalendarPanel` içine "Google (read-only)" provider olarak wrap edilir (silinmez); `App.tsx` `"calendar"` tab'i `GoogleCalendarBrowser` yerine `CalendarPanel`'e yönlendirilir; mevcut Firebase/`useAuth` consent akışı DEĞİŞMEZ.
- **Backend sözleşmesi (05-features/calendar-caldav.md ile hizalı):** grid `/api/calendar/events?from&to` (recurrence **sunucuda** genişletilir — Faz 1/4) çeker; CRUD `POST/PUT/DELETE /api/calendar/events`; ICS `POST /api/calendar/import` + `GET /api/calendar/export.ics`; reminder tetikleme O5-cron/`setInterval` scheduler (Faz 5) — UI yalnız 🔔 rozetini gösterir, tetikleme server işi.
- i18n anahtar listesi: mevcut Google `calendar.*` anahtarları KORUNUR + yeni `calendar.view.month/week/day`, `calendar.source.google/caldav/ics`, `calendar.status.synced/syncing/error/notConnected`, `calendar.event.recurrence/reminder/allDay`, `calendar.quickAdd.*`, `calendar.ics.import/export` — EN+TR çift.
- **TZID sözleşmesi:** UI `dtstart` UTC + ayrı `tzid` alanını beklediğini belgele (backend K8); all-day event `all_day=1` bayrağı + tarih-only render; drawer TZID'yi açıkça gösterir (DST kayması görünmez kalmasın).
- Read-only koruma: Google-kaynaklı event'te drawer `Düzenle/Sil` disabled + `Open in Google ↗` — provider read-only bayrağına bağlı.

---

## 8. Kabul Kriteri (bu calendar brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] **Ay / Hafta / Gün** görünüm toggle (Hafta default) — üç varyant da üretildi.
- [ ] **Event grid:** all-day şeridi + saatli sütunlar + kaynak-renkli bloklar + `now` çizgisi.
- [ ] **Event detay drawer:** başlık/saat+TZID/konum/açıklama/tekrar/reminder/kaynak + Düzenle/Sil; Google event'te read-only (disabled + "Google'da aç").
- [ ] **Hızlı-ekle formu:** tekrar-kuralı builder (freq/interval/byday/until/count) + reminder offset + hedef-takvim seçici.
- [ ] **CalDAV hesap-durumu** pill'i 3 durum (senkron / hata / bağlı-değil) ayrı gösterildi.
- [ ] **ICS import/export** butonu (import → önizleme akışı ima edilir).
- [ ] **4 panel durumu** (boş-takvim / senkronize-yükleniyor / CalDAV-hata / dolu-etkinlik drawer-açık) ayrı frame.
- [ ] **Responsive:** desktop hafta-grid + side-drawer; tablet gün-düşüşü/yatay-scroll + bottom-sheet.
- [ ] **Multi-source renk:** Google=amber / CalDAV=indigo / ICS=cyan tutarlı (grid + toggle + drawer).
- [ ] Dark + light token-driven parity (`dark:` prefix yok).
- [ ] a11y: `role="grid"`, event-block button + aria-label, drawer `aria-modal` focus-trap, view-toggle radiogroup, source-toggle checkbox, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mevcut→yeni map` + **`GoogleCalendarBrowser` KORUMA notu** + backend endpoint sözleşmesi + TZID sözleşmesi.
- [ ] **`GoogleCalendarBrowser` KIRILMADI** (silinmedi; provider-sekmesi olarak absorbe; Firebase consent akışı korundu).

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **RİSK (RRULE-UI)** | Tekrar-kuralı UI'si (freq/interval/byday/until/count → RRULE string) karmaşık; Claude Design statik-HTML'de gerçek builder mantığı üretemez, yalnız **görsel iskelet** verir. | Handoff'ta builder sıfırdan kodlanır (rrule string üretimi) | Claude Design yalnız görsel katman (dropdown + gün-chip + "Weekly · Mon, Wed · ends after 12" özet) üretir; RRULE string ↔ builder bağlama **Claude Code** işi. `RECURRENCE_BUILDER.spec.md` sözleşmesi handoff'a girer; backend `recurrence.ts` (Faz 1) genişletmeyi **sunucuda** yapar — UI yalnız kuralı gönderir. |
| **KN2** | **BAĞIMLILIK (reminder-cron-O5)** | Reminder **tetikleme** UI değil, server-scheduler işi (`05-features/calendar-caldav.md` Faz 5 — `setInterval` tick deseni, O5-cron/`webhooks/outbound.ts` retry-drain paylaşır). | UI reminder-zili gösterir ama tetikleme backend olmadan çalışmaz | UI yalnız 🔔 rozeti + offset picker (görsel) üretir; gerçek tetikleme O5 reminder scheduler'a bağlı. HANDOFF.md bu ayrımı (UI-gösterim vs server-tetikleme) açıkça yazar. |
| **KN3** | **KORUMA (GoogleCalendar korunur — KN-M6)** | `CalendarPanel` refactor'u mevcut `GoogleCalendarBrowser`'ı silerse/kırarsa Google read-only akışı + paylaşılan Firebase consent (Drive/Sheets/Gmail ile aynı token) bozulur. | Regresyon — Google agenda + belki komşu Google panelleri consent'i kaybeder | `GoogleCalendarBrowser` **DEĞİŞMEZ**; `CalendarPanel` onu "Google (read-only)" provider olarak **wrap** eder (absorbe, silme değil). `App.tsx` sadece tab yönlendirmesini değiştirir. Mevcut UI davranışı handoff-öncesi/sonrası test edilir. |
| **KN4** | **RİSK (TZ-görselleştirme)** | Zaman dilimi (TZID) + all-day vs zamanlı olay + DST kayması görselde belirsizse kullanıcı yanlış saatte etkinlik görür (backend K8: `dtstart` UTC + ayrı `tzid` + `all_day` bayrağı). | Recurrence + görüntüleme TZ hataları görsel katmanda saklanır | Drawer TZID'yi **açıkça** gösterir (`10:00–11:00 · Europe/Istanbul`); all-day için ayrı `Tüm gün` rozeti + tarih-only; grid'de saatli/all-day şeritler ayrık. `EVENT_DRAWER.spec.md` TZID render sözleşmesini içerir. |
| **KN5** | **VARSAYIM (statik-HTML etkileşim)** | Claude Design'ın hafta-grid, tıkla-drawer, tekrar-builder gibi **etkileşimli** yüzeyleri statik-HTML mock olarak makul ürettiği varsayıldı (gerçek state/keydown yok). | Etkileşim handoff'ta kodlanır | Claude Design yalnız görsel + mock-durum üretir; grid state + drawer aç/kapa + fetch bağlama Claude Code işi (KN1/KN2 paraleli). |
| **KN6** | **VARSAYIM (design-system ön-koşul)** | `01-design-system.md` mevcut/tam kabul edildi; token'lar + kaynak-renk map (`amber/indigo/cyan`) `src/styles/tokens.css`'ten sadık. | Token uyuşmazlığı → görsel drift (özellikle kaynak-renkleri) | `tokens.snippet.css` + kaynak-renk map brief'e (§3 [BRAND]) gömülür; ilk export'ta token-remap denetimi. |
| **KN7** | **KAPSAM (mobil DIŞI)** | <768px mobil detay tasarımı bu belgenin kapsamı dışı; hafta-grid mobilde en zor bozulan yüzey. | Mobil takvim UX'i eksik | Bu belge desktop+tablet; mobil `03-claude-design-ui.md` §2.8 genel kriterine + ayrı iş kalemine bırakılır (tablet gün-düşüşü deseni mobile temel verir). |
| **KN8** | **KAPSAM (harici calendar MCP)** | `c7f423f1-*` harici calendar MCP connector'ı (Google/Outlook) bu self-hosted panele **dahil değil** (ollamas'a bağlı değil, farklı consent — bkz `05-features/calendar-caldav.md` K9). | Emre "MCP zaten bağlı" beklentisiyle çakışabilir | Netleştirildi: harici connector ≠ ollamas provider. İstenirse ayrı "provider: connector-bridge" sekmesi eklenebilir; bu UI-brief kapsamı dışı. |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `CalendarPanel.tsx` (mevcut `GoogleCalendarBrowser` **wrap**) + `05-features/calendar-caldav.md` backend fazları (DB→recurrence→ICS→CalDAV→REST→reminder→UI) TDD ile. Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN5/KN3 gate).
