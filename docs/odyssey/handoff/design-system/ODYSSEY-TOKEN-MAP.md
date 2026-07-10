# ODYSSEY TOKEN-MAP — eCy Design System → ollamas token zinciri

> Girdi: `colors_and_type.css` (bu bundle). Hedef: `tokens/color.json` + `tokens/scale.json`
> (style-dictionary, prefix `ollamas`) → `npm run tokens`. Bu tablo O-frontend implementasyonunun
> tek çeviri sözleşmesidir (HANDOFF-PIPELINE §1.2 K2-azaltıcı deseni, design-system ölçeğinde).

## 1. Renk köprüsü (eCy semantic → --ollamas-* [ODYSSEY tema])

| eCy token | Değer | ollamas hedef değişken | Not |
|---|---|---|---|
| `--bg-base` | `#050A14` | `--ollamas-color-bg-base` (odyssey) | cockpit `#050608`'in ODYSSEY karşılığı |
| `--bg-surface` | `#0D1B2E` | `--ollamas-color-bg-sidebar` (odyssey) | |
| `--bg-raised` | `#132338` | `--ollamas-color-bg-panel` (odyssey) | |
| `--bg-overlay` | `#1A2E47` | `--ollamas-color-bg-inset` (odyssey) | rol-uyarlama: overlay→inset |
| `--fg-primary` | `#F0F4FF` (neutral-50) | `--ollamas-color-text-bright` | |
| `--fg-secondary` | `#8A9BB0` (neutral-300) | `--ollamas-color-text-muted` | |
| `--fg-tertiary` | `#6E859E→#536882` | `--ollamas-color-text-dim` | eCy fg-tertiary=neutral-400; disabled=600 |
| `--fg-accent` / cyan-300 | `#00D4FF` | `--ollamas-color-status-accent` (odyssey) | mevcut indigo `#818cf8` yerine cyan |
| violet-400 | `#7B5EA7` | `--ollamas-color-accent-violet` (YENİ) | ikincil aksan — mevcut sistemde yok |
| `--color-success` | `#00C896` | `--ollamas-color-status-ok` | |
| `--color-warning` | `#F5A623` | `--ollamas-color-status-warn` | |
| `--color-danger` | `#FF4757` | `--ollamas-color-status-err` | |
| `--color-info` | `#00D4FF` | `--ollamas-color-status-info` | accent ile aynı — bilinçli (eCy) |
| `--border-subtle` | `rgba(255,255,255,.06)` | `--ollamas-color-border-subtle` | mevcut .05 → .06 |
| `--border-default` | `rgba(255,255,255,.10)` | `--ollamas-color-border-strong` | |
| `--border-accent(-strong)` | `rgba(0,212,255,.20/.50)` | `--ollamas-color-border-accent(-strong)` (YENİ) | |

## 2. Tip köprüsü

| eCy | ollamas hedef | Not |
|---|---|---|
| `--font-display: Space Grotesk` | `--ollamas-font-display` (YENİ rol) | başlık/eyebrow/buton |
| `--font-body: DM Sans` | `--ollamas-font-sans` (odyssey) | mevcut Inter'in ODYSSEY karşılığı |
| `--font-mono: JetBrains Mono` | `--ollamas-font-mono` | AYNI — değişiklik yok |
| `--text-xs..6xl` (12→88px) | `tokens/scale.json` type-scale | mevcut skala ile birleştir; 6xl yalnız hero |
| `--fw-*`, `--lh-*`, `--ls-*` | scale.json'a ek | eyebrow deseni: xs/semibold/ls-widest/uppercase |

**Font self-host şartı:** Google `@import` KULLANILMAZ (PWA/offline + Artifact-CSP dersi) —
`public/fonts/{space-grotesk,dm-sans}/*.woff2` + `@font-face`; lisans: ikisi de OFL.

## 3. Spacing / radius / shadow / anim / z

| Küme | Karar |
|---|---|
| `--space-1..32` (4→128) | mevcut 4/8/12/16 ile uyumlu — scale.json'a tam set |
| `--radius-xs..full` (4/8/12/20/28) | mevcut sm3/md8/lg12 → ODYSSEY: xs4/sm8/md12/lg20/xl28 (panel-bazında) |
| `--shadow-low/mid/high/glow*` | scale.json'a; `glow` yalnız accent-vurgu (StatCard deseni) |
| `--ease-*`, `--dur-*` | scale.json'a; `prefers-reduced-motion` guard'ı component katmanında |
| `--z-*` (0..1000) | mevcut z-kullanımıyla çakışma taraması O-frontend Faz-0 RED testi |

## 4. Component-kit eşlemesi (Components.jsx → ollamas)

| eCy kit | ollamas karşılığı | Aksiyon |
|---|---|---|
| `NavBar` | `src/App.tsx` üst-nav | ODYSSEY shell-nav paneline referans (panels/00-shell-nav.md) |
| `Sidebar` (borderLeft-cyan aktif) | tab-listesi | shell-nav redesign girdisi |
| `Badge` (live/building/failed/info) | mevcut pill'ler | durum-pill standardı — 4-tip sözleşmesi |
| `StatCard` (glow) | Cockpit stat kartları | metrik-kart standardı |
| `Btn` (primary/secondary/ghost × sm/md/lg) | dağınık buton stilleri | tek Btn sözleşmesi (a11y: primary=cyan-bg + `#050A14` metin — kontrast 12:1 ✓) |
| `Input` (label/hint/error) | form alanları | form standardı |

## 5. Uygulama sırası (O-frontend, design-execution gate'lerine bağlı)
1. Faz-0 RED: token çakışma/z-index taraması + `npm run tokens` üretim testi.
2. `tokens/color.json`+`scale.json`'a ODYSSEY tema girişleri (bu tablo birebir) → `npm run tokens`.
3. Fontlar self-host + `@font-face`.
4. Panel-panel geçiş: her panel HANDOFF-PIPELINE 7-aşama ile (chat pilot ilk).
