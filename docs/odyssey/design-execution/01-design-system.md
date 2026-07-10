# ODYSSEY-DESIGN 01 — Design-System Kurulum Planı (Claude Design)

> **Belge:** `docs/odyssey/design-execution/01-design-system.md`
> **Odak:** ollamas'ın **mevcut** tasarım-sistemini (token/tema) **Claude Design'a** (claude.ai/design) kurmak. Bu, 8 panelin (`03-claude-design-ui.md`) hepsinin **ÖN-KOŞULU** — "design-system-first": ÖNCE token kurulur → tüm paneller aynı token setinden tutarlı üretilir.
> **Dil:** TR (kod/token/dosya-yolu/prompt-örneği EN).
> **Üretim tarihi:** 2026-07-10.
> **Durum:** OPERASYONEL yürütme planı (çalıştırılabilir adımlar; Emre elle Claude Design'da uygular).

---

## 0. Neden design-system-first (değişmez kural)

Claude Design **inline CSS üreten frontend-tasarım canvası**dır (bkz. `03-claude-design-ui.md §0`): backend/DB üretmez, `localhost`/MCP'ye bağlanmaz. Her panel ayrı prompt'la üretilir. Eğer her panele token'ı tekrar tarif edersek → **token-drift** (panel A'nın accent'i `#6366f1`, panel B'ninki "mor" olur). 

**Çözüm:** Bu belgedeki **tek bir kurulum adımı** (GitHub-inherit VEYA manuel token-prompt) Claude Design oturumunun başında bir kez yapılır; sonra 8 panel brief'i (`03-...md §3.1–3.8`) aynı oturumda/aynı token bağlamında üretilir. Her panel prompt'una tek satır **"match ollamas design system (see setup)"** eklenir → tutarlılık-guard.

**Sıra:** `[BU BELGE: token kur] → [chat 3.1] → [cookbook 3.7] → ... → [settings 3.8]` (panel sırası `03-...md §4`).

---

## 1. Mevcut-Token Envanteri (koda karşı DOĞRULANMIŞ, dosya:satır)

> Kaynak okundu (2026-07-10): `src/styles/tokens.css`, `src/styles/tokens-light.css`, `src/lib/theme.tsx`, `src/index.css`, `style-dictionary.config.js`, `tokens/color.json`, `tokens/scale.json`.

### 1.1 Kaynak-of-truth zinciri (EL İLE DÜZENLEME YASAK)
```
tokens/color.json + tokens/scale.json     ← TEK KAYNAK (elle yazılan)
        │  npm run tokens (style-dictionary.config.js)
        ▼
src/styles/tokens.css        (:root = DARK, auto-generated, "Do not edit directly")
src/styles/tokens-light.css  ([data-theme="light"], auto-generated)
        │  @import (src/index.css:3-5)
        ▼
src/index.css @theme (satır 9-30)  → Tailwind v4 utility eşlemesi
        │
        ▼
components: bg-immersive-*, text-immersive-*, text-status-*, font-sans/mono
```
- `style-dictionary.config.js:8` → `prefix: 'ollamas'` → tüm değişkenler `--ollamas-*`.
- `style-dictionary.config.js:16` → `outputReferences: true` (referans korunur).

### 1.2 Renk paleti — DARK (`src/styles/tokens.css:5-31`, kaynak `tokens/color.json`)

| Rol | `--ollamas-*` değişkeni | Değer (DARK) | Kaynak satır |
|---|---|---|---|
| bg-base | `color-bg-base` | `#050608` | tokens.css:6 |
| bg-sidebar | `color-bg-sidebar` | `#08090d` | tokens.css:7 |
| bg-panel | `color-bg-panel` | `#0a0b10` | tokens.css:8 |
| bg-inset | `color-bg-inset` | `#04050a` | tokens.css:9 |
| border-subtle | `color-border-subtle` | `rgba(255,255,255,0.05)` | tokens.css:10 |
| border-strong | `color-border-strong` | `rgba(255,255,255,0.10)` | tokens.css:11 |
| text-bright | `color-text-bright` | `#f8fafc` | tokens.css:12 |
| text-muted | `color-text-muted` | `#94a3b8` | tokens.css:13 |
| text-dim | `color-text-dim` | `#97a4b8` | tokens.css:14 |
| accent-indigo | `color-accent-indigo` | `#6366f1` | tokens.css:15 |
| accent-emerald | `color-accent-emerald` | `#10b981` | tokens.css:16 |
| status-accent | `color-status-accent` | `#818cf8` | tokens.css:17 |
| status-ok | `color-status-ok` | `#34d399` | tokens.css:18 |
| status-warn | `color-status-warn` | `#fbbf24` | tokens.css:19 |
| status-err | `color-status-err` | `#fb7185` | tokens.css:20 |
| status-info | `color-status-info` | `#22d3ee` | tokens.css:21 |

