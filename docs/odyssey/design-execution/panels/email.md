# ODYSSEY-DESIGN Yürütme Planı — EMAIL paneli (IMAP/SMTP + triage/summary/draft)

> **Belge:** `docs/odyssey/design-execution/panels/email.md`
> **Panel:** `email` (odysseus `email_server.py` → gelen-kutusu + triage/summary/reply-draft UI) · **Durum:** YENİ panel (sıfırdan tasarım) · mevcut `GmailBrowser` = KISMİ, salt-okunur metadata (DOKUNULMAZ).
> **Rol:** Sağlayıcı-agnostik (IMAP/SMTP) e-posta triage panelinin görsel/UX katmanını Claude Design → handoff → Claude Code zinciriyle üretmek.
> **Kaynak brief:** `docs/odyssey/03-claude-design-ui.md §3.4` (UI brief) + `docs/odyssey/05-features/email-mcp.md` (backend plan: IMAP/SMTP MCP + triage) + `docs/odyssey/04-handoff-protocol.md` (çeviri protokolü) + `docs/odyssey/design-execution/panels/chat.md` (PİLOT şablon).
> **Dil:** TR (anlatı) · kod/komut/dosya-yolu/prop-adı EN.
> **Üretim tarihi:** 2026-07-10.

---

## 0. Amaç ve Kapsam

**Amaç:** ollamas'a **sağlayıcı-agnostik** (Gmail-spesifik değil) bir e-posta triage panelinin görsel/UX iskeletini tasarlamak: gelen-kutusu + klasör sidebar + triage/etiket + AI-özet + yanıt-taslağı editörü. Backend `email-mcp.md`'nin kurduğu `email_*` araçlarına (IMAP/SMTP + `email_triage`/`email_summarize`/`email_draft_reply`) bağlanacak **yeni `src/components/EmailPanel.tsx`** için brief üretmek.

**Değişmez kısıt (03 §0 + 04 §0):** Claude Design frontend-only UI-tasarım aracıdır. Yalnızca mock veriyle tasarlar; `/api/*` çağıramaz, canlı IMAP/SMTP/state/auth yoktur. Bu planın işi ölü-mock tasarımı, ileride Claude Code'un canlı `email_*` tool çağrılarına dikeceği **statik iskele + 4 durum** olarak hazırlamak.

**KRİTİK kısıt (KN-M6 / 03 K7 — privacy hard law):** Mevcut **`src/components/GmailBrowser.tsx` DOKUNULMAZ.** O, Google REST API'ye salt-okunur, **metadata-only** (From/Subject/Date — gövde ASLA çekilmez, dosya başındaki "privacy hard law" yorumu) bir Firebase-OAuth penceresidir ve `"gmail"` sekmesinde (`src/App.tsx:336`) kalır. Bu yeni `email` paneli **ayrı bir bileşendir**, ayrı bir sekmedir, ayrı bir kanaldır (IMAP/SMTP). GmailBrowser'ın privacy-law'ını **hiçbir şekilde ihlal etmez, onu değiştirmez, onun scope'unu genişletmez.** İki yüzey yan yana yaşar: `gmail` (metadata-only Google penceresi) + `email` (sağlayıcı-agnostik IMAP/SMTP triage).

**Kapsam-DIŞI (bu panel değil):** Backend eksenleri (IMAP istemci, SMTP gönderim, MIME parse, triage/summary AI çağrıları, encrypted vault, SSRF host-guard, choke-point kaydı) `05-features/email-mcp.md`'de yaşar — O-backend işi. Bu belge yalnızca **görsel katman**. AI-özet ve triage-etiketleri tasarımda **mock**'tur (gerçek `email_summarize`/`email_triage` çıktısı backend gelince bağlanır). HTML-gövde sanitize + ek güvenliği (email-mcp.md R6) implementasyon notudur, tasarım kapsamında değil.

---

## 1. Mevcut Durum — koda karşı DOĞRULANMIŞ envanter

> Kaynak: `Read`/`Grep` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10). Bu tablo **korunacak sözleşme + tasarımın referans aldığı iskelet**tir.

### 1.1 Mevcut `GmailBrowser` (referans iskelet — ama AYRI kalır, DOKUNULMAZ)

