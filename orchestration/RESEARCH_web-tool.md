# RESEARCH_web-tool — web_search iyileştirme araştırması (gerçek-zamanlı, ölçümlü)

> `scripts/research-probe.mjs` üretti — projenin **web_search.mjs** aracıyla canlı toplama + ölçüm.
> **Soru:** ollamas web-research tool'unu nasıl daha güvenilir + hızlı yaparız?

## 1. Toplanan kaynaklar (gerçek web, 7)
### « SearXNG self-hosted metasearch JSON API »
- [SearXNG Documentation (2026.6.28+357662d86)](https://docs.searxng.org/) — 2130ch, rendered=false
  - snippet: SearXNG is a free internet metasearch engine which aggregates results from up to 276 search services. Users are neither tracked nor profiled. Additionally, SearXNG can be used over Tor for online anonymity. Get started with SearXNG by using one of the instances listed at searx.space. If you don't trust anyone, you can set up your own, see Installation. features self hosted no user tracking ...
  - özet: Welcome to SearXNG¶ Search without being tracked. SearXNG is a free internet metasearch engine which aggregates results from up to 276 search services. Users are neither tracked nor profiled. Additionally, SearXNG can be
- [Search API - SearXNG Documentation (2026.6.28+8605230eb)](https://docs.searxng.org/dev/search_api.html) — 3234ch, rendered=false
  - snippet: Search API ¶ SearXNG supports querying via a simple HTTP API. Two endpoints, / and /search, are supported for both GET and POST methods. The GET method expects parameters as URL query parameters, while the POST method expects parameters as form data. If you want to consume the results as JSON, CSV, or RSS, you need to set the format parameter accordingly. Supported formats are defined in ...
  - özet: Search API¶ SearXNG supports querying via a simple HTTP API. Two endpoints, / and /search, are supported for both GET and POST methods. The GET method expects parameters as URL query parameters, while the POST method exp

### « Brave Search API free tier developer json »
- [Brave Search API](https://brave.com/search/api/) — 6000ch, rendered=false
  - snippet: The Brave Search API is a developer tool for building applications with data from the Web. It's powered by Brave's independent Web index, the same index that powers Brave Search.
  - özet: Plans Search The real-time search data your chatbots & agents need to generate answers. Complete search results (URLs, text, news, images, and more), with additional LLM context optimized for AI. $5 per 1,000 requests Ge
- [Documentation - Brave Search API](https://api-dashboard.search.brave.com/documentation) — 2181ch, rendered=false
  - snippet: Built from the ground up without relying on Google or Bing, our API delivers unbiased, high-quality search results for your applications. With comprehensive coverage across web search, news, images, videos, and advanced AI capabilities, the Brave Search API provides everything you need to build privacy-respecting search experiences.
  - özet: Documentation Privacy-first search infrastructure for developers The Brave Search API gives you access to the same powerful, independent search index that powers Brave Search - the privacy-first search engine trusted by 

### « mozilla readability npm extract article main content »
- [Extracting article or blogpost content with Mozilla Readability ...](https://webcrawlerapi.com/blog/how-to-extract-article-or-blogpost-content-in-js-using-readabilityjs) — 6000ch, rendered=false
  - snippet: Extract clean article content from any web page using Mozilla's Readability library—the same algorithm that powers Firefox Reader View. Complete JavaScript code ...
  - özet: JSTutorialExtracting article or blogpost content with Mozilla ReadabilityExtract clean article content from any web page using Mozilla's Readability library—the same algorithm that powers Firefox Reader View. Complete Ja

### « when to use puppeteer render vs http fetch javascript scraping »
- [How to scrape data from dynamic content loaded with JavaScript ...](https://webscraping.ai/faq/puppeteer/how-to-scrape-data-from-dynamic-content-loaded-with-javascript) — 6000ch, rendered=false
  - snippet: Learn how to scrape JavaScript-rendered content using Puppeteer, Playwright, and WebScraping.AI with practical examples and best practices.
  - özet: How to Scrape Data from Dynamic Content Loaded with JavaScript? Modern web applications heavily rely on JavaScript to dynamically load and render content. Unlike static HTML pages, these dynamic websites pose unique chal

### « p-limit nodejs parallel concurrent fetch throttle »
- [GitHub - sindresorhus/p-limit: Run multiple promise-returning & async ...](https://github.com/sindresorhus/p-limit) — 6000ch, rendered=false
  - snippet: p-limit Run multiple promise-returning & async functions with limited concurrency Works in Node.js and browsers.
  - özet: sindresorhus / p-limit Public Uh oh! There was an error while loading. Please reload this page. Notifications You must be signed in to change notification settings Fork 133 Star 2.9k mainBranchesTagsGo to fileCodeOpen mo

## 2. Collection trace (sonuçlar NASIL toplandı — ölçüm)
- 5 sorgu → 7 sayfa fetch, 3 başarısız.
- Zaman: search Σ 6907ms · fetch Σ 7117ms (maks tek fetch 1614ms).
- Host dağılımı: docs.searxng.org×2, brave.com×1, api-dashboard.search.brave.com×1, webcrawlerapi.com×1, www.npmjs.com×2, medium.com×1, webscraping.ai×1, github.com×1.
- Render kullanımı: tümü HTTP (rendered=false) — bu kaynaklarda JS-render gerekmedi.

## 3. Verimlilik notları (ölçüme dayalı → web_search.mjs backlog)
- Toplam 7 kaynak · 5 sorgu · 7 fetch · 3 başarısız.
- Zaman: search Σ6907ms · fetch Σ7117ms (maks 1614ms).
- PARALLEL-FETCH: fetch'ler SERİ koşuyor; paralel olsa ~4.4× hızlanma (Σ7117ms → ~1614ms). Öneri: p-limit(4) ile eşzamanlı fetch.
- CACHE: tekrar eden host: docs.searxng.org×2, www.npmjs.com×2. Öneri: URL+sorgu → içerik-hash LRU cache (tekrar fetch ~0ms).
- SNIPPET-YETERLİLİĞİ: 9/7 sonuçta snippet ≥120ch → "snippet yeterliyse fetch'i atla" heuristic'i fetch sayısını azaltır.
- RENDER: tüm fetch'ler HTTP (rendered=false) yeterliydi → render sabit değil, OTOMATİK tetik: text<300ch ise render-retry (boş statik/SPA tespiti).
- ROBUSTLUK: 3 başarısız → retry(1)+jitter, per-host timeout; DDG-scrape bloklanırsa SearXNG/Brave-API fallback (araştırma bulgusu).

## 4. Araştırma bulgusu (backend/extraction — kaynaklardan)
- **Search backend:** DDG-HTML-scrape ücretsiz/anahtarsız ama bloklanabilir → **SearXNG** (self-host, JSON API) ya da **Brave Search API** (ücretsiz tier) daha güvenilir/yapısal.
- **Extraction:** mevcut jsdom main-content iyi; **@mozilla/readability** makale-çıkarımında daha isabetli (boilerplate temizliği).
- **Hız:** seri fetch darboğaz → **paralel (p-limit)** + **cache** + **snippet-yeterse-atla** en yüksek kazanç.
