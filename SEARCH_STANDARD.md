# ollamas GitHub Arama Standardı (dalga-9)

> Kendini-geliştiren keşif loop'u. ollamas GitHub'ı küratörlü sorgularla arar,
> sonuçları **lisans-sınıflar + sıralar**, eyleme-dönük **görev-listesi digest**'i
> üretir. **Advisory** — asla otomatik eylem yapmaz; insan karar verir.
>
> Kaynak: `server/github-search-standard.ts` (engine) · `/api/github/search/standard` (route)
> · GitHub Arama sekmesi → "Standart Tarama" (UI).

## Çalışma Prensibi (neden böyle)

1. **Sıkı-qualifier > geniş-topic.** `topic:mcp-server` n8n/gemini gürültüsü verir;
   `mcp gateway stars:>100` isabetli. Her sorgu canlı-kalibre edildi: top-6'sı
   (arşiv/lisans-filtre sonrası) konu-dışıysa qualifier sıkılaştırıldı.
2. **Sıralama:** `log2(stars+1) + 4·recency + adopt-fit-bonus − fork-cezası`.
   `log2` → 100k-star dev keskin 300-star lib'i gömmez; `recency` (pushed_at, ~2y
   lineer düşüş) benzer-büyüklükte tazeyi öne alır; adopt-fit permissive'i yükseltir.
   **Archived repo'lar tamamen elenir.**
3. **Lisans-gate (adoption disiplini):** her repo `license.spdx_id`'den sınıflanır —
   permissive (MIT/Apache/BSD/ISC) → **ADOPT** (kopyala+attribution); copyleft
   (GPL/AGPL/LGPL) → **fikir-only**; NOASSERTION/null → **lisans?** (unknown→fikir).
   `orchestration/bin/lib/licenses.ts` kuralını **yansıtır** (import etmez — cross-lane).
4. **Rate-limit disiplini (çekirdek kısıt).** GitHub arama kotası unauth **10/dk**,
   authed 30/dk. Standart = küçük batch (≤8 intent), **15dk digest cache**, intent'ler
   sırayla (45s search-cache paylaşır). **AUTO-DEGRADE:** kalan kota <3 ise erken durur,
   kısmi digest + not döner — asla kör-403'e ateş etmez. Token bağlı → 30/dk (rahat).

## Sürdürülebilir Loop (görev listesi)

- **On-demand:** "Standart Tarama" → digest = o anki görev listesi (neyi adopt et,
  hangi CVE'yi izle, hangi rakibi incele).
- **Cadence:** haftalık manuel çalıştır (dokümante). **Auto-cron YOK** — rate-limit +
  projenin no-auto-poll prensibi. Digest asla oto-PR/oto-adopt yapmaz.
- **Nasıl genişletilir:** `SEARCH_STANDARD` dizisine **tek satır** `SearchIntent` ekle
  (`{id, title, type, query, rationale, category}`). Kalibre et (canlı çalıştır,
  top-6 konu-içi mi), commit et. Kategori string-union açık — yeni kategori serbest.

## Standart İçerik — NE + NEDEN (gerekçe)

| id | tip | kategori | neden (lane/mission) |
|----|-----|----------|----------------------|
| `adopt-mcp-servers` | repos | Adopt·MCP | Gateway tool-catalog'una adopt edilebilir üretim-MCP server'ları. North-Star: MCP gateway. |
| `adopt-mcp-gateway` | repos | Adopt·Gateway | Gateway routing/multiplex/registry desenleri — broker çekirdeği. |
| `competitor-llm-gateway` | repos | Rakip | tools-as-SaaS broker rakip taraması — SWOD konumlama. |
| `security-injection` | repos | Güvenlik | Tool/prompt-injection guardrail teknikleri — hardening lane. |
| `security-mcp` | repos | Güvenlik | MCP-özel güvenlik tarayıcıları — upstream poison-guard'ı besler. |
| `local-model-toolcall` | repos | Yerel model | qwen/ollama tool-calling teknikleri — fleet lane ($0 motor). |
| `dependency-cve` | issues | Bağımlılık | Node ekosisteminde aktif yamalanan CVE'ler — çekirdek-dep nabzı. |
| `zero-dep-techniques` | repos | Zero-dep | npm-runtime-dep'siz saf-TS desenler — zero-dep yasası. |

## Doğrulama

- `vitest run tests/github-search-standard.test.ts` — shape/adopt-fit/score/dedupe/
  archived-filter/category-filter/auto-degrade (10 test).
- Canlı: `curl /api/github/search/standard` → kategori-gruplu, adopt-fit-sınıflı,
  rank'li digest; düşük-kotada kısmi (degraded) digest.

## Kalibrasyon Notu (2026-07-03, dalga-9)

İlk-sürüm canlı kalibrasyonda eleneneler → düzeltilenler:
- `ssrf prevention library ...` → **0 sonuç** (GitHub'da seyrek) → `security-mcp` (`mcp security stars:>30`) ile değiştirildi.
- `express vite zod jose stripe vulnerability in:title` → **0** (issues çoklu-terim AND'ler) → `CVE nodejs in:title state:open` (node-nabzı).
- `prompt injection guardrails stars:>300` → **1** (seyrek) → `prompt injection detection stars:>100` (5 on-topic MIT).
- `zero dependency ... stars:>500` → **0** → `stars:>300` (20 sonuç, dockview/bcrypt.js).

Kural: seyrek/boş sorgu = qualifier gevşet; gürültülü = sıkılaştır. `total` + top-6
konu-uygunluğuna bak.
