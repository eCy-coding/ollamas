# ODYSSEY-DESIGN — Panel 00: App-Shell + Sidebar Navigasyon (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/00-shell-nav.md`
> **Odak:** App-shell + sidebar navigasyon. Mevcut ollamas tab-shell → **odysseus-workspace shell**'e evrimleşme.
> **Kritik sorun (plan KN-M5 / K4):** 21 mevcut sekme + 6-8 yeni panel = **28+ sekme** → dikey sidebar **TAŞAR**. Çözüm: **⌘K komut-paleti + kategori-gruplama**.
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** (backend/API/localhost YOK). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Shell Durumu (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10).

### 1.1 Shell iskeleti — `src/App.tsx` (tek dosya, 445 satır)

| Bölge | Konum (dosya:satır) | Not |
|---|---|---|
| **Global header** | `src/App.tsx:188-208` | logo + başlık `LLM Mission Control` + `E2E_ORCHESTRATOR_V3` + status badge + `OfflineBadge` + `LanguageToggle` + `ThemeToggle` |
| **Sol sidebar (dikey nav)** | `src/App.tsx:213-263` | `.lg:col-span-1`; başlık `app.sidebar.explorer`; **düz (grouplanmamış) 21-buton dikey liste** `tabs.map(...)` `src/App.tsx:218` |
| **Setup wizard kartı** | `src/App.tsx:242-262` | yalnız `telemetry.mode === "demo"` iken görünür |
| **Dinamik panel body** | `src/App.tsx:265-435` | `.lg:col-span-3`; üstte host/workspace status bar `269-279`; her panel `activeTab === "<id>" && <Component/>` |
| **Footer** | `src/App.tsx:439-441` | `app.footer.copyright` |
| **Toast overlay** | `src/App.tsx:166-185` | `fixed bottom-4 right-4`, 4sn auto-dismiss |

### 1.2 State + veri akışı

- **`activeTab`** state: `src/App.tsx:64` — `useState<string>("telemetry")` (default sekme).
- **Nav mekaniği:** `tabs[]` dizisi `src/App.tsx:109-131`; buton `onClick={() => { if (enabled) setActiveTab(tab.id); }}` `src/App.tsx:223`; body'de `activeTab === "<id>" && <...>` koşullu mount.
- **Etiket i18n:** `_(\`app.tab.${tab.id}\`)` `src/App.tsx:235` (runtime Lingui).
- **Capability gate:** `isTabEnabled(tab.id, perms)` `src/App.tsx:219` → `src/lib/capabilities.ts`; kilitli sekme `disabled` + `Lock` ikon + `opacity-40`. `perms = telemetry?.permissions` `src/App.tsx:67` (deny-by-default).
- **Live veri:** `/api/cockpit/stream` SSE (~2s) + `/api/health` polling fallback `src/App.tsx:88-106`.

### 1.3 Mevcut 21 sekme (`src/App.tsx:109-131` `tabs[]` — DÜZ liste, gruplanmamış)

```
telemetry · swarm · saas · pipeline · react-agent · files · drive · sheets ·
calendar · gmail · search · github-actions · integrations · threatintel ·
terminal · keys · security · backup · automation · selftest · revenue
```

**"22-33 tab" aralığının anatomisi:** 21 nav sekmesi + header'da 3 kontrol elemanı (`OfflineBadge` `src/components/OfflineBadge.tsx`, `LanguageToggle` `src/components/LanguageToggle.tsx`, `ThemeToggle` `src/components/ThemeToggle.tsx`) + status badge = **etkileşimli shell yüzeyi ~24**. `03-claude-design-ui.md`'nin öngördüğü 6-8 yeni panel (`research · documents · email · notes · calendar-caldav · cookbook · settings` + chat-yükseltme) eklendiğinde sekme sayısı **27-29**'a çıkar → **dikey nav taşması kesin** (K4 doğrulandı).

### 1.4 Header kontrolleri (korunacak — shell'e taşınacak)

| Bileşen | Dosya | Davranış |
|---|---|---|
| `ThemeToggle` | `src/components/ThemeToggle.tsx` | `useTheme()` dark/light flip; `aria-pressed`; Sun/Moon ikon |
| `LanguageToggle` | `src/components/LanguageToggle.tsx` | `activateLocale()` TR/EN; `<html lang>` persist |
| `OfflineBadge` | `src/components/OfflineBadge.tsx` | yalnız offline iken render; `role="status" aria-live` |
| Status badge | `src/App.tsx:134-159` `getHeaderBadge()` | live / degraded-live / demo üç durum |

