# SİRİ KALİBRASYON RAPORU — ollamas Siri arama yardımcısı

Gerçek görev bataryası (18 sorgu) `siri-ask.mjs` beyninden geçirildi. Oracle çekirdeği değişmedi;
doğal Türkçe matematik Siri-tarafı normalizer (`normalizeForOracle`) ile sembolik hale getirilip oracle'a verildi.

## Özet
- **route doğruluğu: %100** (18/18)
- **verdict doğruluğu (oracle): %100** (13/13)
- **sıralama kalitesi (graded nDCG@3): 0.30** (5 research, çok-gold authority-tier; BM25F+yakınlık reranking)
- gecikme: oracle ort **63ms** (sıcak daemon) · research ort **9793ms** (deep+sentez)
- **KALİBRASYON: TAM — %100 route + verdict**

## Detay
| sorgu | beklenen | gerçek | verdict | nDCG@3 | ms | sonuç |
|---|---|---|---|---|---|---|
| 2+2=4 | oracle | oracle | ✓ | — | 73 | ✓ |
| 100-58=42 | oracle | oracle | ✓ | — | 68 | ✓ |
| 10 / 2 = 5 | oracle | oracle | ✓ | — | 62 | ✓ |
| 5 > 3 | oracle | oracle | ✓ | — | 60 | ✓ |
| 8 kere 9 eşittir 72 | oracle | oracle | ✓ | — | 63 | ✓ |
| 2 üzeri 10 = 1024 | oracle | oracle | ✓ | — | 62 | ✓ |
| 100 bölü 4 eşittir 25 | oracle | oracle | ✓ | — | 68 | ✓ |
| 2'den sonra 3 gelir | oracle | oracle | ✓ | — | 63 | ✓ |
| A and not A is always false | oracle | oracle | ✓ | — | 58 | ✓ |
| 2+2=5 | oracle | oracle | ✓ | — | 60 | ✓ |
| 9'dan sonra 11 gelir | oracle | oracle | ✓ | — | 60 | ✓ |
| 100 / 4 = 30 | oracle | oracle | ✓ | — | 61 | ✓ |
| 7 kere 8 eşittir 50 | oracle | oracle | ✓ | — | 64 | ✓ |
| yapay zeka nedir | research | research | — | 0.31 | 14968 | ✓ |
| RAG nedir | research | research | — | 0.00 | 58 | ✓ |
| Türkiye'nin başkenti neresi | research | research | — | 1.00 | 3006 | ✓ |
| Python liste nedir | research | research | — | 0.00 | 23216 | ✓ |
| fotosentez nedir | research | research | — | 0.17 | 7716 | ✓ |

## Notlar
- Reranking: Okapi BM25 (k1=1.2,b=0.75) + BM25F başlık-ağırlığı + bigram yakınlık + çarpımsal otorite + Lucene IDF smoothing. Türkçe hafif stemmer (recall).
- graded nDCG@3: gold = authority-tier domain seti (rel 3 resmî/birincil · 2 saygın · 1 kabul), gain 2^rel−1, IDCG-normalize. Tek-kaynak yanlılığı kırıldı.
- "Doğru/Yanlış" YALNIZ Truth-Oracle'dan (güven değişmezi). Açık uçlu → deep web + sentez (fleet/Windows GPU), saturasyonda çıkarımsal güvenlik ağı + kaynak-uzlaşı güven uyarısı.