| Öğe | Dosya:Satır | Anlamı / kısıt |
|---|---|---|
| **Bileşen** — `GmailBrowser()` (175 satır) | `src/components/GmailBrowser.tsx:19` | Google REST API penceresi (`gmail.googleapis.com/gmail/v1/...`), **frontend-only**, server'a dokunmaz. |
| **Privacy hard law** — `format=metadata&metadataHeaders=From/Subject/Date` | `GmailBrowser.tsx:51`, dosya başı yorumu `:5-8` | Gövde **ASLA** çekilmez. Yeni panel bu law'ı ihlal edemez → **ayrı IMAP kanalı, gövde IMAP'ten gelir, Gmail yüzeyinden DEĞİL.** |
| **Auth** — `useAuth()` Firebase Google token | `GmailBrowser.tsx:20`, `src/lib/firebase.ts:50` `gmail.readonly` scope | Metadata-only OAuth. Yeni panel bunu **kullanmaz** (IMAP/SMTP kimlik = encrypted vault, `email-mcp.md §3`). |
| **Sekme** — `<GmailBrowser/>` `"gmail"` tab | `src/App.tsx:15,119,336`, i18n `app.tab.gmail` | Bu sekme **aynen kalır.** Yeni panel = **yeni `email` sekmesi** (ayrı `app.tab.email`). |
| **UI iskelet (referans)** — `Mail` ikon header + Refresh + hata kartı + 4 render-guard (`isConfigured===false` / `needsAuth` / error / empty / list) | `GmailBrowser.tsx:83-173` | **Görsel iskelet referansı** (durum-guard deseni, token utility kullanımı `bg-immersive-*`, `text-status-*`) — kopyalanır **ama** yeni panel kendi state'ini kurar, GmailBrowser'ı import/extend etmez. |