---

## 2. Hedef Shell — odysseus-workspace evrimi (kategori-gruplu + ⌘K)

**Değişmez kısıt (Claude Design):** shell **statik-HTML** olarak tasarlanır; `activeTab` state, SSE, capability-gate **Claude Code handoff** aşamasında mevcut `App.tsx`'e implemente edilir. Claude Design yalnız **görsel iskeleti + mock durumları** üretir.

**Sidebar kategori-gruplaması (taşma çözümü — 3 katlanabilir grup):**

```
┌─ AI WORKSPACE ──────────────────  (default açık)
│   chat (react-agent)      research        documents
│   email                   notes           calendar
├─ OPS ───────────────────────────  (katlanabilir)
│   cockpit (telemetry)     orchestra (swarm/pipeline)
│   cookbook                integrations    terminal    backup    automation
├─ SETTINGS ──────────────────────  (katlanabilir, alt-sabit)
│   keys        security        saas        revenue        settings (2FA/RBAC)
```

Grup başlıkları `<button aria-expanded>` ile katlanır; her grup içi mevcut buton deseni korunur (ikon + etiket + capability-lock). **Mevcut tab-id'ler DEĞİŞMEZ** (i18n `app.tab.${id}` anahtarları + `activeTab` string'leri kırılmaz) — sadece görsel gruplama katmanı eklenir (K-koruma).

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul).

