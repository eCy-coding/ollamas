# ODYSSEY handoff bundle — design-system (kaynak: Claude Design "eCy Design System")

> **Kaynak:** claude.ai/design projesi **"eCy Design System"** (projectId `019dd99c-8b53-76bd-ae1b-f3912dcc9b4b`,
> updatedAt 2026-06-21). **İndirme yöntemi:** `DesignSync` tool (`get_file`, canlı) — 2026-07-11.
> **Amaç (Emre direktifi):** Claude Design'da geliştirilenlerin **e2e %100 kullanımı** — ODYSSEY panelleri
> bu design-system'den üretilir/uygulanır (design-execution/01-design-system.md ön-koşulunun ETİ).

## Bundle içeriği (canlı çekilen)

| Dosya | Kaynak-yol (Design projesi) | Rol |
|---|---|---|
| `colors_and_type.css` | `colors_and_type.css` | TAM token seti: cyan/violet dark palet + semantic token + tip skalası + spacing/radius/shadow/anim/z + semantic type-styles |
| `Components.jsx` | `ui_kits/ecy_web/Components.jsx` | Referans component kiti: NavBar/Sidebar/Badge/StatCard/Btn/Input + `ECY_TOKENS` — **Golden Rule: REFERANS, verbatim kopyalanmaz** |
| `UI-KIT-README.md` | `ui_kits/ecy_web/README.md` | Kit kullanım sözleşmesi |
| `ODYSSEY-TOKEN-MAP.md` | (bu bundle'da üretildi) | eCy → ollamas `--ollamas-*` köprü tablosu (O-frontend implementasyon girdisi) |

**İndirilmeyen (bilinçli):** 16 `preview/*.html` kartı + `assets/*.svg` + `_ds_*` altyapı dosyaları — aynı
token setinin render'ları; Design panosunda canlı görüntülenir, implementasyon girdisi değildir. Gerekirse
`DesignSync get_file` ile tek tek çekilir.

## Kritik entegrasyon kuralları
1. **Kaynak-of-truth zinciri bozulmaz** (design-execution/01 §1.1): eCy token'ları `tokens/*.json`'a
   ODYSSEY teması olarak girilir → `npm run tokens` üretir → `--ollamas-*` → `@theme`. **tokens.css'e el yazısı YASAK.**
2. **Palet çelişkisi (T0-notu):** mevcut cockpit `#050608` nötr-siyah vs eCy `#050A14` lacivert-cyan.
   Karar: ODYSSEY panelleri eCy paletiyle; mevcut 21 tab'a dokunulmaz (kademeli geçiş, panel-panel).
3. **Font:** eCy = Space Grotesk (display) + DM Sans (body) + JetBrains Mono. Mevcut ollamas = Inter+JBM.
   ODYSSEY panellerinde eCy fontları; `@import` Google-CDN yerine self-host (`public/fonts/` + `@font-face`) — PWA/offline şartı.
4. **a11y:** V9 dersleri (kontrast tuzakları) — cyan-300 `#00D4FF` koyu zeminde OK; açık-tema türetimi
   token katmanında yapılacak (eCy tek-tema dark; light türetim O-frontend işi, WCAG AA doğrulamalı).
