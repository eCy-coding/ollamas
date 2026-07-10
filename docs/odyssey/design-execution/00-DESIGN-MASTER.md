# ODYSSEY-DESIGN 00 — Claude Design Tasarım-Fazı ÜST-PLAN (Master)

> **Belge:** `docs/odyssey/design-execution/00-DESIGN-MASTER.md`
> **Rol:** `design-execution/` altındaki TÜM yürütme dosyalarının tek üst-plana sentezi. Bu dosya kaynak dosyaları **yeniden yazmaz** — birleştirir, sıralar, kör-noktaları program-düzeyinde toplar. Her panel/design-system/handoff kendi `.md`'sinde tam kalır; burası **navigasyon + kapı + convergence** katmanıdır.
> **Emre emri:** "claude-design'i hazırla + orada kodlama-öncesi uçtan uca planla + planlar bitince Claude Design işleme başlasın."
> **Kaynak (9 panel + design-system + handoff, koda karşı DOĞRULANMIŞ 2026-07-10):** `01-design-system.md`, `HANDOFF-PIPELINE.md`, `panels/00-shell-nav.md`, `panels/chat.md` (PİLOT), `panels/research.md`, `panels/documents.md`, `panels/email.md`, `panels/notes-tasks.md`, `panels/calendar.md`, `panels/cookbook.md`, `panels/settings-2fa.md`.
> **Dil:** TR (anlatı) · kod/token/yol/prop-adı EN.
> **Üretim tarihi:** 2026-07-10.

---

## 1. TL;DR — Claude Design tasarım-fazı nedir

Claude Design (`claude.ai/design`), **inline-CSS üreten frontend-tasarım canvası**dır: **backend/DB/host ÜRETMEZ**, `/api/*` çağıramaz, canlı SSE/state/auth yoktur. Ürettiği her şey **statik-HTML mock**tur. Bu tasarım-fazının işi ollamas'ı odysseus-kalitesine taşıyacak **UI-prototiplerini** üretmek; canlı sistem kodu **sonraki faz** (Claude Code implementasyonu).

**Kapsam = 1 design-system kurulumu + 9 panel + 1 handoff hattı:**

| # | Yürütme dosyası | Panel/iş | Durum (kod bugün) |
|---|---|---|---|
| — | `01-design-system.md` | Token/tema **ön-koşul kurulumu** (kod değil, canvas oturum-kurulumu) | 15 dark + 15 light token koda karşı çıkarıldı |
| 0 | `panels/00-shell-nav.md` | App-shell + gruplu sidebar + ⌘K palet | VAR (21-tab düz liste, taşma riski) → refactor |
| 1 | `panels/chat.md` **(PİLOT)** | ReAct agent chat | VAR — GENİŞLET `ReactAgentTab` |
| 2 | `panels/documents.md` | Writing-first editör + PDF/office önizleme | KISMİ — ham `<textarea>` + upload var |
| 3 | `panels/calendar.md` | CalDAV/ICS takvim (grid+RRULE+reminder) | KISMİ — Google read-only agenda var |
| 4 | `panels/cookbook.md` | Donanım-farkında model öneri | KISMİ — motor CLI'de, UI size-fit only |
| 5 | `panels/research.md` | deep_research + SearXNG | YOK — sıfırdan |
| 6 | `panels/notes-tasks.md` | Notes/memory + cron todo + agent-assign | YOK — sıfırdan |
| 7 | `panels/email.md` | IMAP/SMTP triage/summary/draft | YOK — sıfırdan (GmailBrowser DOKUNULMAZ) |
| 8 | `panels/settings-2fa.md` | 2FA/TOTP + RBAC + tool-policy | KISMİ — SecurityPolicies var, 2FA/role YOK |
| — | `HANDOFF-PIPELINE.md` | Design-export → bundle → Claude Code (7-aşama) | Boru hattı, PİLOT'ta kalibre olur |

**Her panelin ortak çıktı sözleşmesi:** `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state+responsive]` prompt → 4-durum (boş/yükleniyor/hata/dolu) × dark+light × desktop+tablet → `Export` + `Handoff to Claude Code` bundle → `docs/odyssey/handoff/<panel>/`.