### 1.3 Renk paleti — LIGHT (`src/styles/tokens-light.css:5-22`, scope `[data-theme="light"]`)

| Rol | Değer (LIGHT) | Satır |
|---|---|---|
| bg-base | `#ffffff` | tokens-light.css:6 |
| bg-sidebar | `#f8fafc` | tokens-light.css:7 |
| bg-panel | `#f1f5f9` | tokens-light.css:8 |
| bg-inset | `#e2e8f0` | tokens-light.css:9 |
| border-subtle | `rgba(15,23,42,0.08)` | tokens-light.css:10 |
| border-strong | `rgba(15,23,42,0.14)` | tokens-light.css:11 |
| text-bright | `#0f172a` | tokens-light.css:12 |
| text-muted | `#475569` | tokens-light.css:13 |
| text-dim | `#586477` | tokens-light.css:14 |
| accent-indigo | `#4f46e5` | tokens-light.css:15 |
| accent-emerald | `#059669` | tokens-light.css:16 |
| status-accent | `#4f46e5` | tokens-light.css:17 |
| status-ok | `#065f46` | tokens-light.css:18 |
| status-warn | `#92400e` | tokens-light.css:19 |
| status-err | `#be123c` | tokens-light.css:20 |
| status-info | `#155e75` | tokens-light.css:21 |

> **Not:** light paletinde `status-*` değerleri koyulaştırılmış (WCAG AA kontrast — açık zeminde okunur). Claude Design'a light varyant verilirken bu değerler dark'tan **farklı**; ikisi de aktarılmalı (§3).

### 1.4 Tipografi / Radius / Space (`src/styles/tokens.css:22-30`, kaynak `tokens/scale.json`)

| Token | Değer | Satır |
|---|---|---|
| `font-sans` | `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | tokens.css:22 |
| `font-mono` | `"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | tokens.css:23 |
| `radius-sm / md / lg` | `3px / 8px / 12px` | tokens.css:24-26 |
| `space-1..4` | `4px / 8px / 12px / 16px` | tokens.css:27-30 |

### 1.5 Tailwind v4 utility eşlemesi (`src/index.css:9-30`, `@theme` bloğu)