```
[GOAL]
Design the app-shell + left sidebar navigation for a self-hosted, local-first AI
workspace ("ollamas", odysseus-parity). This is the persistent chrome that wraps
every panel: header, grouped collapsible sidebar, a command palette (Cmd+K), and
the main content mount area. NOT a single feature panel — the shell itself.

[LAYOUT]
- Full-height flex column: header (h-56px) / main / footer.
- HEADER: left = square gradient logo (indigo→cyan) + product name "LLM Mission
  Control" (uppercase, tracked) + subtitle "E2E_ORCHESTRATOR_V3"; right = status
  pill (LIVE / DEGRADED / DEMO) + offline badge (only when offline) + language
  toggle (TR/EN) + theme toggle (sun/moon) + a "Search ⌘K" trigger button.
- MAIN = 2-column: left SIDEBAR (fixed ~240px) + right CONTENT (fluid).
- SIDEBAR: 3 collapsible category groups with small uppercase mono headers and a
  chevron (aria-expanded):
    • AI WORKSPACE (default expanded): Chat, Research, Documents, Email, Notes, Calendar
    • OPS (collapsible): Cockpit, Orchestra, Cookbook, Integrations, Terminal, Backup, Automation
    • SETTINGS (collapsible, pinned bottom): Keys, Security, SaaS, Revenue, Settings (2FA/RBAC)
  Each row = lucide icon + label + optional lock icon (disabled/greyed at 40%
  opacity when capability denied). Active row = indigo tint + left accent border.
- COMMAND PALETTE (⌘K): centered modal overlay, dimmed backdrop, search input at
  top, grouped results (same 3 categories), keyboard hint footer (↑↓ navigate,
  ↵ open, esc close). Fuzzy-match on panel name. This is the PRIMARY answer to
  sidebar overflow — 28+ destinations reachable by typing.
- TOP STATUS BAR (in content area): active host platform + workspace path.
- FOOTER: single centered copyright line, mono.

[CONTENT]
Sidebar destinations (28 total, grouped as above). Use these exact labels.
Header status pill states: "LIVE · 3 models active" / "DEGRADED · Ollama offline"
/ "DEMO · Cloud Sandbox". Command palette mock: query "res" → highlights
"Research", "Restore backup". Show ~6 results grouped.

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Dark is primary; ALSO produce a light variant (token-driven, no dark: prefixes).
Motion: fade-in 0.25s; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR shell states:
  1. EMPTY WORKSPACE — no panel selected / fresh boot: content area shows a
     centered greeting + "Press ⌘K to jump anywhere" hint + 3 suggested panels.
  2. LOADING — telemetry connecting: status pill shows "CONNECTING…" pulsing,
     content area shows skeleton shimmer rows, sidebar rendered but status unknown.
  3. ERROR — backend offline: degraded amber pill, a non-blocking inline banner
     "Cockpit stream lost — showing last-known state", retry affordance.
  4. FILLED — healthy: LIVE pill, an active panel highlighted, populated status bar.
Responsive:
  • DESKTOP (≥1024px): sidebar always visible, 2-column.
  • TABLET (768–1023px): sidebar collapses to icon-rail (label on hover/tooltip);
    ⌘K becomes the primary nav; a hamburger expands the full labeled sidebar as an
    overlay drawer.
Keyboard-first: ⌘K opens palette, esc closes, ↑↓ + ↵ navigate. Accessibility:
role="navigation" on sidebar, aria-current on active row, aria-expanded on group
headers, focus-visible rings, contrast AA.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Shell görünümü | Kritik detay |
|---|---|---|
| **1. Boş workspace** | Panel seçilmemiş; content ortada greeting + `Press ⌘K to jump anywhere` + 3 öneri kartı | ⌘K keşfedilebilirliği burada satılır |
| **2. Yükleniyor** | Header pill `CONNECTING…` pulse; content skeleton shimmer; sidebar render ama status bilinmiyor | `.ollamas-skeleton` shimmer deseni |
| **3. Hata** | Amber `DEGRADED` pill + inline banner `Cockpit stream lost — last-known state` + retry | non-blocking (shell çökmez, stale gösterir) |
| **4. Dolu** | `LIVE · N models active` pill; aktif panel vurgulu; status bar dolu | happy-path referans |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema).

---

## 5. Responsive (desktop + tablet)

| Viewport | Sidebar | ⌘K rolü | Not |
|---|---|---|---|
| **Desktop (≥1024px)** | Her zaman görünür, tam-etiketli, 2-kolon (`lg:col-span-1` + `lg:col-span-3`, mevcut grid korunur) | İkincil hızlandırıcı | Mevcut `App.tsx:211` grid deseni baz |
| **Tablet (768–1023px)** | İkon-rail'e daralır (etiket hover/tooltip); hamburger → overlay drawer | **Birincil nav** | Taşma en çok burada; ⌘K taşıma vanası |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` §2.8 "mobil bozulmayan grid" genel kriteri geçerli ama detay tasarımı ayrı panel işi (Kör-Nokta KN3).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk shell iskeletini üretir (muhtemel: düz sidebar, ⌘K yok).
2. **İnline-comment #1:** "Sidebar'ı 3 katlanabilir kategori grubuna böl (AI Workspace / Ops / Settings), grup başlıkları chevron + aria-expanded."
3. **Chat iterasyon #2:** "⌘K komut paletini ekle — merkezi modal, gruplu sonuç, klavye-hint footer. Query 'res' mock'unu göster."
4. **İnline-comment #3:** "Header'a Search ⌘K trigger butonu + status pill'in 3 durumunu (LIVE/DEGRADED/DEMO) ayrı ayrı göster."
5. **Chat iterasyon #4:** "4 shell durumunu ayrı frame olarak üret: boş / yükleniyor / hata / dolu."
6. **İnline-comment #5:** "Light varyantı token-driven üret (dark: prefix yok). Tablet icon-rail + hamburger drawer varyantını ekle."
7. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (K1 azaltma).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/00-shell-nav/` altına:

```
00-shell-nav/
  PROMPT.md              # §3'teki tam brief (token + mock + 4-state)
  shell.html             # Claude Design export (self-contained, inline CSS)
  screenshot-empty.png   # 4 durum × dark
  screenshot-loading.png
  screenshot-error.png
  screenshot-filled.png
  screenshot-*-light.png # her durumun light varyantı
  screenshot-tablet.png  # icon-rail + hamburger drawer
  HANDOFF.md             # ↓ zorunlu içerik
  tokens.snippet.css     # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  CMDK_PALETTE.spec.md   # ⌘K prop imzası + fuzzy-match sözleşmesi
  NAV_GROUP.spec.md      # katlanabilir grup prop imzası + aria-expanded