**Değişmez sıra (Emre kuralı):** TÜM tasarım (9 panel + cross-audit) GREEN olmadan Claude Code implementasyonu BAŞLAMAZ (§7 Sıra Kapısı).

---

## 2. Hazırlık Checklist — Claude Design'da başlamadan önce

> Bu adımlar ilk panel prompt'undan ÖNCE bir kez yapılır. Kaynak: `01-design-system.md §2`, `HANDOFF-PIPELINE.md §2 Aşama-1`.

- [ ] **(a) Design-system kurulumu** — `01-design-system.md`'nin **YOL A (GitHub-inherit)** veya **YOL B (manuel-token-prompt)** yollarından biri Claude Design oturumunun **ilk mesajı** olarak uygulandı.
  - **YOL A (öncelikli):** `+` → "Add reference" → GitHub repo linki (`https://github.com/adobemre1/ollamas`) → extract → **doğrula** (accent-indigo `#6366f1`? bg-panel `#0a0b10`? Inter?). Eşleşmezse YOL B override.
  - **YOL B (fallback):** `01-design-system.md §3.1` manuel setup prompt'u (15 dark + 15 light token + font/radius/space/motion/a11y) kopyala-yapıştır.
  - **GATE (T0):** GitHub-inherit için repo **public mi** ya da Claude connector erişebiliyor mu? (§6 T0-1). Token dosyaları (`tokens/*.json`, `tokens*.css`, `index.css`) remote'ta güncel + `git status` temiz.
- [ ] **(b) Referans-screenshot toplama** — odysseus-parity görselleri (varsa) + mevcut ollamas panel screenshot'ları toplandı (drift ölçümü + "odysseus-altı kaldığı yerler" için, ör. `chat.md §1.4`).
- [ ] **(c) Org design-system publish** — design-system oturum-boyu kalıcı kaydedildi ("Confirm this system is saved"). **UYARI (K4):** her yeni chat sıfırlayabilir → **tüm 9 paneli tek oturumda üret**; oturum koparsa setup'ı yeniden gönder + her panel prompt'una tutarlılık-guard tek-satırı ekle.
- [ ] **(d) Chrome hazır** — `claude.ai/design` açık + login; büyük-repo için `/design-sync` mekaniği hazır (paste >10MB YASAK — `HANDOFF-PIPELINE.md §0`).

**Tutarlılık-guard (her panel prompt'unun başına):** *"Match the ollamas design system set up earlier (dark #0a0b10 panel / #6366f1 indigo accent, Inter + JetBrains Mono, `[data-theme]` light variant, no `dark:` prefixes)."* + 5 guard kuralı (`01-design-system.md §4`): her panelde dark+light, 4-durum zorunlu, yeni-renk-yasak (`status-*`'tan türet), `font-mono` sadece kod/id/metrik, handoff'ta accent-doğrula.

---

## 3. Panel Sırası + Bağımlılık

> Bağımlılık zinciri (`HANDOFF-PIPELINE.md §4` + `01-design-system.md §0` + `00-shell-nav.md`). Her satır önceki kapıdan geçmeden başlamaz. Her panelin **kendi `.md`'si** tam brief kaynağıdır — buradaki tek satır özettir.

```
[01 design-system: token kur] ──ÖN-KOŞUL──┐
                                           ▼
[00 shell-nav] ─→ [chat PİLOT: şablon kalibre] ─→ kalan 7 panel ─→ [cross-panel audit]
```