| Tailwind utility (component'te kullanılan) | → token |
|---|---|
| `bg-immersive-bg / -sidebar / -panel / -inset` | `--ollamas-color-bg-*` |
| `border-immersive-border / -border-strong` | `--ollamas-color-border-*` |
| `text-immersive-text-bright / -muted / -dim` | `--ollamas-color-text-*` |
| `text-accent-indigo / -accent-emerald` | `--ollamas-color-accent-*` |
| `text-status-accent / -ok / -warn / -err / -info` | `--ollamas-color-status-*` |
| `font-sans / font-mono` | `--ollamas-font-*` |

> **Kritik (Tailwind v4):** ollamas `@import "tailwindcss"` + `@theme` inline kullanır (`src/index.css:1,9`). Tailwind config dosyası (`tailwind.config.js`) **yoktur** — tema `@theme` içinde. Claude Design'ın v4 `@theme` sözdizimini üretmeme ihtimali yüksek (K3, §5).

### 1.6 Tema mekaniği (`src/lib/theme.tsx`)
- Tek `[data-theme]` attribute `<html>`'de flip eder (`theme.tsx:38`). Component'lerde `dark:` prefix **YOK** — renkler token katmanından gelir (`theme.tsx:10-12` yorumu).
- Init sırası: no-flash inline script (index.html) → localStorage (`ollamas.theme`) → OS `prefers-color-scheme` (`theme.tsx:18-24`).
- **Sonuç:** Claude Design çıktısı da **token-tabanlı** olmalı (renk değişkenleri), `dark:` prefix'li Tailwind **üretmemeli** — yoksa handoff'ta remap gerekir (K3).

### 1.7 Hareket / a11y (`src/index.css:56-91`)
- `.animate-fade-in` (0.25s cubic-bezier `0.16,1,0.3,1`) · `.ollamas-skeleton` shimmer (1.4s).
- Scrollbar: 6px, thumb `rgba(255,255,255,0.1)`, hover `rgba(99,102,241,0.4)` (indigo).
- `prefers-reduced-motion: reduce` → tüm animasyon durur (`src/index.css:83-91`). Claude Design brief'ine **"respect prefers-reduced-motion"** eklenmeli.

---

## 2. Claude Design'a Kurulum Planı — YOL A: GitHub-repo-inherit (öncelikli)

Claude Design'ın `+` referans-yükle özelliği **GitHub repo linkinden component + token OTOMATİK extract** eder (doğrulanmış playbook). Bu, manuel token-yazımdan üstün: `tokens/*.json` + `src/index.css @theme` + gerçek component'ler tek seferde çekilir.

### 2.1 Repo hazırlığı (ön-kontrol)
- **Remote'lar (doğrulandı):**
  - `origin` → `https://github.com/adobemre1/ollamas.git`
  - `fork`   → `git@github.com:eCy-coding/ollamas.git`
  - Aktif branch: `feat/key-autonomy`.
- **GATE — public erişim:** Claude Design'ın repo-extract'i için repo **public** olmalı VEYA Claude'un GitHub connector'ı repo'ya erişebilmeli. → **T0 kontrol:** `adobemre1/ollamas` public mi? Değilse (a) public'e çevir, (b) veya YOL B'ye (manuel) düş.
- **Token dosyaları push'lu olmalı:** `tokens/color.json`, `tokens/scale.json`, `src/styles/tokens.css`, `src/styles/tokens-light.css`, `src/index.css` remote'ta güncel olmalı. → **T0 kontrol:** `git status` temiz + bu dosyalar son commit'te.

### 2.2 Adımlar (Claude Design UI'da)
```
1. claude.ai/design aç → yeni chat (New-Project butonu yok, doğrudan prompt).
2. `+` → "Add reference" → GitHub repo linki yapıştır:
       https://github.com/adobemre1/ollamas   (public ise)
       (private ise: GitHub connector auth + repo seçimi)
3. Claude Design extract eder → component + token envanteri gösterir.
4. Doğrula (KRİTİK): extract edilen palette gerçek değerlerle eşleşiyor mu?
       accent-indigo = #6366f1 ? bg-panel = #0a0b10 ? font-sans Inter ?
   → Eşleşmiyorsa YOL B token-prompt'u ile MANUEL override et (§3).
5. Setup prompt'u (kurulum, panel DEĞİL — bkz §2.3) gönder → design-system kaydı.
6. Bundan sonra her panel prompt'una "match ollamas design system" eklenir (§4).
```

### 2.3 Kurulum (setup) prompt'u — GitHub-inherit'i sağlamlaştıran
> "Use the ollamas design system extracted from this repo as the SINGLE source of truth for all panels in this session. It is a dark-first immersive developer-cockpit theme with a light variant toggled by a single `[data-theme]` attribute (no `dark:` prefixes). Confirm you extracted these exact tokens; if any differ, use MY values: DARK bg-base `#050608`, bg-sidebar `#08090d`, bg-panel `#0a0b10`, bg-inset `#04050a`, border-subtle `rgba(255,255,255,0.05)`, text-bright `#f8fafc`, text-muted `#94a3b8`, accent-indigo `#6366f1`, accent-emerald `#10b981`, status-ok `#34d399`, status-warn `#fbbf24`, status-err `#fb7185`, status-info `#22d3ee`. Fonts: sans=Inter, mono=JetBrains Mono. Radius 3/8/12px, spacing 4/8/16px. Respect prefers-reduced-motion. Every panel I request next must match this system exactly."

---

## 3. Claude Design'a Kurulum Planı — YOL B: Manuel token-prompt (fallback)

GitHub-inherit çalışmazsa (repo private + connector yok, veya extract yanlış palette verirse), design-system tek bir **manuel setup prompt**'uyla kurulur. Bu prompt oturumun ilk mesajı olur; hiçbir panel üretmez, sadece token sözleşmesini kaydeder.

### 3.1 Manuel setup prompt taslağı (kopyala-yapıştır)
> "Set up a reusable design system named 'ollamas' for every panel in this session. Do NOT design a screen yet — just lock these tokens. Theme is dark-first, immersive developer-cockpit, with a light variant. Use CSS variables / a token layer, not hardcoded per-component colors, and NEVER use Tailwind `dark:` prefixes (theme flips via one `[data-theme]` attribute).
>
> **DARK palette:** bg-base `#050608`, bg-sidebar `#08090d`, bg-panel `#0a0b10`, bg-inset `#04050a`; border-subtle `rgba(255,255,255,0.05)`, border-strong `rgba(255,255,255,0.10)`; text-bright `#f8fafc`, text-muted `#94a3b8`, text-dim `#97a4b8`; accent-indigo `#6366f1`, accent-emerald `#10b981`; status-accent `#818cf8`, status-ok `#34d399`, status-warn `#fbbf24`, status-err `#fb7185`, status-info `#22d3ee`.
>
> **LIGHT palette (`[data-theme=light]`):** bg-base `#ffffff`, bg-sidebar `#f8fafc`, bg-panel `#f1f5f9`, bg-inset `#e2e8f0`; border-subtle `rgba(15,23,42,0.08)`, border-strong `rgba(15,23,42,0.14)`; text-bright `#0f172a`, text-muted `#475569`, text-dim `#586477`; accent-indigo `#4f46e5`, accent-emerald `#059669`; status-accent `#4f46e5`, status-ok `#065f46`, status-warn `#92400e`, status-err `#be123c`, status-info `#155e75`.
>
> **Type:** sans = Inter (fallback -apple-system, Segoe UI, Roboto, sans-serif); mono = JetBrains Mono (fallback Fira Code, ui-monospace, Menlo, monospace).
> **Radius:** sm 3px, md 8px, lg 12px. **Spacing scale:** 4px, 8px, 12px, 16px.
> **Motion:** fade-in 0.25s cubic-bezier(0.16,1,0.3,1); skeleton shimmer 1.4s; scrollbar thin (6px) with indigo hover. Respect `prefers-reduced-motion: reduce`.
> **Accessibility:** WCAG AA contrast, visible focus rings, ARIA on interactive lists.
>
> Confirm this system is saved. From now on, when I ask for a panel, apply this system and I will remind you with 'match ollamas design system'."

### 3.2 tokens.snippet.css (brief'e gömülebilir — kaynak `src/styles/tokens.css`)
Panel prompt'una ekstra kesinlik için gömülecek alt-küme (isteğe bağlı, YOL B'de faydalı):
```css
:root {
  --bg-base:#050608; --bg-sidebar:#08090d; --bg-panel:#0a0b10; --bg-inset:#04050a;
  --border-subtle:rgba(255,255,255,.05); --text-bright:#f8fafc; --text-muted:#94a3b8;
  --accent-indigo:#6366f1; --accent-emerald:#10b981;
  --status-ok:#34d399; --status-warn:#fbbf24; --status-err:#fb7185; --status-info:#22d3ee;
  --font-sans:"Inter",sans-serif; --font-mono:"JetBrains Mono",monospace;
  --radius-md:8px; --space-4:16px;
}
[data-theme="light"]{
  --bg-base:#ffffff; --bg-sidebar:#f8fafc; --bg-panel:#f1f5f9; --bg-inset:#e2e8f0;
  --text-bright:#0f172a; --text-muted:#475569;
  --accent-indigo:#4f46e5; --accent-emerald:#059669;
  --status-ok:#065f46; --status-warn:#92400e; --status-err:#be123c; --status-info:#155e75;
}
```
> **Uyarı:** bu snippet prefix'siz (`--bg-base`) — Claude Design'ın okuması için sadeleştirilmiş. Gerçek kod `--ollamas-*` prefix'lidir; handoff'ta remap `03-...md §3` `tokens.snippet.css` + HANDOFF.md "mock→real map" ile yapılır.