> **Kritik ayrım:** `GmailBrowser` bir **read-only metadata penceresi**dir; IMAP/SMTP istemcisi, triage, özet, taslak, gönderim yeteneği **yoktur** (bkz `email-mcp.md §1.1`). Yeni `email` paneli bunların **tümünü** (mock'la) tasarlar. İki bileşen **hiç kesişmez.**

### 1.2 Backend'de NE VAR / NE YOK (email-mcp.md §1'den doğrulanmış)

- **YOK (backend kurulacak — `email-mcp.md`):** IMAP istemci, SMTP gönderim, `mailparser`, `email_search/get/list_folders/triage/summarize/draft_reply/send` araçları, MCP catalog email entry'si. → Bu panel tasarlanırken backend **henüz yok**; tasarım **mock**'la ilerler, tool sözleşmesi `email-mcp.md §2` tablosundan alınır.
- **VAR (yeniden kullanılacak altyapı):** `ToolRegistry` choke-point (`server/tool-registry.ts`), encrypted vault (`db.encrypt/decrypt`), yerel AI (`server/ai.ts` `generateText`, varsayılan `qwen3:8b` $0), tier modeli (`safe`/`privileged`). → Bunlar backend işi; UI yalnızca çıktı sözleşmesine bağlanır.

### 1.3 Tool sözleşmesi (tasarımın mock'ladığı çıktılar — `email-mcp.md §2`)

| Tool | Tier | UI'da karşılığı (mock çıktı) |
|---|---|---|
| `email_list_folders` | safe | Sol sidebar: Inbox/Sent/Drafts/Archive + unread sayacı |
| `email_search` | safe | Orta: mesaj listesi (from, subject, date, unread, triage çip) |
| `email_get` | safe | Sağ: okuma panosu (header + gövde text/html + ekler) |
| `email_triage` | safe ($0 qwen3:8b) | Mesaj satırındaki **triage çipi** (`action`/`waiting`/`archive`, priority) |
| `email_summarize` | safe ($0 qwen3:8b) | Okuma panosunda **AI-özet** bloğu (thread özeti) |
| `email_draft_reply` | safe (GÖNDERMEZ) | Yanıt-taslağı editörü (AI öneri metni; SMTP çağrısı = 0) |
| `email_send` | **privileged** (RBAC) | Compose/reply "Gönder" butonu (onay + audit) |

---

## 2. Claude Design PROMPT — TAM taslak (canvas'a yapıştırılacak)

> **Kullanım:** Bu blok `claude.ai/design` chat-prompt'una **verbatim** yapıştırılır. Şablon: `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`. Ön-koşul: **design-system-first** (`01-design-system.md`) — token alt-kümesi (§2.6) prompt'a gömülür (Claude Design ham hex üretir, token değişkeni değil → HANDOFF'ta remap).

### 2.1 [GOAL]
> Dark developer-cockpit için **sağlayıcı-agnostik e-posta triage paneli** tasarla. Bu, IMAP ile gelen kutusunu çeken, AI ile önceliklendirip (triage) özetleyen ve SMTP ile yanıt taslağı gönderen bir çalışma alanı. Panel **odysseus-kalitesinde** olmalı: klasör sidebar + triage-etiketli mesaj listesi + AI-özetli okuma panosu + yanıt-taslağı editörü. Gmail-spesifik DEĞİL, sağlayıcı-agnostik (herhangi IMAP/SMTP hesabı). Amaç görsel/UX; state mantığı mevcut değil (mock veriyle tasarla).

### 2.2 [LAYOUT]
> **Üç-bölge + üst bar** (klasik e-posta üçlü panosu, ama boğmayan — 03 §2/1):
> - **Üst kontrol barı** (tam genişlik): arama kutusu (sol), aktif hesap rozeti (ortada, örn. `imap.fastmail.com · user@…`), sağda **"Compose"** birincil butonu + **"Sync"** (yenile) butonu.
> - **Sol dar sütun** (~%20): **klasör listesi** — Inbox (unread sayacı rozeti), Sent, Drafts, Archive; üstte triage-filtre çipleri (`All` / `Action` / `Waiting` / `Archive`). Aktif klasör vurgulu. Boş durumda "Not connected" CTA.
> - **Orta sütun** (~%38): **mesaj listesi** — her satır: unread noktası (indigo), gönderen (from), konu (subject, kalın if unread), tarih (sağ, mono), **triage etiket çipi** (renk-kodlu: action=amber, waiting=info, archive=muted). Seçili mesaj vurgulu. Üstte küçük sayaç ("12 messages · 3 unread").
> - **Sağ geniş sütun** (~%42): **okuma panosu** — header bloğu (from/to/subject/date), altında **AI-özet kartı** (accent kenarlı, `✨ Summary` başlığı, 2-3 satır mock özet), altında gövde (text/html render alanı), en altta **ek listesi** (dosya adı + boyut çipleri). Header'da hızlı eylemler: **Reply** · **Archive** · **Label** (dropdown). Reply'e basınca alt kısımda **yanıt-taslağı editörü** açılır.
> - **Yanıt-taslağı editörü** (okuma panosu altında, koşullu): to/subject (dolu, düzenlenebilir) + gövde textarea (AI-önerilen taslak metni önceden doldurulmuş, `email_draft_reply` mock) + **"Generate draft"** (AI yeniden-öner) + **"Send"** (birincil, SMTP-privileged) + **"Save draft"** (ikincil).
> - **Compose modalı** (ayrı overlay): to / cc (katlanır) / subject / body + Send / Save draft / Cancel.
> Responsive: `xl` altında okuma panosu alta iner (liste üstte, pano altta); `lg` altında sol klasör sütunu üstte **dropdown**'a dönüşür (mesaj listesi tam genişlik).

### 2.3 [CONTENT] — mesaj listesi + triage çipleri (mock veriyle)
> Mesaj listesinde **5 mesajlık mock** gelen kutusu, en az **2 triage etiketi** görünür (03 §3.4 mock kuralı):
> 1. **unread + action** — from `ci@github.com`, subject `"Build failed on main — 3 checks"`, `2m ago`, çip **`Action`** (amber), unread indigo nokta. **Seçili** (okuma panosu bunu gösterir).
> 2. **unread + waiting** — from `alice@acme.io`, subject `"Re: contract draft — awaiting your sign-off"`, `1h ago`, çip **`Waiting`** (info).
> 3. **read** — from `noreply@stripe.com`, subject `"Your payout of $420 is on the way"`, `4h ago`, çip yok (nötr).
> 4. **read + archive** — from `newsletter@hn.io`, subject `"Weekly digest — top 10 posts"`, `1d ago`, çip **`Archive`** (muted, soluk).
> 5. **unread** — from `security@ollamas.dev`, subject `"New sign-in from unrecognized device"`, `2d ago`, unread nokta, çip yok.
> **Triage çip anatomisi:** küçük yuvarlak-köşe rozet, mono UPPERCASE, renk = kategori (action/amber · waiting/info · archive/muted); priority yüksekse ince sol-accent. Çip **tıklanabilir** (o kategoriye filtreler — sol filtre çipleriyle senkron).

### 2.4 [CONTENT] — okuma panosu + AI-özet + yanıt-taslağı (mock)
> Seçili mesaj (#1, GitHub build-failed) için okuma panosu:
> - **Header:** From `ci@github.com` · To `you@ollamas.dev` · `2m ago` · subject `"Build failed on main — 3 checks"`.
> - **AI-özet kartı** (accent-indigo kenarlı, `✨ Summary` mono başlık): mock `"CI run #4821 failed on main. 3 checks red: lint, typecheck, e2e. Root cause likely the auth middleware refactor in the last commit. Suggested: re-run after fixing the type error in src/auth.ts."` + küçük `$0 · qwen3:8b` rozeti (yerel-model, 0-token vurgusu).
> - **Gövde:** kısa text/html mock (birkaç satır + bir link satırı).
> - **Ekler:** 2 çip — `build-log.txt · 14 KB`, `coverage.html · 88 KB` (dosya ikonu + boyut; otomatik açılmaz notu).
> - **Yanıt-taslağı editörü** (Reply'e basılınca): to `ci@github.com` (dolu), subject `"Re: Build failed on main — 3 checks"`, body textarea AI-taslakla dolu (`"Thanks — I've identified the type error in the auth middleware and pushed a fix. Re-running the checks now."`) + `Generate draft` / `Send` (birincil) / `Save draft`.

### 2.5 [CONTENT] — üst bar + compose + hesap durumu (mock)
> - **Arama:** placeholder `"Search mail…"`; içinde bir mock sorgu (`from:alice`) opsiyonel.
> - **Hesap rozeti:** `imap.fastmail.com · you@ollamas.dev` (sağlayıcı-agnostik vurgusu — Gmail değil); yanında yeşil "connected" noktası.
> - **Compose modalı:** overlay kart — to / cc (katlanır) / subject / body textarea + `Send` (birincil, SMTP) / `Save draft` / `Cancel`. Küçük not: "Sent via SMTP · privileged action".

### 2.6 [BRAND] — ollamas token alt-kümesi (prompt'a göm; kaynak `src/styles/tokens.css`)
> ```
> Renkler (dark cockpit):
>   bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
>   border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim (soluk)
>   accent-indigo #6366f1 · ok #34d399 · warn/amber #fbbf24 · err #fb7185 · info #22d3ee
> Triage çip renkleri: action → amber(#fbbf24) · waiting → info(#22d3ee) · archive → muted(#94a3b8 soluk).
> Font: sans = Inter; mono = JetBrains Mono (from-adresi, tarih, boyut, triage çipi, tool/model rozeti mono).
> Radius: sm 3px · md 8px · lg 12px. Space: 4/8/12/16px.
> Başlık stili: font-mono, UPPERCASE, tracking-wider. Metin ölçeği: 9-12px mono / 12-14px gövde.
> Hareket: fade-in 0.25s; prefers-reduced-motion saygılı (sync spinner durur).
> ```
> Not: `dark:` prefix KULLANMA — dark/light paritesi token katmanından. Light varyant için ayrıca bir ekran daha üret (aynı layout, açık tema).

### 2.7 [CONTEXT] — 4-STATE + responsive (aşağıda §3 detaylı)
> Dört durumu da ayrı ekran/frame olarak tasarla: (1) **bağlı-değil / boş-kutu** (IMAP setup CTA), (2) **senkronize-yükleniyor** (skeleton + sync spinner), (3) **IMAP-hata** (bağlantı/kimlik hatası + retry), (4) **dolu-liste** (5 mesaj + seçili okuma panosu + AI-özet). Ek: dark + light varyant; mobil (dar viewport) düzeni.

---

## 3. 4-STATE Mock Tanımları (her durum ayrı canvas frame)

> odysseus UI kalite kriteri (03 §2/2): **dört durumun da** tasarlanması — "honest empty state" zorunlu. Her frame ayrı export edilir; screenshot'ları handoff bundle'ına girer.

| # | Durum | Mock içerik | Görsel odak |
|---|---|---|---|
| **S1** | **Bağlı-değil / boş-kutu** (setup CTA) | Klasör sidebar soluk/kilitli; orta+sağ boş; merkezde `Mail` ikon + `"No email account connected"` + kısa açıklama (`"Add IMAP/SMTP credentials to enable triage, summary and drafts."`) + **"Connect account"** birincil buton (setup wizard'a götürür). Not: "Your Gmail metadata view stays separate under the Gmail tab." (GmailBrowser ayrımını netleştir.) | Honest-empty: davet edici setup CTA; iki-yüzey ayrımı açık. |
| **S2** | **Senkronize-yükleniyor** | Klasör sidebar dolu (Inbox 3); mesaj listesi **skeleton satırlar** (3-4 gri placeholder, shimmer); üst barda `Sync` butonu spinner'lı + `"Syncing inbox…"` metni; sağ pano boş/skeleton. | Canlı feedback: skeleton + spinner + aria-live "syncing". |
| **S3** | **IMAP-hata** | Klasör sidebar var ama üstte kırmızı bant: `"IMAP connection failed: authentication rejected (535)"` + `"Retry"` butonu + küçük `"Check credentials in Settings"` linki. Mesaj listesi boş/soluk. | Kurtarılabilir hata: net mesaj (kod dahil) + tek-tık retry + ayarlar yolu. Parola ASLA gösterilmez. |
| **S4** | **Dolu-liste** (ana ekran) | 5 mesajlı inbox (§2.3, 2 triage çipi) + seçili #1 için okuma panosu: header + **AI-özet kartı** (`✨ + $0 qwen3:8b` rozeti) + gövde + 2 ek çipi + açık **yanıt-taslağı editörü** (AI-dolu). Sol filtre çipleri (`All` aktif). Üst sayaç `12 messages · 3 unread`. | Tam senaryo: triage çip, AI-özet, taslak editör, ek çipleri, üç-pano düzeni. |

**Ek varyantlar:** her state'in **dark + light** hali; ayrıca **S4'ün mobil** (dar) düzeni (klasör sidebar → üstte dropdown, okuma panosu liste seçilince tam-ekran alta iner) + **Compose modalı** ayrı frame.

**Mock veri notu (minimum, brief §3.4'ten):** 5-mesajlı inbox + ≥2 triage etiketi. S4 bu minimumu karşılar; S1/S2/S3 alt-küme sahneler.

---

## 4. İterasyon Adımları (Claude Design canvas'ta, 3-5 döngü)

> Mekanik: chat-prompt (ilk üretim) + inline-comment (nokta düzeltme) + slider (yoğunluk/varyant). Her döngü bir hedefe kilitlenir.

1. **Döngü 1 — İskelet & layout.** İlk prompt (§2) yapıştır → üç-bölge + üst bar iskeleti üret. Kontrol: sol klasör sütunu, orta mesaj listesi, sağ okuma panosu, üst compose/sync yerinde mi? Inline-comment ile bölge oranlarını (%20/%38/%42) düzelt.
2. **Döngü 2 — Mesaj listesi & triage çipleri.** 5 mesaj satırını + triage çiplerini (action/waiting/archive renk-kodlu) üret. Inline-comment: "triage çipi mono UPPERCASE rozet olmalı, kategori rengiyle; unread satırı kalın + indigo nokta". Sol filtre çipleri ile senkron.
3. **Döngü 3 — Okuma panosu & AI-özet.** Seçili mesaj için header + **AI-özet kartı** (accent kenar, `✨ Summary`, `$0 qwen3:8b` rozeti) + gövde + ek çipleri. Inline-comment: "AI-özet kartı gövdeden görsel ayrı — accent-indigo sol kenar, mock olduğu belli ama gerçekçi".
4. **Döngü 4 — 4-state + yanıt-taslağı + compose.** S1 (setup CTA — GmailBrowser ayrım notu dahil), S2 (skeleton+spinner), S3 (IMAP-hata+retry) frame'leri. Yanıt-taslağı editörünü (AI-dolu, Send/Save) okuma panosu altına yerleştir. Compose modalını ayrı frame üret. Honest-empty (S1) tonu.
5. **Döngü 5 — Tema paritesi & responsive & cila.** Light varyant frame'i. Mobil (dar) düzeni: klasör dropdown + okuma panosu tam-ekran. Erişilebilirlik (focus-visible, kontrast AA, liste `role="list"`), hareket (fade-in/shimmer). Son inline-comment turu.

> **Yoğunluk (slider) notu:** "orta-yoğun cockpit" — bilgi-yoğun ama boğmayan. Fazla dekorasyon (gradient, gölge şişkinliği) YASAK; ollamas estetiği düz-yüzey + ince kenar + mono. Triage çipleri tek görsel-vurgu odağı olsun.

---

## 5. Handoff Bundle İçeriği (export → `docs/odyssey/handoff/email/`)

> Claude Design "Export" + "Handoff to Claude Code" bundle'ı buraya iner. 03 §3.4 + 04 §Adım-1'e göre **zorunlu dosyalar + panel-özel spec**:

```
docs/odyssey/handoff/email/
  PROMPT.md              # §2'deki TAM Claude Design prompt'u (token'lar + mock + 4-state) — arşiv
  design.html            # Claude Design export (self-contained, inline CSS) — S4 (dolu) ana ekran
  screenshot.png         # canvas görüntüsü (dark, S4)
  screenshot-light.png   # light varyant (S4)
  screenshot-s1.png      # bağlı-değil / setup CTA (4-state kanıtı)
  screenshot-s2.png      # senkronize-yükleniyor
  screenshot-s3.png      # IMAP-hata / retry
  screenshot-compose.png # compose modalı
  HANDOFF.md             # component adı, prop imzası, i18n anahtar listesi, tool sözleşmesi (mock→real map), 4-durum listesi
  tokens.snippet.css     # brief'e gömülen ollamas token alt-kümesi (kaynak: src/styles/tokens.css)
  TRIAGE_CHIP.spec.md    # triage çip prop imzası (category, priority, label, onClick)
  COMPOSE_MODAL.spec.md  # compose/reply editör prop imzası (to, cc, subject, body, onSend, onSaveDraft, onGenerateDraft)
```

**HANDOFF.md'nin içermesi zorunlu (04 §Adım-1/3):**
- **Component adı:** **`EmailPanel`** (YENİ dosya `src/components/EmailPanel.tsx` — GmailBrowser'ı **genişletmez/import etmez**) + opsiyonel alt-component `TriageChip.tsx`, `MessageRow.tsx`, `ReadingPane.tsx`, `ComposeModal.tsx`, `ReplyDraftEditor.tsx`.
- **Prop imzası:** öneri `{ onNotify(msg, type) }` (App toast deseni, ReactAgentTab ile tutarlı) — HANDOFF'ta netleştirilir; alt-component prop'ları `TRIAGE_CHIP.spec.md` + `COMPOSE_MODAL.spec.md`'de.
- **i18n anahtar listesi:** yeni `email.*` namespace (`app.tab.email`, `email.folder.inbox/sent/drafts/archive`, `email.triage.action/waiting/archive`, `email.summary.title`, `email.compose.*`, `email.reply.*`, `email.state.notConnected/syncing/imapError/empty`, `email.action.reply/archive/label/send/saveDraft/generateDraft`) → **EN + TR** senkron (03 §3.4/4). GmailBrowser'ın `app.tab.gmail` anahtarı **korunur, karışmaz**.
- **Tool sözleşmesi (mock→real map):** tasarımın mock çıktısı → gerçek `email_*` tool çağrıları (§1.3 tablosu): `email_list_folders`→sidebar, `email_search`→liste, `email_get`→okuma panosu, `email_triage`→çip, `email_summarize`→AI-özet kartı, `email_draft_reply`→taslak editör (GÖNDERMEZ), `email_send`→Send butonu (**privileged/RBAC + audit**). Araçlar `email-mcp.md`'de kurulur; UI çağırma yolu (choke-point/`/mcp`) implementasyonda netleşir.
- **4-durum listesi:** S1-S4 (§3) → gelecek state'lere map (config-yok/`EMAIL_MCP_ENABLED=0` → S1; sync in-flight → S2; IMAP hata → S3; dolu → S4).
- **Privacy-law notu:** HANDOFF.md başında **KN-M6 uyarısı**: "EmailPanel, GmailBrowser'dan **bağımsızdır**; onu import/extend etmez, Gmail `gmail.readonly` scope'unu kullanmaz. IMAP gövdesi ayrı kanaldan gelir. GmailBrowser metadata-only kalır."

---

## 6. Claude Code İmplementasyon Hedefi (handoff sonrası)

> Bu bölüm handoff bundle geldikten SONRA çalışır (04 §2 8-adım protokolü). Backend (`email-mcp.md`) araçları **kurulmuş olmalı** ya da UI mock-adapter ile ilerler.

- **Yeni dosya:** `src/components/EmailPanel.tsx` (+ opsiyonel alt-component'ler). **`GmailBrowser.tsx`'e DOKUNULMAZ** (KN-M6). Yeni `email` sekmesi `src/App.tsx` `tabs[]`'e eklenir (`gmail` sekmesi korunur, iki ayrı buton).
- **Token remap (04 §Adım-3, en kritik):** bundle ham hex → `bg-immersive-*` / `text-status-*` utility. `dark:` prefix YASAK. Triage çip renkleri → mevcut `status-warn`/`status-info`/`text-immersive-text-muted`.
- **State + veri:** mesaj listesi/klasör/okuma panosu state EmailPanel içinde; veri `email_*` tool çağrılarından (choke-point). Backend yoksa **mock-adapter** ile S1-S4 render edilir (tool sözleşmesi §1.3'e sadık).

**TDD adımları (03 §3.4'ten, test-önce):**
1. **RED (UI):** `EmailPanel.test.tsx` — (a) bağlı-değil state setup-CTA render eder (S1), (b) triage çip filtresi mesaj listesini süzer, (c) compose/reply validation (boş `to` → Send disabled), (d) IMAP-hata state retry butonu görünür (S3), (e) AI-özet kartı `email_summarize` mock çıktısını gösterir.
2. **RED (backend — `email-mcp.md`'de):** `email.test.ts` — IMAP fetch mock, SMTP send mock, kimlik encrypted vault'tan, gövde sanitize. (Bu O-backend işi, çapraz-referans.)
3. **GREEN:** UI'yi handoff'a göre kur; a11y (`role="list"` mesaj listesi, `aria-live` sync/hata). `.env` `EMAIL_MCP_ENABLED` toggle backend'de (`email-mcp.md §3`).
4. **i18n:** `email.*` EN+TR senkron; `app.tab.gmail` **karışmaz**.
5. **Kapı:** `tsc --noEmit` ✓ + `vitest run` fresh ✓ → commit (`feat(email): odysseus-quality IMAP/SMTP triage panel (EmailPanel)`).

**Parity kabul (03 §3.4):** IMAP liste + SMTP compose + triage etiketleri + preview(okuma panosu) + AI-özet + yanıt-taslağı + setup-CTA + 4 durum + credential-vault entegrasyonu + dark/light. UI görsel/mock ile karşılanır; gerçek IMAP/SMTP/triage `email-mcp.md` backend'ine bağlıdır (çapraz-referans, kapsam-dışı).

---

## 7. Kabul Kriteri (bu yürütme planı için)

Bu belge **DONE** sayılır ancak:

- [x] Mevcut durum **koda karşı doğrulandı** — `GmailBrowser` metadata-only (dosya:satır), self-hosted email YOK, EmailPanel **ayrı** (KN-M6). **(§1)**
- [x] Claude Design **TAM prompt taslağı** ([GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]) — klasör sidebar + triage-etiketli mesaj listesi + AI-özetli okuma panosu + yanıt-taslağı editörü + compose. **(§2)**
- [x] **4-STATE mock** tanımlı (bağlı-değil/setup · senkronize-yükleniyor · IMAP-hata · dolu-liste) + dark/light + mobil + compose varyant. **(§3)**
- [x] **İterasyon adımları** (3-5 döngü) canvas mekaniğiyle. **(§4)**
- [x] **Handoff-bundle içeriği** listelendi (zorunlu dosyalar + `TRIAGE_CHIP.spec.md` + `COMPOSE_MODAL.spec.md` + privacy-law notu). **(§5)**
- [x] **Claude Code hedefi + TDD** (yeni `EmailPanel.tsx`, GmailBrowser dokunulmaz, tool sözleşmesi map). **(§6)**
- [x] **Kör-Nokta Ledger** ≥ 5 kayıt. **(§8)**

**Parity nihai testi (implementasyon sonrası, gelecekte):** panel S1-S4'ü render eder, dark/light çalışır, triage çipleri + AI-özet + yanıt-taslağı görünür, compose/reply çalışır, `email_*` tool'lara gerçek bağlı, **GmailBrowser bozulmadan yan yana** → email paneli = odysseus-kalitesinde, privacy-law korunur.

---

## 8. Kör-Nokta Ledger (email-spesifik)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **M1** | **KISIT (KN-M6 / 03 K7)** | **GmailBrowser DOKUNULMAZ** — metadata-only "privacy hard law" (`GmailBrowser.tsx:5-8,51`). EmailPanel bunu import/extend edemez, `gmail.readonly` scope'unu kullanamaz, gövdeyi Gmail yüzeyinden çekemez. | Privacy regresyonu / iki yüzey karışması | EmailPanel **ayrı dosya + ayrı sekme + ayrı kanal (IMAP)**; HANDOFF.md başına açık uyarı (§5); S1 mock'ta iki-yüzey ayrımı metni. |
| **M2** | **RİSK (IMAP-parola-güvenlik)** | IMAP/SMTP **parola** hassas (OAuth değil, `email-mcp.md R2`). UI'da **asla** düz gösterilmemeli; S3 hata mesajı parola sızdırmamalı; setup CTA parolayı vault'a (`db.encrypt`) yönlendirir, UI'da tutmaz. | Kimlik-bilgisi sızıntısı | Tasarımda parola alanı yok/masked; S3 hata = kod+aksiyon, parola değil; kimlik yönetimi Settings/vault'a delege. |
| **M3** | **VARSAYIM (AI-özet-mock)** | `email_summarize`/`email_triage` çıktısı tasarımda **mock** (Claude Design canlı AI yapamaz). Gerçek çıktı `qwen3:8b` ($0) backend'e bağlı (`email-mcp.md §5`). | Tasarım "AI-özet" gösterir ama implement'te backend gelene kadar mock kalır | AI-özet kartına `$0 · qwen3:8b` rozeti = niyet göstergesi; HANDOFF mock→real map'te "summary/triage `email_summarize`/`email_triage` bekliyor" notu. |
| **M4** | **KARAR (sağlayıcı-agnostik)** | Panel **sağlayıcı-agnostik IMAP/SMTP** (Gmail-spesifik label semantiği DEĞİL — `email-mcp.md D1`). Hesap rozeti `imap.fastmail.com` gibi generic olmalı, "Gmail" değil. | Tasarım Gmail-vari çıkarsa yanlış sinyal | §2.5 hesap rozeti generic IMAP host; triage etiketleri kendi (`action/waiting/archive`), Gmail-label değil. |
| **M5** | **RİSK (email_send = privileged)** | `email_send` tier **privileged** (RBAC + audit, `email-mcp.md §3/3`). UI'da Send butonu bunu yansıtmalı (onay/uyarı), tek-tık kaza-gönderim olmamalı. | Yetkisiz/kaza gönderim | Compose "Sent via SMTP · privileged" notu; Send öncesi onay deseni; audit `db.logSecurity` (backend). |
| **M6** | **VARSAYIM (bundle şeması — PİLOT'a bağlı)** | Claude Design "Handoff to Claude Code" gerçek export formatı `chat.md` PİLOT'unda ampirik doğrulanacak (03 K1). Bu §5 şablonu PİLOT sonucunu devralır. | §5 bundle şablonu sapabilir | `chat.md §7` PİLOT kalibrasyonu bittikten SONRA bu §5'i güncelle (email export'u kalibre şablonu kullanır). |
| **M7** | **BİLİNMEYEN (HTML-gövde/ek güvenliği)** | Gerçek IMAP gövdesi HTML olabilir (XSS/tracker); ekler zararlı (`email-mcp.md R6`). Tasarım kapsamı-dışı ama UI render sanitize + ek otomatik-açılmaz gerektirir. | Implement'te XSS/tracker riski | Tasarım notu: gövde render sanitize (implement), ek çipleri **otomatik açmaz** (§2.4 mock'ta not); güvenlik backend+render katmanı işi. |
</content>
</invoke>
