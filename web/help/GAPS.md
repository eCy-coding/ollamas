# Eksikler — referanslarda olup bizim yardımda olmayanlar

> Referans sayfalarında görülüp **ollamas / eCym / obsidian** için eksik kalan yetenekler. Her satır kaynağa etiketli. Bekleyen eksikler **paralel planlayıcı yapay zekâlara** havale edilir; alındığında `Planlayan` dolar.

**Toplam:** 13 · **bekleyen:** 0 · **planlanan:** 13

| Sistem | Alan | Önem | Kanıt | Planlayan | Plan |
|--------|------|------|-------|-----------|------|
| ollamas | quickstart | 🔴 yüksek | code.claude.com/docs quickstart numaralı Step 1…N akışı sunuyor; ollamas'ın 'kur → ilk `ollamas` komutu → ilk sonuç' akışı web sayfası olarak yok. | planner-ollamas | KAPANDI · README §Hızlı başlangıç'tan numaralı ready→dev→doctor akışı quickstart.html'e işlendi |
| ollamas | cli-reference | 🔴 yüksek | Referans docs Komut/Ne-yapar/Örnek tablosu veriyor; ollamas'ın geniş `pipeline/board/orchestra/do` yüzeyi yalnız prose'da. | planner-ollamas | KISMİ · cli.html 9 pipeline/bin komutu tabloda; sıradaki: `ollamas do` + orchestra satırlarını ekle |
| ollamas | api-reference | 🟡 orta | ollamas HTTP uçları (:3000, /api/org/overview, /api/council/solve) yapılandırılmış referans sayfası olarak yok. | planner-ollamas | KAPANDI · api.html doğrulanmış 5 uç (/v1/chat/completions,/mcp,/api/ai/*,/api/brain/ask) tabloda |
| ollamas | troubleshooting | 🔴 yüksek | Kod tabanı GOTCHA notlarıyla dolu (:3000 churn, TR-İ katlama, WAF/404) ama aranabilir bir Sorun-Giderme koleksiyonu değil. | planner-ollamas | KISMİ · servis.html 4-satır gotcha FAQ; sıradaki: CLI_SEYIR_DEFTERI.md E-xxx/N-xxx ile genişlet |
| ecym | quickstart | 🔴 yüksek | code.claude.com quickstart deseni; eCym'in 'qwen3:8b kur → ilk `ecy` komutu' başlangıç akışı web sayfası olarak yok. | planner-ecym | KAPANDI · 3 adım (ollama pull qwen3:8b→ecy-brain --build→ecym) tam, hepsi kopyalanabilir ve kaynağa dayalı |
| ecym | cli-reference | 🔴 yüksek | eCym'in `ecym/ecy-brain/ecy-cmd` yüzeyi Komut/Ne-yapar/Örnek tablosu olarak yok; tetikleyiciler dataset'te gömülü. | planner-ecym | KISMİ · 42/235 komut tabloda; sıradaki: ecym binary env (ECY_YES/ECY_MAX/ECYM_NO_TRACKER) + ecy-cmd Tier1/Tier2 satırları |
| ecym | troubleshooting | 🔴 yüksek | Rota-tutmuyor türü sorunlar tek elle-yazılmış sayfada; gerçek gotcha'lardan FAQ değil. | planner-ecym | KAPANDI · 4 gerçek gotcha (mis-route/ECY_YES/PATH/model) tablolu |
| obsidian | beginner-order | 🔴 yüksek | obsidian.md/help başlangıç→ileri sıralı; bizim obsidian notlarımız (Canvas/.base/çizim) kronolojik, sıralı okuma yok. | planner-obsidian | KAPANDI · genel→quickstart→cizim→sema→kornokta prev/next zinciri README'yi beginner→advanced sıraladı |
| obsidian | cli-reference | 🔴 yüksek | Çizim SYM/şema (`obsidian-sketch.schema.json`) yapılandırılmış referans sayfası olarak yok. | planner-obsidian | KISMİ · sema.html üst-alanlar; sıradaki: obsidian-sketch.md'den 77-komut/9-SYM/177-ayar envanter tablosu ekle |
| obsidian | troubleshooting | 🔴 yüksek | Vault gotcha'ları (brain frontmatter silme, .base groupBy, workspace bellek) Sorun-Giderme koleksiyonu değil. | planner-obsidian | KISMİ · kornokta.html corrections tablosu; sıradaki: obsidian-sketch.md blindSpots SB1–SB7 (severity/status/fix) FAQ ekle |
| ollamas | search | 🔴 yüksek | Referansların hepsinde istemci-taraflı arama var; markdown notlarında yok. | planner-ollamas | KAPANDI · app.js window.__HELP_INDEX__ ile 6 sayfa istemci-taraflı aranıyor, her başlıkta arama kutusu |
| ecym | theme-responsive | ⚪ düşük | Referanslar tema-anahtarı + responsive; markdown export'unda ikisi de yok. | planner-ecym | KAPANDI · styles.css data-theme+prefers-color-scheme, 1000/720px media query, app.js toggle+localStorage no-flash çalışıyor |
| obsidian | machine-index | 🔴 yüksek | code.claude.com /llms.txt makine indeksi yayımlıyor; bizim yardımın sayfa-manifestosu yok. | planner-obsidian | KAPANDI · web/help/llms.txt obsidian sayfalarını bölüm etiketiyle listeliyor |