```

**HANDOFF.md zorunlu içeriği:**
- Shell component ağacı: `AppShell` → `Header` / `Sidebar(groups[])` / `CommandPalette` / `<content mount>` / `Footer`.
- **Mevcut→yeni map:** hangi mevcut `App.tsx` bölgesi (satır aralığı) hangi yeni component'e taşınır; `activeTab` state + `setActiveTab` KORUNUR.
- i18n anahtar listesi: mevcut `app.tab.*` (21 anahtar) korunur + yeni `app.nav.group.aiWorkspace/ops/settings`, `app.cmdk.placeholder/hint`, EN+TR çift.
- ⌘K → `setActiveTab` sözleşmesi (palette seçimi mevcut nav ile aynı state'i yazar).
- Capability-gate koruması: `isTabEnabled` + `Lock` deseni grup içinde korunur (`src/lib/capabilities.ts` `TAB_CAPABILITY` map genişletilir — yeni panel-id'leri eklenir).

---

## 8. Kabul Kriteri (bu shell brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] Sidebar **3 katlanabilir kategori grubu** (AI Workspace / Ops / Settings) — 28 hedef taşmadan yerleşir.
- [ ] **⌘K komut paleti** tasarlandı: merkezi modal + gruplu fuzzy sonuç + klavye-hint (↑↓/↵/esc) — taşmanın birincil çözümü.
- [ ] **4 shell durumu** (boş / yükleniyor / hata / dolu) ayrı frame.
- [ ] **Responsive:** desktop 2-kolon + tablet icon-rail/hamburger drawer.
- [ ] Header kontrolleri korundu: status pill (3 durum) + `OfflineBadge` + `LanguageToggle` + `ThemeToggle`.
- [ ] Dark + light token-driven parity (`dark:` prefix yok).
- [ ] a11y: `role="navigation"`, `aria-current`, `aria-expanded`, focus-visible, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mevcut→yeni map` + `activeTab` koruma notu.
- [ ] **Mevcut tab-id + i18n anahtarları KIRILMADI** (yalnız görsel gruplama eklendi).

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **RİSK (tab-taşma)** | 21 → 28+ sekme dikey sidebar'ı taşırır (K4 doğrulandı `src/App.tsx:109-131` düz liste). | Nav kullanılamaz hale gelir | Kategori-gruplama (§2) + ⌘K (§3) — bu belgenin çekirdek çözümü; tablet'te icon-rail zorunlu |
| **KN2** | **YENİ (⌘K yokluğu)** | Mevcut shell'de komut-paleti **YOK**; klavye-nav yok (`App.tsx` sadece click nav). | odysseus §2.3 "klavye-öncelikli" kriteri karşılanmıyor | ⌘K sıfırdan tasarlanır; handoff'ta yeni `CommandPalette` component + global keydown listener (Claude Code işi) |
| **KN3** | **KORUMA (mevcut-tab)** | Gruplama/refactor mevcut `activeTab` string'lerini veya `app.tab.${id}` i18n anahtarlarını kırarsa tüm paneller mount edilemez. | Regresyon — tüm shell çöker | tab-id'ler DEĞİŞMEZ; yalnız görsel gruplama katmanı; HANDOFF.md `mevcut→yeni map` + i18n koruma checklist; refactor sonrası her `activeTab` yolu test edilir |
| **KN4** | **VARSAYIM** | Claude Design'ın ⌘K gibi **etkileşimli** overlay'i statik-HTML olarak makul üretebildiği varsayıldı (canvas prototip, gerçek keydown yok). | Palette handoff'ta sıfırdan kodlanır | Claude Design yalnız görsel katman üretir; fuzzy-match + keydown + `setActiveTab` bağlama **Claude Code** işi (K3 paraleli) |
| **KN5** | **VARSAYIM** | `01-design-system.md` (design-system-first ön-koşul) mevcut/tam kabul edildi; token'lar `src/styles/tokens.css`'ten sadık. | Token uyuşmazlığı → görsel drift | `tokens.snippet.css` brief'e gömülür; ilk export'ta token-remap denetimi (K2 paraleli) |
| **KN6** | **BİLİNMEYEN** | Kategori grup üyeliği (hangi panel hangi grup) UX kararı — `swarm+pipeline`→"Orchestra", `telemetry`→"Cockpit" eşlemesi varsayım. | Yanlış gruplama = kötü keşfedilebilirlik | Emre onayı (T0); grup üyeliği HANDOFF.md'de açık listelenir, iterasyonda ayarlanabilir |
| **KN7** | **RİSK (header taşma)** | Header'a `Search ⌘K` trigger eklenince tablet'te header kontrolleri (pill + 4 buton) sığmayabilir. | Header wrap/bozulma | Tablet'te status pill kısalt + toggle'ları overflow-menu'ye al (iterasyon #6) |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `App.tsx` shell-refactor (kategori-grup + `CommandPalette`) TDD ile. Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN4/KN3 gate).
