# HANDOFF-PIPELINE dersleri (cookbook pilot → sonraki paneller okur)

## TS/tsconfig tuzakları (bu repo)
1. **Discriminated-union narrowing:** boolean `ok` alanıyla narrowing ÇALIŞMIYOR → `if ("field" in r)` kullan.
2. **Custom sub-component'e `key` prop → TS2322.** Keyed `<Fragment key=…>` ile sar.
3. **lingui `_` overloaded** → child-prop olarak geçmeden `(id)=>string`e daralt.
4. **react/jsx-runtime "any" uyarıları** = mevcut repo-borcu (tsc geçer, gate=tsc-only) — görmezden gel.

## O0/guard
5. **`/api/modules` guard allowlist'te ZATEN var** → yeni modül 403/404'ü ücretsiz miras alır; guard-test EDİTİ GEREKMEZ.
6. Modül yapısı = `server/modules/demo/` BİREBİR emsal (index/router/service/schema/store.ts + ModuleDef + envFlag).
7. Toggle kanıtı testte: `MODULE_<ID>` unset→404, =1→200 + `enabledModules()` içerir.

## Panel/UI
8. Backend round-trip'i azalt: ilgili çağrıları tek endpoint'e katla (cookbook: hardware+discover→/recommend).
9. **a11y:** SVG-gauge yerine `{n}/100` metin + text-badge (WCAG-AA, screen-reader; V9 dersi).
10. **Token:** design.html'in `:root` eCy/cockpit değişkenlerini COMPONENT-SCOPE taşı; global CSS'e ham-hex YAZMA.
11. **Font:** Space Grotesk/DM Sans Google-@import YASAK (PWA/CSP) → `var(--font-display/mono, fallback)`; shared self-host adımı sonra.
12. Persistence: mümkünse mevcut route reuse (cookbook config→`/api/model-overrides`), modülü server `db`'ye bağlama.

## i18n
13. `src/locales/{en,tr}.ts` EŞİT anahtar sayısı (parity testi var); `<panel>.*` + `app.tab.<id>`.
