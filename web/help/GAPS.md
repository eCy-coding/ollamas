# Eksikler — referanslarda olup bizim yardımda olmayanlar

> Referans sayfalarında görülüp **ollamas / eCym / obsidian** için eksik kalan yetenekler. Her satır kaynağa etiketli. Bekleyen eksikler **paralel planlayıcı yapay zekâlara** havale edilir; alındığında `Planlayan` dolar.

**Toplam:** 16 · **bekleyen:** 0 · **planlanan:** 16

| Sistem | Alan | Önem | Kanıt | Planlayan | Plan |
|--------|------|------|-------|-----------|------|
| ollamas | quickstart | 🔴 yüksek | code.claude.com/docs quickstart numaralı Step 1…N akışı sunuyor; ollamas'ın 'kur → ilk `ollamas` komutu → ilk sonuç' akışı web sayfası olarak yok. | planner-ollamas | KAPANDI · README §Hızlı başlangıç'tan numaralı ready→dev→doctor akışı quickstart.html'e işlendi |
| ollamas | cli-reference | 🔴 yüksek | Referans docs Komut/Ne-yapar/Örnek tablosu veriyor; ollamas'ın geniş `pipeline/board/orchestra/do` yüzeyi yalnız prose'da. | planner-ollamas | KAPANDI · reference/toplevel.html `ollamas tasks`/`do "<id>"`/`doctor`'u kaynak-atıflı tabloluyor (docs/TASKS.md, orchestration/TASKS.json) |
| ollamas | api-reference | 🟡 orta | ollamas HTTP uçları (:3000, /api/org/overview, /api/council/solve) yapılandırılmış referans sayfası olarak yok. | planner-ollamas | KAPANDI · api.html doğrulanmış 5 uç (/v1/chat/completions,/mcp,/api/ai/*,/api/brain/ask) tabloda |
| ollamas | troubleshooting | 🔴 yüksek | Kod tabanı GOTCHA notlarıyla dolu (:3000 churn, TR-İ katlama, WAF/404) ama aranabilir bir Sorun-Giderme koleksiyonu değil. | planner-ollamas | KAPANDI · seyir.html N-040..N-046 gerçek gotcha'ları ÖNLEME kuralıyla listeliyor (cli/CLI_SEYIR_DEFTERI.md) |
| ecym | quickstart | 🔴 yüksek | code.claude.com quickstart deseni; eCym'in 'qwen3:8b kur → ilk `ecy` komutu' başlangıç akışı web sayfası olarak yok. | planner-ecym | KAPANDI · 3 adım (ollama pull qwen3:8b→ecy-brain --build→ecym) tam, hepsi kopyalanabilir ve kaynağa dayalı |
| ecym | cli-reference | 🔴 yüksek | eCym'in `ecym/ecy-brain/ecy-cmd` yüzeyi Komut/Ne-yapar/Örnek tablosu olarak yok; tetikleyiciler dataset'te gömülü. | planner-ecym | KAPANDI · reference/env.html 4 env-var'ı (ECY_YES/ECY_MAX/ECYM_NO_TRACKER/ECY_DATASET) doğru varsayılanlarla tabloluyor, kaynakla birebir doğrulandı |
| ecym | troubleshooting | 🔴 yüksek | Rota-tutmuyor türü sorunlar tek elle-yazılmış sayfada; gerçek gotcha'lardan FAQ değil. | planner-ecym | KAPANDI · 4 gerçek gotcha (mis-route/ECY_YES/PATH/model) tablolu |
| obsidian | beginner-order | 🔴 yüksek | obsidian.md/help başlangıç→ileri sıralı; bizim obsidian notlarımız (Canvas/.base/çizim) kronolojik, sıralı okuma yok. | planner-obsidian | KAPANDI · genel→quickstart→cizim→envanter→sema→kornokta→blindspot prev/next zinciri beginner→advanced sıraladı |
| obsidian | cli-reference | 🔴 yüksek | Çizim SYM/şema (`obsidian-sketch.schema.json`) yapılandırılmış referans sayfası olarak yok. | planner-obsidian | KAPANDI · reference/envanter.html 77 komut/177 ayar/9 SYM/22 karar (SD1–SD22) envanterini canlı tabloluyor (obsidian-sketch.md) |
| obsidian | troubleshooting | 🔴 yüksek | Vault gotcha'ları (brain frontmatter silme, .base groupBy, workspace bellek) Sorun-Giderme koleksiyonu değil. | planner-obsidian | KAPANDI · troubleshooting/blindspot.html SB1–SB7'yi önem/durum/başlık ile tabloluyor (3 çözüldü, 4 açık) |
| ollamas | search | 🔴 yüksek | Referansların hepsinde istemci-taraflı arama var; markdown notlarında yok. | planner-ollamas | KAPANDI · app.js window.__HELP_INDEX__ ile istemci-taraflı arıyor, her başlıkta arama kutusu |
| ecym | theme-responsive | ⚪ düşük | Referanslar tema-anahtarı + responsive; markdown export'unda ikisi de yok. | planner-ecym | KAPANDI · styles.css data-theme+prefers-color-scheme, 1000/720px media query, app.js toggle+localStorage no-flash çalışıyor |
| obsidian | machine-index | 🔴 yüksek | code.claude.com /llms.txt makine indeksi yayımlıyor; bizim yardımın sayfa-manifestosu yok. | planner-obsidian | KAPANDI · web/help/llms.txt obsidian sayfalarını bölüm etiketiyle listeliyor |
| ollamas | troubleshooting-errors | undefined | undefined | planner-ollamas | YENİ (düşük) · seyir.html yalnız N-xxx sürüyor; sıradaki: E-xxx hata kayıtlarını (E-003 vb.) tabloya ekle |
| ecym | cli-coverage | undefined | undefined | planner-ecym | YENİ (düşük) · referans 42/235 komutu kapsıyor; sıradaki: derinleştir + exec_loop çıktı-onay akışını belgele |
| obsidian | schema-desc | undefined | undefined | planner-obsidian | YENİ (düşük) · sema.html 6/10 alan placeholder + İngilizce; sıradaki: schema.json'dan gerçek description türet |
