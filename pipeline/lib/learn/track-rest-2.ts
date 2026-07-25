// dalga 2 — shell · web · data · http-api · md-obsidian · agents izleklerine ek dersler.
//
// Tek dosyada toplandılar çünkü her izleğe düşen ders sayısı az; ayrı dosyalara bölmek
// gezinmeyi kolaylaştırmaz. Hepsi yine ölçülmüş bulguya dayanıyor (probe sayıları plan
// dosyasındaki G2 satırında).
import type { Construct } from "./types";

const MDN = "mdn";
const W3 = "w3schools";
const SQLITE = "sqlite";
const NODE = "nodejs";
const PY = "python";
const OBS = "obsidian-help";
const CC = "claude-code-docs";
const DEVDOCS = "devdocs";

const SHFILES = /(\.sh$|\.command$|\.zsh$|\.bash$)/;
const WEBFILES = /(\.(html|css)$|htmlsite\.ts$|helpsite\.ts$|landing\.(js|css)$)/;
const DATAFILES = /(\.(json|jsonl)$|(^|\/)db\.ts$|(^|\/)brain-[a-z-]+\.ts$|capsules\.py$|(^|\/)(cckb|learnkb)$)/;
const SERVERFILES = /(^|\/)server\/[\w-]+\.ts$/;
const MDFILES = /\.md$/;
const AGENTFILES = /((^|\/)(commands|hooks|agents|skills)\/|SKILL\.md$|settings\.json$|(^|\/)(cckb|learnkb|ecy-[a-z-]+)$|(^|\/)server\/terminal\.ts$|\.py$|\.md$)/;