| Sıra | Panel | Tek-satır tasarım hedefi | Bağımlılık nedeni | Kaynak `.md` |
|---|---|---|---|---|
| **0** | **design-system** | 30 token (15 dark + 15 light) + font/radius/space canvas'a kur | TÜM panellerin drift-guard'ı — ÖN-KOŞUL | `01-design-system.md` |
| **1** | **shell-nav** | Gruplu sidebar (AI Workspace/Ops/Settings) + ⌘K palet + 4-state shell | Panel mount hedefi; **tab-taşma burada çözülür** (28+ tab → ⌘K) | `panels/00-shell-nav.md` |
| **2** | **chat (PİLOT)** | ReAct akış: mesaj/tool-call kartı/reasoning-trace + streaming imleç | **İlk gerçek export → handoff şablonu ampirik kalibre** (§4) | `panels/chat.md` |
| **3** | documents | 3-bölge: liste + writing-first editör + dual-mode preview (MD/PDF/office) | `fileWrite`-gate deseni erken kurulur | `panels/documents.md` |
| **4** | calendar | Ay/hafta/gün grid + RRULE + reminder + CalDAV-durum; GoogleCalendar **wrap** | KISMİ backend; Google-read KORUNUR + CalDAV eklenir | `panels/calendar.md` |
| **5** | cookbook | Donanım-kartı + fit-score'lu öneri grid + guided-pull + gelir-hook | backend-yok honest-empty + ModelsPanel birleştirme | `panels/cookbook.md` |
| **6** | research | Sorgu-bandı + 5-adım progress + atıflı rapor + kaynak listesi | backend-yok; SearXNG-down honest-empty | `panels/research.md` |
| **7** | notes-tasks | Notes/memory + cron todo + agent-assign + run-history | backend-yok; isim-çakışması guard (dev-loop ≠ user todo) | `panels/notes-tasks.md` |
| **8** | email | IMAP/SMTP triage + AI-özet + reply-draft; GmailBrowser **DOKUNULMAZ** | KISMİ; K7 metadata-only privacy KORUNUR, ayrı IMAP kanalı | `panels/email.md` |
| **9** | settings-2fa | 2FA/TOTP stepper + RBAC matris + tool-policy toggle | **SON** — backend TOTP+RBAC yeşil olmadan ship YASAK (ui-K6) | `panels/settings-2fa.md` |
| **10** | **cross-panel audit** | 9 panel token/spacing/mono/a11y/4-durum drift tek-geçiş denetimi | Tüm paneller indikten sonra parity audit | — (HANDOFF §4 adım-10) |

**Not — sıra mantığı:** shell chat'ten ÖNCE (her handoff +1 tab → nav taşması, `00-shell-nav.md` KN1/P8). chat PİLOT ikinci (bundle şeması + token-remap yükü **doğrulanmamış** → kalibre edilir, kalan 7 panel kalibre şablonu devralır). settings SON (güvenlik-kritik, sahte-güvenlik riski).

---

## 4. Handoff Hattı (özet — `HANDOFF-PIPELINE.md`)

**Mekanik:** Claude Design'ın iki çıkış butonu — (a) `Export` (`HTML.zip`/`PDF`/`PPTX`), (b) `Handoff to Claude Code` (**bundle** = full HTML/CSS/JS + screenshot + README[conversation+design-intent] + component-list). Claude Code bundle'dan **DEVAM eder** (ekran-görüntüsünden-sıfırdan DEĞİL). Bundle **mock veriyle** gelir; canlı `apiClient`+token+i18n+auth Claude Code'da dikilir. **Golden Rule:** bundle = REFERANS, verbatim kopyalanmaz.

**Bundle standart iskeleti** (`handoff/<panel>/`): `PROMPT.md` · `design.html` · `screenshot.png` (+`-light`, +4-state) · **`HANDOFF.md`** (çeviri sözleşmesi — 6 zorunlu alan) · `tokens.snippet.css` · `<PANEL>.spec.md` (prop imzaları).

**`HANDOFF.md` 6 zorunlu alan:** (1) component adı (GENİŞLET/YENİ) · (2) prop imzası · (3) i18n anahtar listesi (EN==TR) · (4) `/api` mock→real map · (5) 4-durum listesi · (6) kör-nokta notu. **Eksikse → DUR**, Emre'den iste (screenshot'tan el-yazımı YASAK).

