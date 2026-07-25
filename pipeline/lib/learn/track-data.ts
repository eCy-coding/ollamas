// track: data — JSON indeksleri, SQLite şeması ve arama skorlaması.
//
// Bu izlek "veriyi nasıl saklarsan sorgusu ucuz olur" sorusuna bakar. Kapsül indeksi, brain
// veritabanı ve gömme vektörleri aynı tasarım baskısı altında: **aynı cevabı daha az baytla
// ver**. Kaynak çapası SQLite dokümanı ve W3Schools SQL sıralaması.
import type { Construct } from "./types";

const SQLITE = "sqlite";
const W3 = "w3schools";
const DEVDOCS = "devdocs";

/** Veri katmanı: JSON/JSONL indeksleri, veritabanına dokunan sunucu modülleri, skorlayıcılar. */
const DATAFILES = /(\.(json|jsonl)$|(^|\/)db\.ts$|(^|\/)brain-[a-z-]+\.ts$|capsules\.py$|(^|\/)(cckb|learnkb)$)/;

export const DATA: Construct[] = [
  {
    id: "data-json-index",
    track: "data",
    title: "JSON indeks — makine tüketicisi için tek dosya",
    level: "temel",
    source: W3,
    url: "https://www.sqlite.org/json1.html",
    pattern: /^\s*"(generated|count|items|constructs|capsules|commands)":/m,
    files: /\.json$/,
    what:
      "Bir JSON indeksi, pahalı bir hesabın önceden yapılmış hâlidir. Üstünde `generated` damgası ve sayaç bulunması, tüketicinin dosyanın taze olup olmadığını AÇMADAN anlamasını sağlar.",
    whyHere:
      "Kapsül indeksi 219 notun özetini tek dosyada tutar; `learnkb ask` bu dosyayı okur ve hiçbir ağ çağrısı yapmaz. brain kapalıyken bile çalışmasının tek nedeni budur — indeks, servisin yerine geçen kopyadır.",
    exercise:
      "`_index/cc-capsules.json` boyutunu ölç ve tek bir `recall k=4` yanıtının (26,6 kB) kaç katı olduğunu hesapla. Hangisi daha çok bilgi taşıyor?",
    recipe: {
      id: "data-json-index",
      lang: "python",
      code:
        "import json, os\n"
        + "p = os.path.expanduser('~/ollamas-vault/_index/cc-capsules.json')\n"
        + "d = json.load(open(p, encoding='utf-8'))\n"
        + "print('alanlar:%s kapsul-var:%s' % (','.join(sorted(k for k in d if k != 'capsules')), 'capsules' in d))",
      expect: "kapsul-var:True",
      safety: "safe",
    },
    related: ["js-json", "py-json"],
  },
  {
    id: "data-jsonl",
    track: "data",
    title: "JSONL — satır başına bir kayıt",
    level: "orta",
    source: DEVDOCS,
    url: "https://jsonlines.org/",
    pattern: /^\{"[^"]+":/m,
    files: /\.jsonl$/,
    what:
      "JSONL'de her satır bağımsız bir JSON nesnesidir. Dosyaya ekleme yapmak tek `append` işlemidir (tüm diziyi yeniden yazmak gerekmez) ve bozuk bir satır yalnız kendini kaybettirir, dosyanın tamamını değil.",
    whyHere:
      "Öğrenme kayıtları ve geçmiş bu biçimde tutulur çünkü sürekli EKLENİR. Aynı veri tek bir JSON dizisi olsaydı her ekleme dosyanın tamamını yeniden yazar ve eşzamanlı iki yazıcı birbirini ezerdi.",
    exercise:
      "1000 kayıtlık bir JSONL'e ekleme yapmanın maliyeti ile 1000 elemanlı bir JSON dizisine ekleme maliyetini karşılaştır.",
    recipe: {
      id: "data-jsonl",
      lang: "python",
      code:
        "import json\n"
        + "satirlar = ['{\"id\": 1}', '{bozuk', '{\"id\": 3}']\n"
        + "ok, hatali = [], 0\n"
        + "for s in satirlar:\n"
        + "    try:\n"
        + "        ok.append(json.loads(s))\n"
        + "    except json.JSONDecodeError:\n"
        + "        hatali += 1\n"
        + "print('okunan:%d bozuk:%d' % (len(ok), hatali))",
      expect: "okunan:2 bozuk:1",
      safety: "safe",
    },
    related: ["data-json-index", "py-try-except"],
  },
  {
    id: "sql-create-table",
    track: "data",
    title: "CREATE TABLE — şema ve kısıtlar",
    level: "temel",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_createtable.html",
    pattern: /CREATE TABLE( IF NOT EXISTS)?\s+\w+/i,
    files: DATAFILES,
    what:
      "Şema, verinin sözleşmesidir: `PRIMARY KEY` benzersizliği, `NOT NULL` zorunluluğu veritabanı düzeyinde garanti eder. `IF NOT EXISTS` ile yazılan şema, betiğin her açılışta güvenle koşmasını sağlar (idempotent göç).",
    whyHere:
      "brain şeması her sunucu açılışında `IF NOT EXISTS` ile kurulur. Ayrı bir göç adımı olmadığı için kurulum tek komuttur; bedeli, şema değişikliklerinin elle `ALTER TABLE` gerektirmesidir — bilinçli bir denge.",
    exercise:
      "`IF NOT EXISTS` olmadan sunucuyu iki kez başlat. İkinci açılışta hangi hata gelir?",
    recipe: {
      id: "sql-create-table",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "for _ in range(2):\n"
        + "    c.execute('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)')\n"
        + "print('idempotent:True sutun:%d' % len(c.execute('PRAGMA table_info(notes)').fetchall()))",
      expect: "idempotent:True sutun:2",
      safety: "safe",
    },
    related: ["sql-upsert", "sql-index"],
  },
  {
    id: "sql-select",
    track: "data",
    title: "SELECT — süzme, sıralama ve sayma",
    level: "temel",
    source: W3,
    url: "https://www.sqlite.org/lang_select.html",
    pattern: /SELECT\s+[\w*(),\s]+\s+FROM\s+\w+/i,
    files: DATAFILES,
    what:
      "`SELECT ... WHERE ... ORDER BY ... LIMIT` dört adımdır ve sırası önemlidir: önce süz, sonra sırala, sonra kes. `SELECT *` yazmak kolaydır ama şema değişince sessizce fazladan sütun taşır.",
    whyHere:
      "Sayaç sorguları (`SELECT COUNT(*) AS n FROM ...`) sağlık kapılarının veri tarafıdır: 'kaç not var' sorusu tek satırda yanıtlanır ve bu sayı rapora yazılır. Sayıyı uygulamada hesaplamak, aynı sonucu daha fazla bellekle üretmek olurdu.",
    exercise:
      "`LIMIT` olmadan büyük bir tabloyu sırala ve süreyi ölç. `LIMIT 10` eklediğinde SQLite hangi işi atlar?",
    recipe: {
      id: "sql-select",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id TEXT, hits INT)')\n"
        + "c.executemany('INSERT INTO n VALUES (?,?)', [('a', 5), ('b', 9), ('c', 1)])\n"
        + "top = c.execute('SELECT id FROM n ORDER BY hits DESC LIMIT 1').fetchone()[0]\n"
        + "cnt = c.execute('SELECT COUNT(*) AS n FROM n').fetchone()[0]\n"
        + "print('en-cok:%s toplam:%d' % (top, cnt))",
      expect: "en-cok:b toplam:3",
      safety: "safe",
    },
    related: ["sql-index", "sql-params"],
  },
  {
    id: "sql-params",
    track: "data",
    title: "Hazır ifadeler (`prepare`) ve SQL enjeksiyonu",
    level: "ileri",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_expr.html#varparam",
    pattern: /\.prepare\(|\?\s*\)|executemany\(/,
    files: DATAFILES,
    what:
      "Parametreli sorguda değer, SQL metnine GÖMÜLMEZ; ayrı kanaldan gider. Bu yüzden `'; DROP TABLE` gibi bir girdi veri olarak kalır, komut olmaz. Ayrıca aynı ifade tekrar tekrar kullanıldığında yeniden derlenmez.",
    whyHere:
      "Sunucudaki 34 hazır ifadenin hepsi bu biçimdedir. Not id'leri dış dünyadan gelir (API gövdesi); metin birleştirmeyle sorgu kurulsaydı tek bir kötü niyetli id veritabanını silebilirdi.",
    exercise:
      "Bir sorguyu metin birleştirmeyle kur ve id olarak `x' OR '1'='1` gönder. Kaç satır döner?",
    recipe: {
      id: "sql-params",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id TEXT)')\n"
        + "c.executemany('INSERT INTO n VALUES (?)', [('a',), ('b',)])\n"
        + "kotu = \"x' OR '1'='1\"\n"
        + "guvenli = c.execute('SELECT COUNT(*) FROM n WHERE id = ?', (kotu,)).fetchone()[0]\n"
        + "acik = c.execute(\"SELECT COUNT(*) FROM n WHERE id = '%s'\" % kotu).fetchone()[0]\n"
        + "print('parametreli:%d birlestirme:%d' % (guvenli, acik))",
      expect: "parametreli:0 birlestirme:2",
      safety: "safe",
    },
    related: ["sql-select", "node-child-process"],
  },
  {
    id: "sql-index",
    track: "data",
    title: "CREATE INDEX — okuma hızı, yazma bedeli",
    level: "orta",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_createindex.html",
    pattern: /CREATE INDEX|CREATE UNIQUE INDEX/i,
    files: DATAFILES,
    what:
      "İndeks, bir sütuna göre sıralı bir arama yapısı kurar: `WHERE` ve `ORDER BY` hızlanır, her `INSERT` biraz yavaşlar ve dosya büyür. Az okunan bir sütuna indeks koymak net zarardır.",
    whyHere:
      "Yalnız gerçekten sorgulanan sütunlar indekslidir. 'Her ihtimale karşı indeks' yaklaşımı, sürekli yazan bir bellek sisteminde (her etkileşim bir kayıt) yazma maliyetini görünür şekilde artırırdı.",
    exercise:
      "10 bin satırlık bir tabloda indeksli ve indekssiz `WHERE` sorgusunu `EXPLAIN QUERY PLAN` ile karşılaştır.",
    recipe: {
      id: "sql-index",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id TEXT, ns TEXT)')\n"
        + "c.execute('CREATE INDEX idx_ns ON n(ns)')\n"
        + "plan = c.execute(\"EXPLAIN QUERY PLAN SELECT * FROM n WHERE ns = 'default'\").fetchall()\n"
        + "print('indeks-kullanildi:%s' % ('idx_ns' in str(plan)))",
      expect: "indeks-kullanildi:True",
      safety: "safe",
    },
    related: ["sql-select", "data-bm25"],
  },
  {
    id: "sql-upsert",
    track: "data",
    title: "UPSERT — 'varsa güncelle, yoksa ekle' (bu depodaki en pahalı ders)",
    level: "ileri",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_upsert.html",
    pattern: /upsert|ON CONFLICT|INSERT OR REPLACE/i,
    files: DATAFILES,
    what:
      "UPSERT tek işlemde ekler ya da günceller. Anahtarı DETERMİNİSTİK üretmek şarttır: aynı girdi her zaman aynı id'yi vermeli, yoksa 'güncelleme' sessizce KOPYA üretir.",
    whyHere:
      "Vault senkronizasyonu var olan bir id'yi güncellemez, yalnız yeni id ekler. Bu yüzden bir notun gövdesini kalıcı değiştirmenin tek yolu `remember{id, content, ns, tier}` ile UPSERT'tir. Bu öğrenilene kadar footer onarımı bir tekerlekti: dosyaya yazılıyor, sonraki senkronizasyonda brain'in sakladığı eski gövde üstüne yazıyordu.",
    exercise:
      "Bir notu diske yaz, brain'e UPSERT ETME ve 5 dakika bekle. Footer duruyor mu?",
    recipe: {
      id: "sql-upsert",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id TEXT PRIMARY KEY, body TEXT)')\n"
        + "for body in ['ilk', 'guncel']:\n"
        + "    c.execute('INSERT INTO n (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body', ('learn-x', body))\n"
        + "rows = c.execute('SELECT COUNT(*), MAX(body) FROM n').fetchone()\n"
        + "print('satir:%d govde:%s' % rows)",
      expect: "satir:1 govde:guncel",
      safety: "safe",
    },
    related: ["data-content-hash", "agents-upsert-remember"],
  },
  {
    id: "data-content-hash",
    track: "data",
    title: "Deterministik id ve içerik özeti",
    level: "ileri",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_corefunc.html",
    pattern: /content_hash|deterministicId|sha1\(|sha256\(/,
    files: DATAFILES,
    what:
      "Kaydın kimliğini içerikten türetmek (özet) ya da sabit bir anahtardan üretmek, yeniden çalıştırmayı güvenli kılar: aynı girdi aynı satırı günceller, yenisini doğurmaz.",
    whyHere:
      "Köprüler ve olay yayınları bu kuralla idempotenttir. Rastgele UUID kullanılsaydı her yeniden çalıştırma veritabanını kopyalarla şişirir ve recall sonuçları aynı notu üç kez gösterirdi.",
    exercise:
      "Aynı kaydı iki kez üret; id'ler eşit mi? Değilse hangi alan rastgele?",
    recipe: {
      id: "data-content-hash",
      lang: "python",
      code:
        "import hashlib\n"
        + "det = lambda kaynak, anahtar: hashlib.sha1(('%s:%s' % (kaynak, anahtar)).encode()).hexdigest()[:10]\n"
        + "print('ayni:%s' % (det('learn', 'js-regex') == det('learn', 'js-regex')))",
      expect: "ayni:True",
      safety: "safe",
    },
    related: ["sql-upsert", "py-hashlib"],
  },
  {
    id: "data-bm25",
    track: "data",
    title: "BM25 — uzunluk normalizasyonu ve `b` parametresi",
    level: "ileri",
    source: DEVDOCS,
    url: "https://www.sqlite.org/fts5.html#the_bm25_function",
    pattern: /bm25|\bidf\b|b\s*=\s*0\.\d+|avgdl/i,
    files: /(capsules\.py$|(^|\/)(cckb|learnkb)$|\.py$)/,
    what:
      "BM25 bir belgenin sorguya uygunluğunu üç şeyden hesaplar: terim sıklığı, terimin nadirliği (IDF) ve belge uzunluğu. `b` parametresi uzunluk cezasının şiddetidir: 1'e yakın değerler kısa belgeleri kayırır.",
    whyHere:
      "`b=0.75` (yaygın varsayılan) ile 1,2 kB'lık bir taslak, 9,2 kB'lık dolu bir sayfayı yeniyordu — kısa olduğu için. `b=0.15` + logaritmik otorite çarpanı bunu düzeltti. Ders: varsayılan parametre, senin korpusun için doğru olmak zorunda değil.",
    exercise:
      "Aynı sorguda `b=0.75` ve `b=0.15` skorlarını hesapla. Hangi belge kazanıyor?",
    recipe: {
      id: "data-bm25",
      lang: "python",
      code:
        "def skor(tf, dl, avgdl, b, k1=1.2, idf=3.0):\n"
        + "    return idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))\n"
        + "kisa = skor(1, 1200, 5300, 0.75)\n"
        + "uzun = skor(3, 9200, 5300, 0.75)\n"
        + "kisa2 = skor(1, 1200, 5300, 0.15)\n"
        + "uzun2 = skor(3, 9200, 5300, 0.15)\n"
        + "print('b075:%s b015:%s' % ('kisa' if kisa > uzun else 'uzun', 'kisa' if kisa2 > uzun2 else 'uzun'))",
      expect: "b075:kisa b015:uzun",
      safety: "safe",
    },
    related: ["py-math-log", "py-sorted-key", "data-embedding"],
  },
  {
    id: "data-embedding",
    track: "data",
    title: "Gömme vektörleri ve kosinüs benzerliği",
    level: "ileri",
    source: DEVDOCS,
    url: "https://www.sqlite.org/fts5.html",
    pattern: /embedding|cosine|vector|\.vec\b/i,
    files: DATAFILES,
    what:
      "Gömme, metni sayı dizisine çevirir; iki metnin yakınlığı vektörler arasındaki açıyla (kosinüs) ölçülür. Anahtar kelime araması eşanlamlıyı bulamaz, gömme bulur — ama neden bulduğunu açıklayamaz.",
    whyHere:
      "İki katman birlikte kullanılıyor: kapsül BM25'i ucuz ve açıklanabilir, brain gömmesi pahalı ve eşanlamlıya duyarlı. `learnkb ask` önce ucuz olanı dener, `--deep` ile pahalı olana çıkar. Sıra tersine olsaydı her soru bir ağ çağrısı ve 26 kB bağlam demekti.",
    exercise:
      "Aynı soruyu `learnkb ask` ve `learnkb ask --deep` ile sor. Bayt farkı kaç kat, cevap değişti mi?",
    recipe: {
      id: "data-embedding",
      lang: "python",
      code:
        "import math\n"
        + "a, b = [1, 0, 1], [1, 1, 1]\n"
        + "dot = sum(x * y for x, y in zip(a, b))\n"
        + "cos = dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))\n"
        + "print('kosinus:%.3f' % cos)",
      expect: "kosinus:0.816",
      safety: "safe",
    },
    related: ["data-bm25", "agents-capsule-first"],
  },
];