export const REST_2: Construct[] = [
  /* ------------------------------------------------------------------ shell */
  {
    id: "sh-read-loop",
    track: "shell",
    title: "while read — satır satır güvenli okuma",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_loops.php",
    pattern: /while (IFS=|read )/,
    files: SHFILES,
    what:
      "`while IFS= read -r satir; do ... done` doğru kalıptır: `IFS=` baştaki/sondaki boşluğu korur, `-r` ters eğik çizgiyi kaçış saymaz. İkisi de yoksa dosya yolları ve boşluklu metinler sessizce bozulur.",
    whyHere:
      "URL listesi ve komut çıktısı satır satır işlenir. `-r` olmadan Windows'tan gelmiş ya da kaçış içeren bir satır yanlış yorumlanır ve kapı yanlış URL yoklar — sessiz yanlış negatif.",
    exercise:
      "İçinde `\\n` metni geçen bir satırı `read` ve `read -r` ile oku. Fark ne?",
    recipe: {
      id: "sh-read-loop",
      lang: "bash",
      code:
        "n=0\n"
        + "printf 'a b\\n  c  \\n' | while IFS= read -r s; do n=$((n+1)); done\n"
        + "printf 'satir:%s\\n' \"$(printf 'a b\\n  c  \\n' | wc -l | tr -d ' ')\"",
      expect: "satir:2",
      safety: "safe",
    },
    related: ["sh-loop", "sh-pipe"],
  },
  {
    id: "sh-find",
    track: "shell",
    title: "find — dosya bulmak ve saymak",
    level: "temel",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/",
    pattern: /\bfind [^|\n]* -(name|type|maxdepth)/,
    files: SHFILES,
    what:
      "`find <kök> -name '<desen>'` özyinelemeli arar; deseni TIRNAKLAMAK şart, yoksa kabuk onu bulunduğun dizine göre genişletir ve `find` yanlış argüman alır. `-maxdepth` derinliği sınırlar ve büyük ağaçlarda süreyi düşürür.",
    whyHere:
      "Ders/kapsül sayıları kapıda `find ... | wc -l` ile ölçülür ve üçlü tutarlılık (not = kapsül = tarif) bu sayıya dayanır. Tırnak unutulursa sayı sessizce yanlış çıkar ve kapı yanlış bir eşitliği doğrular.",
    exercise:
      "`find _learn -name learn-*.md` (tırnaksız) ile tırnaklı hâlini karşılaştır. Hangi durumda sayı değişiyor?",
    recipe: {
      id: "sh-find",
      lang: "bash",
      code: "find \"$HOME/ollamas-vault/_learn\" -name 'learn-*.md' -maxdepth 2 | wc -l | tr -d ' ' | xargs printf 'ders:%s\\n'",
      expect: "ders:",
      safety: "safe",
    },
    related: ["sh-pipe", "sh-command-substitution"],
  },
  {
    id: "sh-tee",
    track: "shell",
    title: "tee — hem ekrana hem günlüğe",
    level: "temel",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/pipelines",
    pattern: /\|\s*tee\b/,
    files: SHFILES,
    what:
      "`komut | tee -a dosya` çıktıyı hem STDOUT'a hem dosyaya yazar (`-a` ekler, üzerine yazmaz). Yalnız `>` kullanmak çıktıyı ekrandan siler; yalnız ekrana yazmak ise geçmişi kaybettirir.",
    whyHere:
      "Sağlık turu launchd altında koşar (kimse bakmaz) ama elle de çalıştırılır (bakılır). `tee -a` ikisini birden karşılar; `-a` olmadan her tur önceki günlüğü silerdi ve 'dün ne oldu' sorusu yanıtsız kalırdı.",
    exercise:
      "`tee` ile `tee -a` arasındaki farkı iki kez çalıştırarak göster. Günlük kaç satır?",
    recipe: {
      id: "sh-tee",
      lang: "bash",
      code:
        "L=\"${TMPDIR:-/tmp}/learn-tee-demo.log\"; rm -f \"$L\"\n"
        + "printf 'tur1\\n' | tee -a \"$L\" >/dev/null\n"
        + "printf 'tur2\\n' | tee -a \"$L\" >/dev/null\n"
        + "printf 'satir:%s\\n' \"$(wc -l < \"$L\" | tr -d ' ')\"; rm -f \"$L\"",
      expect: "satir:2",
      safety: "safe",
    },
    related: ["sh-pipe", "sh-launchd"],
  },
  {
    id: "sh-export-env",
    track: "shell",
    title: "export ve PATH — alt süreç ne görüyor",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_variables.php",
    pattern: /^\s*export \w+=/m,
    files: SHFILES,
    what:
      "`export` değişkeni ALT SÜREÇLERE aktarır; `export` olmadan tanımlanan değişken yalnız o kabukta yaşar. `PATH`'i genişletirken mevcut değeri korumak şarttır (`PATH=\"yeni:$PATH\"`), yoksa temel komutlar kaybolur.",
    whyHere:
      "Bu tam olarak canlı yakalanan defektin dersidir: launchd altında sunucu minimal bir `PATH` devralıyordu; izin listesinden geçen `learnkb` (ve aylardır `cckb`) `ENOENT` ile düşüyor, boş çıktı dönüyordu. Çözüm, çocuk sürecin `PATH`'ini genişletmekti — komutun varlığı değil, GÖRÜNÜRLÜĞÜ eksikti.",
    exercise:
      "`env -i /bin/sh -c 'command -v learnkb'` çalıştır. Bulunuyor mu? launchd'nin gördüğü ortam buna ne kadar benziyor?",
    recipe: {
      id: "sh-export-env",
      lang: "bash",
      code:
        "export LEARN_DEMO=1\n"
        + "printf 'gorunur:%s minimal:%s\\n' \"$(sh -c 'echo $LEARN_DEMO')\" \"$(env -i sh -c 'echo ${LEARN_DEMO:-yok}')\"",
      expect: "gorunur:1 minimal:yok",
      safety: "safe",
    },
    related: ["sh-param-default", "agents-allowlist", "node-child-process"],
  },
  {
    id: "sh-date-stamp",
    track: "shell",
    title: "date biçimlendirme — yedek adı ve günlük damgası",
    level: "temel",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/",
    pattern: /date ['"]?\+%/,
    files: SHFILES,
    what:
      "`date +%Y%m%d-%H%M%S` sıralanabilir bir damga üretir. Yerel biçimler (`date`) makine için işe yaramaz; dosya adlarında iki nokta üst üste bazı sistemlerde sorunludur, bu yüzden tire kullanılır.",
    whyHere:
      "Paylaşılan dosyalara dokunmadan önce alınan yedeklerin adı bu damgayı taşır (`terminal-dataset.json.bak-learn-20260725-163802`). Sıralanabilir olması, 'hangi yedek en yenisi' sorusunu `ls` ile yanıtlanabilir kılar.",
    exercise:
      "İki yedek al ve `ls` çıktısında sırayı kontrol et. Damga biçimi bozuk olsaydı hangi yedeği geri yüklerdin?",
    recipe: {
      id: "sh-date-stamp",
      lang: "bash",
      code: "date -u -r 1784998800 +%Y%m%d-%H%M%S",
      expect: "20260725",
      safety: "safe",
    },
    related: ["py-shutil", "sh-lock"],
  },

  /* ------------------------------------------------------------------ web */
  {
    id: "web-form",
    track: "web",
    title: "form, input ve button — varsayılan davranışlar",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Element/form",
    pattern: /<form|<input |<button/,
    files: WEBFILES,
    what:
      "`<button>` bir formun içinde varsayılan olarak `type=\"submit\"`tir ve sayfayı yeniler. Betikle çalışan bir düğme `type=\"button\"` olmalıdır. `<label for=\"id\">` ise yalnız görünüm değil, tıklama alanı ve ekran okuyucu bağıdır.",
    whyHere:
      "Arama kutusu bir `<input>`'tur ve `file://` altında sunucusuz çalışır — form gönderimi yoktur, her şey istemci tarafındadır. `type` verilmeseydi Enter tuşu sayfayı yeniler ve arama sonucu kaybolurdu.",
    exercise:
      "Arama kutusunda Enter'a bas. Sayfa yenileniyor mu? `type` ve `preventDefault` hangisi bunu engelliyor?",
    recipe: {
      id: "web-form",
      lang: "node",
      code:
        "const html = '<form><input id=\"q\" type=\"search\"><button type=\"button\">Ara</button></form>';\n" +
        "const tur = (html.match(/<button type=\"(\\w+)\"/) || [])[1];\n" +
        "console.log('buton:' + tur + ' yenilemez:' + (tur === 'button'));",
      expect: "buton:button yenilemez:true",
      safety: "safe",
    },
    related: ["dom-events", "web-a11y"],
  },
  {
    id: "web-table",
    track: "web",
    title: "HTML tabloları — thead, scope ve taşma",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Element/table",
    pattern: /<table|<thead|<tbody|<th[\s>]/,
    files: WEBFILES,
    what:
      "`<thead>` başlık satırını ayırır; `<th scope=\"col\">` ekran okuyucuya hangi hücrenin hangi sütuna ait olduğunu söyler. Geniş tablolar sayfayı yatay kaydırmamalı — tablo KENDİ kabında (`overflow-x: auto`) kaymalıdır.",
    whyHere:
      "Ders sayfalarının çoğu tablo taşır (kanıt tablosu, kaynak merdiveni). Gövde yatay kayarsa mobilde tüm sayfa bozulur; kural, taşmanın tablonun kendi kabında kalmasıdır.",
    exercise:
      "Dar bir pencerede bir ders sayfası aç. Kayan şey sayfa mı, tablo mu?",
    recipe: {
      id: "web-table",
      lang: "node",
      code:
        "const css = '.tablo-kap{overflow-x:auto} body{overflow-x:hidden}';\n" +
        "console.log('tablo-kayar:' + css.includes('.tablo-kap{overflow-x:auto}') + ' sayfa-kaymaz:' + css.includes('body{overflow-x:hidden}'));",
      expect: "tablo-kayar:true sayfa-kaymaz:true",
      safety: "safe",
    },
    related: ["css-media-query", "md-table"],
  },
  {
    id: "web-details",
    track: "web",
    title: "details / summary — betiksiz açılır bölüm",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Element/details",
    pattern: /<details|<summary/,
    files: WEBFILES,
    what:
      "`<details><summary>Başlık</summary>…</details>` JavaScript OLMADAN açılır-kapanır bir bölüm verir; klavye ve ekran okuyucu desteği tarayıcıdan gelir.",
    whyHere:
      "Kendi açılır bileşenini yazmak, erişilebilirliği baştan üstlenmek demektir (odak yönetimi, `aria-expanded`, Escape). Platform zaten doğru yapıyorsa bileşen yazmamak bir kazanç, tembellik değil.",
    exercise:
      "Bir `<details>` bölümünü klavyeyle aç. Kaç tuş gerekti? Kendi yazdığın bir bileşende aynı davranışı sağlamak kaç satır sürerdi?",
    recipe: {
      id: "web-details",
      lang: "node",
      code:
        "const html = '<details><summary>Kaynaklar</summary><p>MDN</p></details>';\n" +
        "console.log('js-gerekmez:' + (!html.includes('<script>')) + ' etiket:' + (html.match(/<(details|summary)/g) || []).length);",
      expect: "js-gerekmez:true etiket:2",
      safety: "safe",
    },
    related: ["web-semantic", "web-a11y"],
  },
  {
    id: "web-img-alt",
    track: "web",
    title: "img alt — boş alt ile eksik alt farkı",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Element/img#alt",
    pattern: /<img [^>]*alt=/,
    files: WEBFILES,
    what:
      "`alt=\"\"` (boş) ekran okuyucuya 'bu görsel dekoratif, atla' der. `alt` niteliğinin HİÇ olmaması ise okuyucunun dosya adını okumasına yol açar. İkisi aynı şey değildir.",
    whyHere:
      "Site logosu dekoratiftir ve boş `alt` taşır; yanındaki metin zaten adı söyler. Nitelik silinseydi ekran okuyucu 'pwa-icon.svg' diye okurdu — gürültü.",
    exercise:
      "Logodan `alt` niteliğini kaldır ve VoiceOver ile dinle. Ne okunuyor?",
    recipe: {
      id: "web-img-alt",
      lang: "node",
      code:
        "const html = '<img src=\"/pwa-icon.svg\" alt=\"\" width=\"28\">';\n" +
        "const m = html.match(/alt=\"([^\"]*)\"/);\n" +
        "console.log('alt-var:' + Boolean(m) + ' dekoratif:' + (m && m[1] === ''));",
      expect: "alt-var:true dekoratif:true",
      safety: "safe",
    },
    related: ["web-a11y", "web-semantic"],
  },
  {
    id: "css-sticky",
    track: "web",
    title: "position: sticky — kaydıkça yapışan kenar çubuğu",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/CSS/position",
    pattern: /position: *(sticky|fixed)/,
    files: WEBFILES,
    what:
      "`sticky` bir eşiğe (`top: 0`) gelene kadar normal akıştadır, sonra yapışır. Çalışması için `top/bottom` ZORUNLU ve ata elemanda `overflow: hidden` OLMAMALI — sessizce çalışmamasının en yaygın iki nedeni budur.",
    whyHere:
      "Kenar çubuğu ve 'bu sayfada' listesi kaydırma boyunca görünür kalır. `fixed` yerine `sticky` seçilmesinin nedeni: `fixed` öğeyi akıştan çıkarır ve mobil çekmece düzenini bozar.",
    exercise:
      "Kenar çubuğunun atasına `overflow: hidden` ekle. Yapışma çalışıyor mu? Neden hata mesajı yok?",
    recipe: {
      id: "css-sticky",
      lang: "node",
      code:
        "const kural = 'position: sticky; top: 0;';\n" +
        "console.log('esik-var:' + /top:\\s*\\d/.test(kural) + ' calisir:' + (kural.includes('sticky') && /top:/.test(kural)));",
      expect: "esik-var:true calisir:true",
      safety: "safe",
    },
    related: ["css-flex-grid", "css-media-query"],
  },
  {
    id: "css-transition",
    track: "web",
    title: "transition — ve hareketi azaltma tercihi",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/CSS/transition",
    pattern: /transition:|animation:/,
    files: WEBFILES,
    what:
      "`transition` bir özelliğin değişimini zamana yayar. `transform` ve `opacity` ucuzdur (bileşik katman); `width`/`top` animasyonu her karede yeniden düzen hesaplatır. Ayrıca `prefers-reduced-motion` saygı görmelidir.",
    whyHere:
      "Tema geçişi ve çekmece açılışı kısa ve ucuz özelliklerle yapılır. Hareket duyarlılığı olan bir kullanıcı için animasyon bir erişilebilirlik sorunudur — medya sorgusu bunu kapatır.",
    exercise:
      "İşletim sisteminde 'hareketi azalt'ı aç. Site animasyonları duruyor mu?",
    recipe: {
      id: "css-transition",
      lang: "node",
      code:
        "const css = '.kart{transition:transform .2s} @media (prefers-reduced-motion: reduce){.kart{transition:none}}';\n" +
        "console.log('ucuz:' + css.includes('transform') + ' saygili:' + css.includes('prefers-reduced-motion'));",
      expect: "ucuz:true saygili:true",
      safety: "safe",
    },
    related: ["css-dark-mode", "web-a11y"],
  },
  {
    id: "web-rel-attr",
    track: "web",
    title: "rel=noopener ve dış bağlantı güvenliği",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Attributes/rel/noopener",
    pattern: /rel="(noopener|noreferrer|icon|stylesheet)"/,
    files: WEBFILES,
    what:
      "`target=\"_blank\"` ile açılan bir sayfa, `window.opener` üzerinden kaynak sekmeyi yönlendirebilir. `rel=\"noopener\"` bu bağı keser. Modern tarayıcılar varsayılan yapar ama açıkça yazmak eski tarayıcıları da kapsar.",
    whyHere:
      "Her ders bir dış kaynağa bağlanıyor ve bunlar yeni sekmede açılıyor. Çapa sayısı 100'ü aşan bir sitede tek bir eksik `noopener`, en az direnç gösteren yol olur.",
    exercise:
      "Üretilen HTML'de kaç dış bağlantı var ve kaçında `noopener` yok?",
    recipe: {
      id: "web-rel-attr",
      lang: "node",
      code:
        "const html = '<a href=\"https://x\" target=\"_blank\" rel=\"noopener\">k</a><a href=\"https://y\" target=\"_blank\">k2</a>';\n" +
        "const disBag = [...html.matchAll(/<a [^>]*target=\"_blank\"[^>]*>/g)].map((m) => m[0]);\n" +
        "console.log('dis:' + disBag.length + ' korumasiz:' + disBag.filter((a) => !a.includes('noopener')).length);",
      expect: "dis:2 korumasiz:1",
      safety: "safe",
    },
    related: ["web-xss-escape", "web-anchor-link"],
  },

  /* ------------------------------------------------------------------ data */
  {
    id: "sql-transaction",
    track: "data",
    title: "İşlem (transaction) — hep ya da hiç",
    level: "ileri",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_transaction.html",
    pattern: /BEGIN( TRANSACTION)?|COMMIT|transaction\(/i,
    files: DATAFILES,
    what:
      "Bir işlem içindeki yazmalar ya tamamen uygulanır ya hiç uygulanmaz. Ayrıca hız kazancı büyüktür: SQLite'ta 1000 tekil `INSERT` her biri için diske senkron yazar; tek işleme sarılınca bir kez yazar.",
    whyHere:
      "Toplu ingest (yüzlerce not) işleme sarılır. Sarılmasaydı hem yavaş olurdu hem de yarıda kesilen bir tur veritabanını yarım bırakırdı — 'kaç not yazıldı' sorusunun yanıtı belirsizleşirdi.",
    exercise:
      "100 satırı işlemli ve işlemsiz ekle, süreyi karşılaştır. Kaç kat fark var?",
    recipe: {
      id: "sql-transaction",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id INTEGER)')\n"
        + "c.execute('BEGIN')\n"
        + "for i in range(100):\n"
        + "    c.execute('INSERT INTO n VALUES (?)', (i,))\n"
        + "c.execute('COMMIT')\n"
        + "print('satir:%d' % c.execute('SELECT COUNT(*) FROM n').fetchone()[0])",
      expect: "satir:100",
      safety: "safe",
    },
    related: ["sql-upsert", "sql-params"],
  },
  {
    id: "sql-group-by",
    track: "data",
    title: "GROUP BY ve toplama fonksiyonları",
    level: "orta",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_select.html#resultset",
    pattern: /GROUP BY/i,
    files: DATAFILES,
    what:
      "`GROUP BY` satırları kümeler ve `COUNT/SUM/AVG` her küme için tek satır üretir. Süzme sırası önemlidir: `WHERE` gruplamadan ÖNCE, `HAVING` SONRA çalışır.",
    whyHere:
      "'İzlek başına kaç ders', 'katman başına kaç not' gibi rapor sayıları bu şekilde üretilir. Aynı sayıyı uygulamada döngüyle hesaplamak tüm satırları belleğe çekmek demektir.",
    exercise:
      "Aynı raporu `WHERE` ve `HAVING` ile yaz. Hangi durumda sonuç farklı çıkıyor?",
    recipe: {
      id: "sql-group-by",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE d (izlek TEXT)')\n"
        + "c.executemany('INSERT INTO d VALUES (?)', [('js-ts',), ('js-ts',), ('web',)])\n"
        + "r = c.execute('SELECT izlek, COUNT(*) FROM d GROUP BY izlek ORDER BY 2 DESC').fetchall()\n"
        + "print(r)",
      expect: "[('js-ts', 2), ('web', 1)]",
      safety: "safe",
    },
    related: ["sql-select", "sql-index"],
  },
  {
    id: "sql-delete-update",
    track: "data",
    title: "DELETE / UPDATE — WHERE'siz komutun bedeli",
    level: "ileri",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_delete.html",
    pattern: /DELETE FROM|UPDATE [a-z_]+ SET/i,
    files: DATAFILES,
    what:
      "`WHERE` olmadan `DELETE FROM t` tabloyu boşaltır, `UPDATE t SET x=1` her satırı ezer. Bunları çalıştırmadan önce aynı koşulla bir `SELECT COUNT(*)` koşmak, 'kaç satıra dokunacağım' sorusunu ucuza yanıtlar.",
    whyHere:
      "Bu ders bu depoda **canlı bir hatadan** doğdu: `forget{contains:\"deneme\"}` çağrısı tek bir sonda kaydını hedeflerken TÜM brain'de alt-dizi eşleyip **24 hafızayı sildi**. Silinenler deterministik senkronla geri geldi ve `cc-verify` 25/0/0 kaldı, ama kural nettir: **silme koşulunu önce SAY, sonra uygula** ve koşul ayırt edici olsun (id parçası, sıradan bir kelime değil).",
    exercise:
      "Sildiğin koşulu önce `SELECT COUNT(*)` ile çalıştır. Beklediğin sayı mı çıkıyor? Aradaki fark kaç?",
    recipe: {
      id: "sql-delete-update",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE m (id TEXT, body TEXT)')\n"
        + "c.executemany('INSERT INTO m VALUES (?,?)', [('learn:a','dene bunu'),('learn:b','deneme'),('cc:x','deneyim')])\n"
        + "genis = c.execute(\"SELECT COUNT(*) FROM m WHERE body LIKE '%dene%'\").fetchone()[0]\n"
        + "dar = c.execute(\"SELECT COUNT(*) FROM m WHERE id = 'learn:b'\").fetchone()[0]\n"
        + "print('genis-etki:%d dar-etki:%d' % (genis, dar))",
      expect: "genis-etki:3 dar-etki:1",
      safety: "safe",
    },
    related: ["sql-upsert", "sql-params"],
  },
  {
    id: "sql-limit",
    track: "data",
    title: "LIMIT / OFFSET — sınırsız sorgu yoktur",
    level: "temel",
    source: SQLITE,
    url: "https://www.sqlite.org/lang_select.html#limitoffset",
    pattern: /LIMIT [0-9?]/i,
    files: DATAFILES,
    what:
      "`LIMIT n` sonuç sayısını keser. Sıralamasız bir `LIMIT` belirsizdir: hangi n satırın geleceği garanti değildir. `OFFSET` ile sayfalama büyük tablolarda pahalıdır (atlanan satırlar yine taranır).",
    whyHere:
      "recall `k` parametresi bir `LIMIT`'tir ve tavanı vardır. Sınırsız bir arama, 26 kB'lık bir yanıtın 260 kB'a çıkması demek olurdu — token bütçesinin ilk savunma hattı bu tek kelimedir.",
    exercise:
      "`ORDER BY` olmadan `LIMIT 3` çalıştır, sonra indeks ekle ve tekrarla. Dönen satırlar aynı mı?",
    recipe: {
      id: "sql-limit",
      lang: "python",
      code:
        "import sqlite3\n"
        + "c = sqlite3.connect(':memory:')\n"
        + "c.execute('CREATE TABLE n (id INTEGER, skor INTEGER)')\n"
        + "c.executemany('INSERT INTO n VALUES (?,?)', [(1,5),(2,9),(3,7)])\n"
        + "r = [x[0] for x in c.execute('SELECT id FROM n ORDER BY skor DESC LIMIT 2')]\n"
        + "print('ilk2:%s' % r)",
      expect: "ilk2:[2, 3]",
      safety: "safe",
    },
    related: ["sql-select", "agents-token-budget"],
  },

  /* ------------------------------------------------------------------ http-api */
  {
    id: "http-auth",
    track: "http-api",
    title: "Authorization: Bearer — anahtar nerede durur",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Authorization",
    pattern: /Authorization|Bearer /,
    files: SERVERFILES,
    what:
      "Bearer belirteci başlıkta taşınır — URL'de ASLA, çünkü URL'ler günlüklere, tarayıcı geçmişine ve `Referer` başlığına sızar. Belirteç dosyada duruyorsa o dosya sürüm kontrolünün dışında olmalıdır.",
    whyHere:
      "Obsidian Local REST anahtarı `.obsidian/plugins/.../data.json` içindedir ve vault `.gitignore`'unun İLK satırlarındandır — `.gitignore` bilerek `git add`'den ÖNCE yazılmıştır, böylece anahtar ilk commit'e hiç girmedi.",
    exercise:
      "`git log -S 'apiKey'` çalıştır. Anahtar geçmişte hiç görünmüş mü?",
    recipe: {
      id: "http-auth",
      lang: "node",
      code:
        "const url = 'https://127.0.0.1:27124/search?token=SECRET';\n" +
        "const guvenli = { url: 'https://127.0.0.1:27124/search', headers: { Authorization: 'Bearer SECRET' } };\n" +
        "console.log('url-sizdirir:' + url.includes('SECRET') + ' baslik-sizdirmaz:' + !guvenli.url.includes('SECRET'));",
      expect: "url-sizdirir:true baslik-sizdirmaz:true",
      safety: "safe",
    },
    related: ["http-headers", "web-xss-escape"],
  },
  {
    id: "http-req-body",
    track: "http-api",
    title: "İstek gövdesi ve doğrulama",
    level: "orta",
    source: NODE,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Methods/POST",
    pattern: /req\.body/,
    files: SERVERFILES,
    what:
      "Gövde her zaman DIŞ girdidir: alan eksik, tipi yanlış ya da tamamen bozuk olabilir. Doğrulama uçta yapılmalı ve başarısızlık 4xx dönmelidir — 5xx istemciye 'tekrar dene' der ve bozuk istek sonsuza kadar tekrarlanır.",
    whyHere:
      "`remember` ucu `tier` alanını doğruluyor ve geçersizse **400** dönüyor. Bu davranış bu işte canlı görüldü: `tier:\"reference\"` gönderildi, uç 400 verdi ve mesajda geçerli kümeyi yazdı — iyi bir hata mesajı, bir dokümantasyon satırından hızlı öğretti.",
    exercise:
      "Geçersiz bir `tier` ile `remember` çağır. Yanıt kodu ve mesajı ne? Mesaj geçerli seçenekleri sayıyor mu?",
    recipe: {
      id: "http-req-body",
      lang: "node",
      code:
        "const GECERLI = ['core', 'learned', 'procedural', 'episodic', 'working'];\n" +
        "const dogrula = (b) => (GECERLI.includes(b.tier) ? { code: 200 } : { code: 400, error: `invalid tier '${b.tier}' (${GECERLI.join('/')})` });\n" +
        "const r = dogrula({ tier: 'reference' });\n" +
        "console.log(r.code + ' ' + r.error);",
      expect: "400 invalid tier 'reference' (core/learned/procedural/episodic/working)",
      safety: "safe",
    },
    related: ["http-status", "agents-upsert-remember"],
  },
  {
    id: "http-query-params",
    track: "http-api",
    title: "Sorgu parametreleri ve kodlama",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/URLSearchParams",
    pattern: /req\.query|searchParams/,
    files: SERVERFILES,
    what:
      "Sorgu parametreleri her zaman METİNDİR; `?k=5` sunucuda `\"5\"` gelir. Sayıya çevirmeden karşılaştırmak (`q.k > 3`) metin karşılaştırması yapar ve `\"10\" > \"3\"` yanlış çıkar.",
    whyHere:
      "REST arama uçları ve kapı yoklamaları sorgu parametresi kullanır. Metin/sayı karışıklığı, tam da `sort()` dersindeki hatanın HTTP karşılığıdır: sessiz, hata vermeyen, yanlış sıralama.",
    exercise:
      "`?k=10` ve `?k=3` gönderip metin olarak karşılaştır. Hangisi büyük çıkıyor?",
    recipe: {
      id: "http-query-params",
      lang: "node",
      code:
        "const p = new URLSearchParams('k=10&min=3');\n" +
        "const metin = p.get('k') > p.get('min');\n" +
        "const sayi = Number(p.get('k')) > Number(p.get('min'));\n" +
        "console.log('metin:' + metin + ' sayi:' + sayi);",
      expect: "metin:false sayi:true",
      safety: "safe",
    },
    related: ["js-url", "js-array-sort"],
  },
  {
    id: "http-cache-header",
    track: "http-api",
    title: "Cache-Control ve ETag",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Cache-Control",
    pattern: /Cache-Control|ETag/,
    files: SERVERFILES,
    what:
      "`ETag` içeriğin parmak izidir; istemci `If-None-Match` ile geri gönderir ve sunucu değişmemişse **304** döner — gövde hiç aktarılmaz. `Cache-Control: no-cache` 'önbellekleme' değil, 'kullanmadan önce doğrula' demektir.",
    whyHere:
      "Kaynak sürüklenme izleyicisi aynı fikrin ağsız hâlidir: sayfanın iskeletinden bir özet üretip saklarız ve yalnız özet değişince ilgileniriz. Aradaki fark, bizimkinin sunucu iş birliği gerektirmemesi.",
    exercise:
      "Aynı kaynağı iki kez yokla. Özet değişti mi? Değişmediyse hangi işi yapmaktan kurtuldun?",
    recipe: {
      id: "http-cache-header",
      lang: "node",
      code:
        "const { createHash } = require('node:crypto');\n" +
        "const etag = (s) => 'W/\"' + createHash('sha256').update(s).digest('hex').slice(0, 8) + '\"';\n" +
        "const a = etag('sayfa v1'), b = etag('sayfa v1'), c = etag('sayfa v2');\n" +
        "console.log('degismedi:' + (a === b) + ' degisti:' + (a !== c));",
      expect: "degismedi:true degisti:true",
      safety: "safe",
    },
    related: ["data-content-hash", "http-headers"],
  },

  /* ------------------------------------------------------------------ md-obsidian */
  {
    id: "md-list-task",
    track: "md-obsidian",
    title: "Listeler ve görev kutuları",
    level: "temel",
    source: OBS,
    url: "https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax",
    pattern: /^\s*[-*] \[[ x]\]|^\s*[-*] \S/m,
    files: MDFILES,
    what:
      "`- [ ]` açık, `- [x]` kapalı görevdir ve Obsidian bunları sorgulanabilir kılar. İç içe liste için tam iki (ya da dört) boşluk girinti gerekir; tek boşluk bazı işleyicilerde alt liste üretmez.",
    whyHere:
      "Onay kapıları (`- [ ] ONAY:`) bu biçimde yazılır ve otomasyon kutunun işaretli olup olmadığına bakar. Biçim bozulursa otomasyon kapıyı GÖRMEZ ve insan onayı gerektiren bir adım sessizce atlanır.",
    exercise:
      "Bir görev kutusunu `-[ ]` (boşluksuz) yaz. Obsidian kutu olarak gösteriyor mu?",
    recipe: {
      id: "md-list-task",
      lang: "python",
      code:
        "import re\n"
        + "md = '- [ ] ONAY: yayina al\\n- [x] test kosuldu\\n-[ ] bozuk'\n"
        + "gecerli = re.findall(r'^\\s*[-*] \\[([ x])\\]', md, flags=re.M)\n"
        + "print('kutu:%d acik:%d' % (len(gecerli), gecerli.count(' ')))",
      expect: "kutu:2 acik:1",
      safety: "safe",
    },
    related: ["md-heading", "obs-dataview"],
  },
  {
    id: "obs-embed",
    track: "md-obsidian",
    title: "Gömme (`![[...]]`) ve bağlantı farkı",
    level: "orta",
    source: OBS,
    url: "https://help.obsidian.md/Linking+notes+and+files/Embed+files",
    pattern: /!\[\[[^\]]+\]\]/,
    files: MDFILES,
    what:
      "`[[not]]` bağlantı kurar, `![[not]]` içeriği YERİNDE gösterir. Gömme, aynı metnin iki yerde görünmesini sağlar ama tek yerde saklanmasını korur — kopyalamanın alternatifidir.",
    whyHere:
      "Bu tier'ın kuralı 'tek kanonik ders'tir; sistem girişleri dersleri kopyalamaz. Gömme, kopyalamadan göstermenin Obsidian'daki yoludur ve grafik kenarını da korur.",
    exercise:
      "Bir dersi bir sistem sayfasına önce kopyala, sonra göm. Dersi güncelleyince hangisi tazeleniyor?",
    recipe: {
      id: "obs-embed",
      lang: "python",
      code:
        "import re\n"
        + "md = 'bkz [[learn-js-regex]] ve gomulu ![[learn-data-bm25]]'\n"
        + "bag = len(re.findall(r'(?<!!)\\[\\[', md))\n"
        + "gom = len(re.findall(r'!\\[\\[', md))\n"
        + "print('baglanti:%d gomme:%d' % (bag, gom))",
      expect: "baglanti:1 gomme:1",
      safety: "safe",
    },
    related: ["obs-wikilink", "md-body-footer"],
  },

  /* ------------------------------------------------------------------ agents */
  {
    id: "agents-mcp",
    track: "agents",
    title: "MCP sunucusu — araçları dışarıdan bağlamak",
    level: "ileri",
    source: CC,
    url: "https://code.claude.com/docs/en/mcp",
    pattern: /mcpServers|\bMCP\b|mcp__/,
    files: AGENTFILES,
    what:
      "MCP, bir modele araç kümesi sunmanın standart yoludur: sunucu araçları listeler, istemci çağırır. Kazanç, aracın modele değil PROTOKOLE bağlı olmasıdır — aynı sunucu farklı istemcilerle çalışır.",
    whyHere:
      "Yerel yetenekler (vault okuma, kod arama) MCP üzerinden bağlanır; alternatif her istemciye ayrı eklenti yazmaktı. Sınır aynı kalır: MCP bir aracı KULLANILABİLİR yapar, GÜVENLİ yapmaz — izin listesi ve onay kapısı yine gerekir.",
    exercise:
      "`settings.json` içindeki `mcpServers` anahtarlarını listele. Her biri hangi yeteneği ekliyor?",
    recipe: {
      id: "agents-mcp",
      lang: "python",
      code:
        "import json, os\n"
        + "p = os.path.expanduser('~/.claude/settings.json')\n"
        + "d = json.load(open(p, encoding='utf-8'))\n"
        + "print('mcp-anahtari-var:%s' % ('mcpServers' in d))",
      expect: "mcp-anahtari-var:True",
      safety: "safe",
    },
    related: ["agents-allowlist", "agents-hook"],
  },
  {
    id: "agents-progressive-context",
    track: "agents",
    title: "Oturum bağlamı — her oturumun sabit bedeli",
    level: "ileri",
    source: CC,
    url: "https://code.claude.com/docs/en/costs",
    pattern: /SessionStart|--hook|map --hook/,
    files: AGENTFILES,
    what:
      "Oturum başında enjekte edilen her bayt, o oturumdaki HER istekte yeniden ödenir. Bu yüzden başlangıç bağlamı bir özet değil, bir İŞARET olmalıdır: 'şu bilgi var, şöyle sorulur'.",
    whyHere:
      "`cckb map --hook` 468 B, `learnkb map --hook` 135 B. İkisi birlikte ~600 B: hangi bilgi tabanlarının var olduğunu söyler, içeriklerini değil. Kapsül gövdeleri enjekte edilseydi tek başına 200 kB olurdu ve her istekte ödenirdi.",
    exercise:
      "İki hook çıktısını `wc -c` ile ölç. 50 istekli bir oturumda toplam maliyet kaç bayt?",
    recipe: {
      id: "agents-progressive-context",
      lang: "bash",
      code:
        "A=$(\"$HOME/ollamas-vault/_bin/learnkb\" map --hook 2>/dev/null | wc -c | tr -d ' ')\n"
        + "[ \"$A\" -lt 400 ] && printf 'hook-kucuk:%s\\n' \"$A\" || printf 'hook-buyuk:%s\\n' \"$A\"",
      expect: "hook-kucuk:",
      safety: "safe",
    },
    related: ["agents-capsule-first", "agents-token-budget"],
  },
  {
    id: "agents-determinism",
    track: "agents",
    title: "Model çağırmadan önce: sayılabilir çözüm var mı?",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/costs",
    pattern: /deterministik|deterministic|LLM YOK|no LLM/i,
    files: AGENTFILES,
    what:
      "Bir işi model yapabiliyorsa, aynı işi bir fonksiyon da yapabilir mi diye sormak gerekir. Deterministik çözüm ücretsiz, anında, test edilebilir ve tekrar üretilebilirdir; model çözümü hiçbiri değildir.",
    whyHere:
      "Kapsül üreticisi, skorlayıcı, footer onarıcı, envanter tarayıcısı — hepsi LLM'siz. Bunları modele yaptırmak her koşuda farklı çıktı üretir, yani `git diff` anlamını kaybeder ve 'ne değişti' sorusu yanıtlanamaz olur.",
    exercise:
      "Bir üreticiyi iki kez çalıştır ve `diff` al. Boş mu? Aynı işi model yapsaydı diff nasıl görünürdü?",
    recipe: {
      id: "agents-determinism",
      lang: "python",
      code:
        "def ozet(metin, n=40):\n"
        + "    kes = metin[:n]\n"
        + "    i = kes.rfind('. ')\n"
        + "    return kes[:i+1] if i > n * 0.5 else kes\n"
        + "s = 'BM25 skorlamasi. Uzunluk normalizasyonu onemlidir.'\n"
        + "print('deterministik:%s' % (ozet(s) == ozet(s)))",
      expect: "deterministik:True",
      safety: "safe",
    },
    related: ["agents-capsule-first", "agents-quality-set", "py-freq-count"],
  },
];