**7-aşamalı boru hattı (her panel AYNI, sıra sabit):**
```
1 DESIGN-EXPORT (Emre, canvas)     → 4-state + dark/light + Handoff bundle
2 BUNDLE-YERLEŞTİR                  → handoff/<panel>/ ingest + HANDOFF.md oku
3 CLAUDE-CODE-İMPLEMENTE           → reuse-first, component yaz (bundle JS ≠ kopya)
4 TOKEN-UYGULA (EN KRİTİK MANUEL)  → ham hex → --ollamas-* / bg-immersive-* utility
5 APICLIENT-BAĞLA                   → mock → api.get/post/streamPost ({soft} honest-empty)
6 TEST + MOUNT (TDD kırmızı→yeşil)  → 4-durum test + App.tsx tab + i18n EN==TR
7 GATE + SHIP                       → typecheck ✓ lint ✓ test(fresh) ✓ → commit
```

**Remap tablosu (ham→utility):** `#0a0b10`→`bg-immersive-panel` · `#08090d`→`bg-immersive-sidebar` · `#050608`→`bg-immersive-bg` · `#6366f1/#818cf8`→`text-status-accent` · `#34d399`→`text-status-ok` · `#fbbf24`→`text-status-warn` · `#fb7185`→`text-status-err`. **`dark:` prefix YAZMA.**

**PİLOT geri-yaz (chat, zorunlu):** ilk gerçek export'tan → (1) bundle şeması, (2) token sadakati (inline hex mi CSS-var mı), (3) HTML→React eforu, (4) i18n boşluğu ölçülür → `HANDOFF-PIPELINE.md §1/§2` + `chat.md §7` güncellenir. Kalan 7 panel kalibre şablonu devralır.

---

## 5. Convergence (tasarım-fazı)

> Bir panel tasarım-fazında **DONE** sayılır ancak-ve-ancak 4 koşul GREEN. Tasarım-fazı = kod DEĞİL; "canlı panel" convergence'ı ayrı (Claude Code fazında). Kaynak: her panelin §8 Kabul Kriteri + `HANDOFF-PIPELINE.md §5`.

**Panel-düzeyi convergence (4 koşul):**
```
① prompt-hazır      : [GOAL][LAYOUT][CONTENT][BRAND][CONTEXT] beş-bölüm, kopyala-yapıştır
② tasarlandı         : 4-durum (boş/yükleniyor/hata/dolu) × dark+light × desktop+tablet
                       + a11y (role/aria-live/focus-visible/AA) + honest-empty
③ handoff-bundle     : Export + Handoff-to-Claude-Code → handoff/<panel>/ (§4 iskelet + HANDOFF.md 6-alan)
④ Emre-görsel-onay   : Emre canvas çıktısını gördü + onayladı (T0)
```

**Panel convergence matrisi (tümü ⬜ = tasarım başlamadı):**

| Panel | ① prompt | ② tasarım | ③ bundle | ④ onay | Panel GREEN? |
|---|---|---|---|---|---|
| shell-nav | ✅ (§3 hazır) | ⬜ | ⬜ | ⬜ | ⬜ |
| chat (PİLOT) | ✅ (§2 hazır) | ⬜ | ⬜ | ⬜ | ⬜ |
| documents | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| calendar | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| cookbook | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| research | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| notes-tasks | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| email | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| settings-2fa | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |

> **Not:** ① prompt'lar tüm panellerde YAZILI (her `.md §2/§3`). Tasarım-fazının işi ②③④'ü GREEN'e çekmek.

**Program-düzeyi convergence (tasarım-fazı DONE):**
```
9 panel'in HEPSİ Panel-GREEN  ∧  cross-panel audit (§3 adım-10) GREEN
        → TASARIM-FAZI DONE  → Claude Code implementasyonu başlar (§7 Sıra Kapısı)
```

**Cross-panel audit (adım-10) kontrol listesi:** tüm paneller aynı `--ollamas-*` token'dan mı? Başlık stili (`font-mono uppercase tracking-wider`) tutarlı mı? 4-durum + honest-empty her panelde var mı? i18n `app.tab.*` EN==TR? a11y AA her panelde? → drift → ilgili panel ②'ye geri döner.

---

## 6. Birleşik Kör-Nokta Ledger (PROGRAM-DÜZEYİ)