---

## 4. Tutarlılık-Guard (her panelde tekrar edilecek)

8 panel brief'i (`03-...md §3.1–3.8`) Claude Design'a verilirken, her PROMPT'un **başına** şu tek satır eklenir:

> **"Match the ollamas design system set up earlier (dark #0a0b10 panel / #6366f1 indigo accent, Inter + JetBrains Mono, `[data-theme]` light variant, no `dark:` prefixes)."**

Ek guard kuralları:
1. **Her panel için dark + light** iki screenshot iste (`03-...md` bundle: `screenshot.png` + `screenshot-light.png`).
2. **4-durum zorunlu** her panelde (boş/yükleniyor/hata/başarı — `03-...md §2` kriter 2).
3. **Yeni renk yasak:** panel-özel renk gerekiyorsa mevcut `status-*` çipinden türet (ör. triage-etiketi = `status-accent/warn/ok`), yeni hex uydurma.
4. **font-mono** sadece kod/id/latency/metrik için (chat trace, terminal, model tok/s); gövde metni `font-sans`.
5. **Handoff'ta doğrula:** her `design.html` export'unda accent gerçekten `#6366f1` mi? Değilse HANDOFF.md `mock→real map`'e drift not düş.

---

## 5. Kabul Kriteri (bu belge DONE sayılır ancak)

