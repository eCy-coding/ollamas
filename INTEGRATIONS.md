# ollamas Entegrasyon Doktrini (dalga-11)

> Her entegrasyon: **NASIL bağlanır · NEDEN (lane/mission) · NEREDE (tab/route) · HANGİ AMAÇ**.
> Sağlık/bağlantı tek yerde: **"Entegrasyonlar" sekmesi** (`/api/integrations/health`) —
> 0-paste GitHub bağla butonu + tek-adım fix'ler. Doğrulama Hard Law'lara bağlı
> (gizlilik: veri makineden çıkmaz · zero-dep · $0 · MIT · MCP-mission).

## 0-manuel bağlanma durumu

| Entegrasyon | Manuel adım | Durum |
|-------------|-------------|-------|
| **GitHub** | **0-paste** — "Entegrasyonlar → GitHub'ı otomatik bağla" gh CLI token'ını vault'a çeker | ✅ 0-manuel |
| **MCP (npx)** | yok (Node.js var) | ✅ 0-manuel |
| **Threat feed** | yok (anon RSS/KEV) | ✅ 0-manuel |
| **GitHub Arama/Standart** | yok (GitHub token gelince 30/dk + kod-arama) | ✅ GitHub'a biner |
| **Google ×4** | tarayıcıda tek ‘Sign in with Google’ (zaten yapıldı) | ✅ bağlı |
| **MCP (uvx)** | `brew install uv` (yalnız git/fetch/time için; non-kritik) | ⚠️ 1 opsiyonel |

## Entegrasyonlar — NASIL / NEDEN / NEREDE / AMAÇ

### GitHub (Actions · Arama · Standart · Audit)
- **NASIL:** gh CLI token'ı vault'a otomatik (`POST /api/integrations/github/autoconnect`) veya PAT (`POST /api/keys {provider:github}`). Token `repo` scope'u Actions/kod/log kapsar.
- **NEDEN:** revenue/ops lane — audit-teslimatı GitHub Issue/PR olarak iner; CI görünürlüğü.
- **NEREDE:** "GitHub Actions" (run/log/rerun/dispatch), "GitHub Arama" (repo/issue/kod), Standart Tarama.
- **AMAÇ:** CI'yı kokpitten izle+tetikle; kod/depo ara; **kendini-geliştiren keşif** (adopt-fit görev listesi); paralı audit-deliverable.

### Google — Drive · Sheets · Takvim · Gmail
- **NASIL:** Firebase Google OAuth popup (browser-side). Token her servise scope taşır. **Veri sunucuya girmez** (gizlilik Hard Law).
- **NEDEN:** personal-ops lane — Emre'nin ajanda/e-posta/dosya bağlamı.
- **NEREDE:** ilgili 4 sekme.
- **AMAÇ:** Gelir/Kişisel-Ops'a ajanda + e-posta triyajı; canlı metriği Sheets'e dök; Drive dosya erişimi.

### MCP Katalog (Memory · Filesystem · Everything · Git · Fetch · Time · Sequential-Thinking · Playwright)
- **NASIL:** SaaS Ağ Geçidi → katalog → tek-tık (npx/uvx stdio spawn). upstream-guard command+SSRF allowlist korur.
- **NEDEN:** integrations/MCP lane — North-Star = MCP gateway; ajanlar araç filosunu tüketir.
- **NEREDE:** SaaS Ağ Geçidi (katalog kartları), `/api/saas/upstreams`.
- **AMAÇ:** ReAct ajanına lokal-araç yeteneği (bilgi-grafı hafıza, dosya, git, browser-otomasyon, akıl-yürütme) — hepsi makinede.

### Tehdit Akışı (RSS/Atom/KEV)
- **NASIL:** anon public GET (CISA KEV/Advisories, SANS, THN, Bleeping, P0). Token yok.
- **NEDEN:** security lane — dış eCySearcher'a bağımsız canlı besleme.
- **NEREDE:** Tehdit İstihbaratı sekmesi, `/api/threatfeed`.
- **AMAÇ:** aktif-exploit CVE + güvenlik-haber nabzı; hardening-lane girdisi.

### Generic MCP Consume (mekanizma)
- **NASIL:** `/api/saas/upstreams` herhangi stdio/http MCP server (guard'lı). Katalog = küratörlü alt-küme.
- **AMAÇ:** ollamas'ın **sınırsız** genişleyebilirliği — tüm MCP ekosistemi (bkz. sıralama).

## Bağlanabilir Konnektör Sıralaması (e2e-uyum, gerekçeli)

ollamas generic-MCP-consume ile **sınırsız** bağlanabilir; Hard Law-uyumlu sıra:
- **🥇 TIER-A** (lokal+MIT+hesapsız, katalog-hazır): Sequential-Thinking ✅, Playwright ✅, Memory/Filesystem/Everything ✅, SQLite* (arşivli-resmi→maintained-paket bekliyor)
- **🥈 TIER-B** (self-hosted, kendi altyapında): Postgres-Pro*, Obsidian, Docker*, Redis* (*paket/config doğrulama gerek)
- **🥉 TIER-C** (public-read, kişisel-veri-değil): Context7, Brave/DuckDuckGo Search, Git/Fetch/Time ✅ (uvx)
- **⚠️ TIER-D** (cloud-SaaS, OPT-IN şart — kişisel veri buluta çıkar, Hard Law gerilimi): Notion, Slack, Linear, Supabase, Sentry, Cloudflare — yalnız açık-onay ile

**Ölçüt:** gizlilik(veri-makinede) > lisans(MIT/Apache) > zero-dep/$0 > MCP-native.

## Sürdürülebilir prensip
- Sağlık on-demand (auto-poll yok); GitHub-autoconnect buton-tık (boot-silent-pull değil).
- Yeni entegrasyon: katalog'a giriş VEYA integrations-health probe — tek-nokta, genişletilebilir.
- Cloud-SaaS (TIER-D) asla default; per-connector consent gerekir.