> Tüm panel/design-system/handoff ledger'larından **program-düzeyi** (tek panele özgü değil, tasarım-fazının tümünü etkileyen) kör-noktalar. **CRITICAL ilk sıra** (CLAUDE.md kuralı: CRITICAL gizleme YASAK). Panel-yerel kör-noktalar ilgili `.md §9`'da kalır.

| # | Tip | Kayıt | Etki | Azaltma | Kaynak |
|---|---|---|---|---|---|
| **G1** | **CRITICAL (sahte-güvenlik)** | `settings-2fa` UI mock kolay; TOTP time-window + RBAC enforcement **backend'de** yoksa panel **sahte-güvenlik** verir. Bugün: 2FA hiç yok, `tenants.role` kolonu yok. | Kullanıcı korunduğunu sanır, değil — kritik açık | **Backend-önce TDD gate:** `totp.test.ts`+`rbac.test.ts`+`tool-registry` role-gate yeşil olmadan settings UI ship **YASAK**. HANDOFF.md'de gate ibaresi zorunlu. settings SIRA'da **SON**. | `settings-2fa.md ui-K6`, P10 |
| **G2** | **CRITICAL (halüsinasyon / atıfsız rapor)** | `research` raporu backend atıfsız/uydurma iddia üretirse UI "güvenilir rapor" yanılsaması (fluency-as-truth). Aynı risk cookbook gelir-hook'unda (satış-vaadi). | Sahte-güven; yanlış bilgi | UI sözleşmesi: **atıfsız cümle render EDİLMEZ**; kaynak yoksa honest-empty (uydurma rapor YOK). cookbook gelir-hook "potansiyel/kaba tahmin" etiketli, opsiyonel. | `research.md KN3`, `cookbook.md KN3` |
| **G3** | **RİSK (export-format doğrulanmamış)** | `Handoff to Claude Code` bundle şeması (HTML/CSS/JS + screenshot + README + component-list) **tarif edildiği gibi — gerçek export HİÇ görülmedi**. §4 iskelet varsayıma dayanıyor. | Aşama-2 ingest yanlış dosya arar; tüm bundle şablonu sapabilir | **chat PİLOT** ilk gerçek export → §4 iskelet + 7-aşama **ampirik kalibre** → `HANDOFF-PIPELINE.md` güncelle. Kalan 7 panel kalibre şablonu devralır. | `HANDOFF-PIPELINE.md P1`, `chat.md C1`, tüm paneller |
| **G4** | **RİSK (token-remap drift)** | Claude Design **ham hex** üretir (`--ollamas-*` / Tailwind v4 `@theme` DEĞİL); canvas'ın seçtiği hex tam token olmayabilir (`#0a0b11` gibi yakın-farklı). Otomatikleşemez → EN KRİTİK MANUEL adım. | Subtle renk drift, cross-panel tutarsızlık | `tokens.snippet.css` zorunlu göm; remap'i `screenshot-light.png` ile göz-doğrula; şüpheli renk → **en-yakın token'a snap**; cross-panel audit (§3-10) yakalar. | `01-design-system.md K3`, `HANDOFF-PIPELINE.md P3` |
| **G5** | **RİSK (design-system GitHub-inherit belirsiz)** | GitHub-inherit'in `tokens/*.json` + Tailwind v4 `@theme`'i ne kadar sadık extract ettiği **doğrulanmadı**; repo `adobemre1/ollamas` **public mi bilinmiyor** (private→connector-auth gerekir/çalışmaz). | YOL A yanlış palette verir veya bloke olur | T0: repo görünürlüğü kontrol (T0-1); §2.2 adım-4 zorunlu palette-doğrulama; eşleşmez/bloke → **YOL B manuel token-prompt** fallback. | `01-design-system.md K1/K2` |
| **G6** | **RİSK (backend-yok honest-empty)** | 5 panel (`cookbook, research, notes, email, settings-rbac`) backend'siz. Aşama-5 çağrısı boşa düşer; panel canvas'ta güzel ama runtime'da ölü. `{soft:true}` unutulursa **5xx'te ÇÖKER**. | Kötü UX / RUM error | Aşama-5 ZORUNLU: `{soft:true}` + honest-empty → çökmeden mock-boş render; backend 05-features'ta gelince mock kaldırılır. **Boru hattı tek başına canlı-panel garanti ETMEZ.** | `HANDOFF-PIPELINE.md P4`, cookbook/research/notes/email |
| **G7** | **RİSK (chat-pilot streaming-mock)** | `chat` streaming imleci statik-HTML'de **sahte** (canlı SSE yok); gerçek token-delta backend Eksen A'ya bağlı (kapsam-DIŞI). Aynı progress-mock riski research 5-adım, cookbook pull-progress, calendar/email sync'te. | Tasarım "streaming/progress" gösterir, implement'te mock kalır | Mock imleç/progress = görsel-niyet; HANDOFF.md mock→real map'te "gerçek stream backend'e bağlı" notu; canlı akış Claude Code işi. | `chat.md C3`, `research.md KN2`, `cookbook.md KN2` |
| **G8** | **RİSK (tab-taşma)** | Her başarılı handoff +1 sekme → 21→30 sidebar taşar. `00-shell-nav.md` (SIRA'da 1.) bunu çözmezse her mount UX'i bozar. | Nav kullanılamaz | Shell chat'ten ÖNCE; ≥24 sekmede ⌘K komut-paleti + 3 kategori-grup (AI Workspace/Ops/Settings) zorunlu. Mevcut tab-id + i18n anahtarları KIRILMAZ. | `00-shell-nav.md KN1`, `HANDOFF-PIPELINE.md P8` |
| **G9** | **VARSAYIM (design-system oturum-kalıcılığı)** | Claude Design "design-system kaydı oturum-boyu kalıcı" varsayıldı; gerçekte her yeni chat sıfırlanabilir → paneller drift eder. | Panel'ler farklı token'a kayar | Tüm 9 paneli **tek oturumda** üret; oturum koparsa setup'ı yeniden gönder + tutarlılık-guard her panelde tekrar (§2). | `01-design-system.md K4` |
| **G10** | **RİSK (GENİŞLET regresyonu + koruma yüzeyleri)** | 4 panel (`chat/documents/calendar/settings`) çalışan state/logic taşır; bundle görsel katmanı ezerse regresyon. Ayrıca **DOKUNULMAZ koruma yüzeyleri:** GmailBrowser (metadata-only privacy), GoogleCalendarBrowser (Firebase consent), ReactAgentTab prop/state-makinesi, handleOpen/SaveFile, notes isim-çakışması (dev-loop). | Görsel yükseltme mevcut davranışı/güvenliği bozar | Aşama-3 kuralı: **state/logic KORUNUR, sadece görsel katman**; mevcut testler yeşil kalmalı; HANDOFF.md koruma-notu + import-guard; davranış-koruyucu refactor ayrı commit. | `HANDOFF-PIPELINE.md P6`, email/calendar/notes/chat/documents |
| **G11** | **MANUEL (i18n TR boşluğu)** | Design EN mock üretir; TR anahtar Aşama-6'da el-ile. Eksik `<panel>.*` TR → Lingui fallback = ham id sızıntısı (TR kullanıcıda). | Yarım i18n | Her HANDOFF.md'ye i18n-checklist; Aşama-6'da EN==TR anahtar-sayısı diff (CI grep). | `HANDOFF-PIPELINE.md P7`, tüm paneller |

---

## 7. T0 Kapıları (Emre kararları) + Sıra Kapısı

### 7.1 T0 Kararları — tasarım başlamadan Emre onayı

| # | Karar | Neden gerekli | Blokladığı iş |
|---|---|---|---|
| **T0-1** | **Repo görünürlüğü** — `adobemre1/ollamas` public mi? Değilse (a) public'e çevir, (b) connector-auth, (c) YOL B'ye düş | GitHub-inherit (YOL A) design-system extract'i için | design-system kurulumu (§2a), G5 |
| **T0-2** | **Pilot-sonrası şablon-onay** — chat PİLOT export'u alındıktan sonra kalibre handoff şablonunu Emre onaylar mı? | Kalan 7 panel bu şablonu devralır; yanlış şablon 7 panele yayılır | chat sonrası kalan 7 panel (§4 PİLOT geri-yaz), G3 |
| **T0-3** | **KN-M6 Google-tab kararı** — `calendar`: GoogleCalendarBrowser "Google (read-only) provider" olarak wrap; `email`: GmailBrowser ayrı `gmail` tab kalır (DOKUNULMAZ). İki yüzey ayrımı onayı | Privacy-law + Firebase consent regresyon riski | calendar + email tasarımı (§3), G10 |
| **T0-4** | **Kategori grup üyeliği** — hangi panel hangi shell-grubu (AI Workspace/Ops/Settings)? `swarm+pipeline→Orchestra`, `telemetry→Cockpit` eşlemesi varsayım | Yanlış gruplama = kötü keşfedilebilirlik | shell-nav tasarımı | 
| **T0-5** | **settings backend-gate** — 2FA/RBAC UI'ı O6.1/O6.2/O6.3 backend TDD yeşil olmadan tasarlanabilir ama **ship EDİLMEZ**; lokal-mod 2FA uygulanır mı? | Sahte-güvenlik (G1); lokal owner 2FA belirsiz | settings ship (kod fazı), G1 |

### 7.2 Sıra Kapısı (Emre kuralı — DEĞİŞMEZ)

```
┌──────────────────────────────────────────────────────────────────┐
│  TASARIM TÜM TAMAMLANMADAN KOD BAŞLAMAZ                            │
│                                                                    │
│  9 panel Panel-GREEN (§5)  ∧  cross-panel audit GREEN (§3-10)      │
│         ────────────────────────────────────────────────           │
│                              ▼                                      │
│                    TASARIM-FAZI DONE                               │
│                              ▼                                      │
│              Claude Code implementasyonu BAŞLAR                   │
│              (HANDOFF-PIPELINE §2 7-aşama, panel-panel)           │
└──────────────────────────────────────────────────────────────────┘
```

Emre emri: *"planlar bitince Claude Design işleme başlasın"* → tasarım-fazı (canvas üretimi) TÜM paneller için biter, cross-audit GREEN olur, SONRA Claude Code kod implementasyonuna geçer. Tek istisna: chat PİLOT'un handoff-şablon kalibrasyonu (§4) — bu tasarım-fazının parçası, kod değil; şablonu diğer 7 panele hazırlar.

---

## 8. Kabul Kriteri (bu master DONE sayılır ancak)

- [x] 9 panel + design-system + handoff **özetlendi + birleştirildi** (yeniden yazılmadı) — §1 tablo, §3 sıra, §4 hat.
- [x] **Hazırlık checklist** (design-system kurulum + referans-screenshot + publish + Chrome) — §2.
- [x] **Panel sırası + bağımlılık** (design-system-first → shell → chat-PİLOT → 7 panel → cross-audit) + her panel kendi `.md`'sine referans — §3.
- [x] **Handoff hattı** (Export → bundle → Claude Code 7-aşama) özeti — §4.
- [x] **Convergence (tasarım-fazı)** — panel-4-koşul + program-DONE + matris — §5.
- [x] **Birleşik kör-nokta ledger** program-düzeyi (11 kayıt, CRITICAL ilk sıra: sahte-güvenlik, halüsinasyon) — §6.
- [x] **T0 kapıları** (repo-görünürlük, pilot-şablon-onay, KN-M6 Google-tab, +2) + **Sıra kapısı** (tasarım TÜM → sonra kod) — §7.

---

**Sonraki adım:** Emre T0 kararları (§7.1) → `01-design-system.md` setup (§2) → `panels/00-shell-nav.md` §3 PROMPT → `panels/chat.md` §2 PROMPT (PİLOT, şablon kalibre §4) → kalan 7 panel kalibre şablonla → cross-panel audit (§3-10) GREEN → **tasarım-fazı DONE** → Claude Code implementasyonu (§7.2 Sıra Kapısı). Bu belge **navigasyon + kapı + convergence** katmanıdır; panel brief'leri kendi `.md`'lerinde tam.