- [x] Mevcut token envanteri **koda karşı** çıkarıldı (dosya:satır + gerçek hex/font — §1).
- [x] DARK + LIGHT paletlerinin **ikisi de** tabloландı (§1.2, §1.3).
- [x] Kurulum **YOL A (GitHub-inherit)** + **YOL B (manuel prompt)** ikisi de yazıldı (§2, §3).
- [x] Manuel fallback prompt **gerçek değerlerle** hazır (kopyala-yapıştır — §3.1).
- [x] Tutarlılık-guard tek-satır + 5 kural tanımlandı (§4).
- [x] Kör-Nokta Ledger ≥ 5 kayıt (§6).
- [ ] **(Emre çalıştırır)** Claude Design'da setup uygulandı + ilk panel (chat, `03-...md §3.1`) ile drift-test yapıldı → şablon kalibre (K1, K3).

**Nihai kabul (runtime):** Claude Design oturumunda üretilen herhangi iki panelin export'unda `bg-panel`, `accent-indigo`, `font-mono` **birebir aynı** → design-system-first tutarlılık sağlandı. Fark varsa → §4 guard sıkılaştır veya YOL B'ye geç.

---

## 6. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| K1 | **BİLİNMEYEN** | GitHub-inherit'in `tokens/*.json` + Tailwind v4 `@theme`'i ne kadar sadık extract ettiği doğrulanmadı (playbook "otomatik extract" der ama v4 inline-theme edge-case). | YOL A yanlış palette verebilir | §2.2 adım 4 zorunlu doğrulama; eşleşmezse §3 manuel override |
| K2 | **RİSK** | `adobemre1/ollamas` (origin) **public mi bilinmiyor**. Private ise GitHub-inherit connector-auth gerektirir veya çalışmaz. | YOL A bloke | T0: repo görünürlüğü kontrol; private→public VEYA doğrudan YOL B |
| K3 | **RİSK** | Claude Design **inline CSS** üretir, `--ollamas-*` değişkeni veya Tailwind v4 `@theme` sözdizimi ÜRETMEZ (03-...md K2 ile aynı). ollamas'ta `tailwind.config.js` yok, tema `@theme` inline. | Handoff'ta manuel token-remap zorunlu | Her HANDOFF.md'ye `mock→real map` + `tokens.snippet.css` (§3.2); Claude Code implementasyonда inline→`bg-immersive-*` utility çevirisi |
| K4 | **VARSAYIM** | Claude Design "design-system kaydı" oturum-boyu kalıcı (bir setup → çok panel). Gerçekte her yeni chat sıfırlanabilir. | Panel'ler drift eder | Tüm 8 paneli **tek oturumda** üret; oturum koparsa §3.1 setup'ı yeniden gönder + §4 guard her panelde tekrar |
| K5 | **VARSAYIM** | Light-palette `status-*` değerleri (koyulaştırılmış, `#065f46` vb.) Claude Design tarafından "yanlışlıkla dark ile aynı" üretilebilir; light AA kontrastı bozulur. | Light varyant WCAG-altı | §3.1'de light paleti **ayrı ve açık** verildi; her panelde light screenshot ile kontrast göz-denetimi |
| K6 | **BİLİNMEYEN** | `text-dim` dark `#97a4b8` vs `text-muted` `#94a3b8` neredeyse aynı (3 birim fark) — Claude Design ikisini ayırt edemeyebilir/birleştirebilir. | Küçük hiyerarşi kaybı | Düşük etki; kabul edilebilir. Gerekirse dim'i sadece meta-satırlara sınırla |
| K7 | **RİSK** | `outputReferences:true` (config:16) → `tokens.css`'te bazı değerler `var(...)` referansı olabilir; bu belgedeki tablo düz-hex çözülmüş halini varsayar (okunanlar düz hex'ti, ama gelecekte referans eklenirse tablo eskir). | Token tablosu stale | Token değişince bu belgeyi `npm run tokens` çıktısından yenile; memory'ye güvenme |

---

**Sonraki adım (devir):** Bu belge design-system'i Claude Design'a **kurma** planıdır. Kurulum tamamlanınca panel-bazlı üretim `03-claude-design-ui.md §3.1–3.8` brief'leriyle, `04-handoff-protocol.md` bundle-şemasıyla ve `design-execution/panels/` altındaki panel-özel dosyalarla devam eder. Bu belge = **ön-koşul**, panel üretimi değil.
