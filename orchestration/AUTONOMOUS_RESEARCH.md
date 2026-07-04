# AUTONOMOUS_RESEARCH — ollamas agent CANLI otonom web araştırması (fresh :3010 gateway)

> Gerçek LLM ReAct döngüsü :3010 **fresh-registry** gateway'de koştu (deep-default + steering AKTİF).
> Agent **kendi** `web_search` aracıyla araştırdı; Claude Code per-step orkestre ETMEDİ. İki run:
> **(1) cloud gpt-oss:120b** — deep KANITI ve **(2) local qwen3:8b** — uçtan uca TAMAMLANAN run.

## 0. DEEP KANITI (her iki run da otonom deep seçti)
| run | model | web_search | DEEP | PLAIN | kaynak | içerik(char) | cache | render | snippetFallback | sonuç |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ollama-cloud/gpt-oss:120b | 3 | **3** | 0 | 15 | 63,570 | 0 | 1 | 1 | kesildi (cloud kota→401, sentez yok) |
| 2 | ollama-local/qwen3:8b | 2 | **2** | 0 | 10 | 54,922 | 4 | 0 | 0 | **done/complete (VERDICT)** |

İki run da **plain=0** → otonom LLM (hem cloud hem local) **deep'i KENDİ seçti**. Önceki turda agent **hiç deep kullanmıyordu (4 plain)**; schema steering + deep-default **çalıştı**.

## 1a. Sonuçları NASIL topladı — RUN 1 (cloud gpt-oss:120b)
- step1 `web_search` mode=**deep** deep=true top=5 → 5 kaynak / 29,366 char  
  query: « Mozilla Readability algorithm Firefox Reader View core signal main content extraction boilerplate re »  
  kaynaklar: github.com, deepwiki.com, github.com, webcrawlerapi.com, deepwiki.com
- step2 `web_search` mode=**deep** deep=true top=5 → 5 kaynak / 18,101 char  
  query: « arc90 readability original heuristics article main content extraction arc90.com readability »  
  kaynaklar: github.com, codelessgenie.com, ejucovy.github.io, github.com, code.google.com
- step3 `web_search` mode=**deep** deep=true top=5 → 5 kaynak / 16,103 char  
  query: « Boilerpipe text density algorithm article extraction link density boilerpipe »  
  kaynaklar: github.com, github.com, scielo.org.mx, link.springer.com, arxiv.org

## 1b. Sonuçları NASIL topladı — RUN 2 (local qwen3:8b, uçtan uca)
- step1 `web_search` mode=**deep** deep=true top=5 → 5 kaynak / 29,042 char  
  query: « Mozilla Readability algorithm article extraction boilerplate removal arc90 readability heuristics te »  
  kaynaklar: deepwiki.com, webcrawlerapi.com, deepwiki.com, codelessgenie.com, webcrawlerapi.com
- step2 `web_search` mode=**deep** deep=true top=5 → 5 kaynak / 25,880 char  
  query: « trafilatura boilerpipe text density boilerplate removal algorithm »  
  kaynaklar: mbrenndoerfer.com, trafilatura.readthedocs.io, github.com, github.com, arxiv.org

## 2. Agent'ın final araştırma cevabı (RUN 2, tamamlandı)
## 1. Mozilla Readability (the *Readability.js* library)

| Core signal used | What it strips | Source |
|-------------------|----------------|--------|
| **Scoring of DOM nodes** – each candidate node gets a score from a combination of **tag‑type weight**, **class/id weight**, **text length**, **comma count**, and **link‑density**; the score is then propagated up to parent containers. | Removes *unlikely candidates* (elements whose class/id contain words like “comment”, “nav”, “footer”, “sidebar”, “ads”), and strips all `<script>`, `<style>`, `<iframe>`, `<noscript>`, `<header>`, `<footer>`, `<nav>` before scoring. | 【https://deepwiki.com/mozilla/readability/5-content-extraction-process】, 【https://webcrawlerapi.com/blog/what-algorithm-does-readability-use-for-extracting-text-from-urls/】 |
| **Link‑density penalty** – blocks where the ratio of link‑text length to total text length is high are penalised heavily, because navigation/menu blocks are link‑heavy. | Navigation menus, related‑article carousels, social‑share bars (high‑link‑density) are discarded. | Same as above |
| **Parent‑score propagation** – the highest‑scoring leaf’s points are added to its ancestors, so the final “article container” is usually a `<div>`/`<article>` that encloses most of the text. | The final container typically excludes sidebars and footers that sit outside the main hierarchy. | Same as above |

---

## 2. Arc90 Readability heuristics (the original 2009 algorithm)

| Core signal | What it strips | Source |
|-------------|----------------|--------|
| **Class/ID keyword weighting** – positive keywords (`article`, `content`, `post`, `entry`) give a bonus; negative keywords (`nav`, `footer`, `sidebar`, `comment`, `ad`) give a penalty. | Removes elements whose class/id indicate navigation, ads, comments, headers, footers. | 【https://www.codelessgenie.com/blog/what-algorithm-does-readability-use-for-extracting-text-from-urls/】 |
| **Word‑count & punctuation** – longer blocks with more commas are favoured (they look like prose). Very short blocks are ignored. | Filters out tiny blocks (e.g., “Read more…”, button labels). | Same as above |
| **Link‑density** – blocks with a high proportion of linked text are penalised. | Drops menus, sidebars, tag clouds that are link‑heavy. | Same as above |
| **Element depth** – deeper nodes get a small penalty; top‑level containers are preferred. 

## 3. Verimlilik notları (ölçümlü — otonom toplama gözleminden)
- **DEEP otomatik:** her iki run %100 deep (cloud 3/3, local 2/2); tek deep çağrısı ortalama **~5 kaynak / ~20-27K char tam içerik** topladı — plain snippet olsaydı kaynak başı ~150-300 char kalırdı (~10-40× daha az).
- **Cache çalışıyor:** RUN 2 (local), RUN 1'in (cloud) disk-cache'inden **4 kaynağı** yeniden kullandı (TTL 1h) → tekrar-fetch yok, hız.
- **render/snippet-fallback:** auto-render JS sayfalarda devreye girdi (cloud render=1); bloklu/consent-wall kaynaklar snippet'e düştü (cloud snip=1) → kaynak yine katkı verdi (graceful degrade).
- **Capacity:** cloud `gpt-oss:120b` tool-call'ları hızlı/doğru AMA **kota run ortasında tükendi** (key rotasyon→401) → uzun otonom koşular için **yerel tool-capable model (qwen3:8b)** güvenli tamamlıyor; toplama aşaması cloud'da hızlı.
- **Lever UYGULANDI (döngü kapandı):** agent'ın VERDICT'i = **"link-density>0.25 blokları çıkar"**. `extractReadable` boilerplate-strip (aside/figure/role-landmark) + **link-density filtresi** + article-öncelik ile güncellendi → gerçek makalede boilerplate %27.3→%30.0 azaldı (çekirdek içerik korundu), 15/15 test yeşil, deep-demo 19.4× (regresyon yok).
