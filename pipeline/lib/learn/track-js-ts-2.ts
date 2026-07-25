// track: js-ts (dalga 2) — ilk turda atlanan ama kodda YOĞUN kullanılan yapılar.
//
// Dalga 1 kataloğu tek geçişte yazıldı; bu dosya envanterin ikinci taramasında ortaya çıkan
// boşlukları kapatır. Her giriş yine ölçülmüş bir bulguya dayanır (ör. `Math.` 94 dosyada,
// `Date` 92, `switch` 18, `extends Error` 10) — sayı sıfırsa ders yazılmaz.
import type { Construct } from "./types";

const TS = "typescript";
const MDN = "mdn";
const NODE = "nodejs";

const TSFILES = /\.(ts|mts|cts)$/;
const JSFILES = /\.(ts|mts|cts|js|mjs)$/;

export const JS_TS_2: Construct[] = [
  {
    id: "js-class",
    track: "js-ts",
    title: "class — durum taşıyan nesneler",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Classes",
    pattern: /^\s*(export )?(abstract )?class \w+/m,
    files: TSFILES,
    what:
      "`class` bir kurucu ve metot kümesini tek isim altında toplar. TypeScript'te alan görünürlüğü (`private`, `readonly`) derleme zamanı bir kontroldür; `#alan` sözdizimi ise çalışma zamanında da gerçekten gizlidir.",
    whyHere:
      "Bu depoda sınıflar yalnız DURUM taşıyan şeyler için kullanılır: istemciler, oturum yöneticileri, olay yayıcılar. Saf dönüşümler (doğrulayıcı, üretici) bilerek düz fonksiyondur — çünkü sınıf, test ederken kurulması gereken bir bağlam getirir ve saf fonksiyonun getirmediği bir maliyettir.",
    exercise:
      "`validateLearnSite` bir sınıf metodu olsaydı testte önce ne yapman gerekirdi? Şu anki testte kaç satır kurulum var?",
    recipe: {
      id: "js-class",
      lang: "node",
      code:
        "class Sayac {\n" +
        "  #n = 0;\n" +
        "  arttir() { this.#n++; return this; }\n" +
        "  get deger() { return this.#n; }\n" +
        "}\n" +
        "const s = new Sayac().arttir().arttir();\n" +
        "console.log('deger:' + s.deger + ' gizli:' + (Object.keys(s).length === 0));",
      expect: "deger:2 gizli:true",
      safety: "safe",
    },
    related: ["ts-interface", "js-error-subclass"],
  },
  {
    id: "js-error-subclass",
    track: "js-ts",
    title: "Error türetmek — hata sınıflandırma",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Error",
    pattern: /extends Error\b/,
    files: TSFILES,
    what:
      "`class XError extends Error` özel bir hata tipi üretir; `instanceof` ile ayırt edilir. `name` alanını ayarlamak şart: aksi hâlde yığın izinde hâlâ `Error` yazar ve log okurken sınıf kaybolur.",
    whyHere:
      "Kapılar hatayı SINIFLANDIRMAK zorunda: ağ dalgalanması SKIP, bozuk veri FAIL. Tek bir düz `Error` ile bu ayrım `message` içinde metin aramaya dönüşür — kırılgan. Türetilmiş tip, ayrımı tipin kendisine taşır.",
    exercise:
      "İki farklı hata tipi at ve `catch` içinde `instanceof` ile ayır. Mesaj metnine bakmadan ayırabildin mi?",
    recipe: {
      id: "js-error-subclass",
      lang: "node",
      code:
        "class NetworkError extends Error { constructor(m) { super(m); this.name = 'NetworkError'; } }\n" +
        "class DataError extends Error { constructor(m) { super(m); this.name = 'DataError'; } }\n" +
        "const karar = (e) => (e instanceof NetworkError ? 'SKIP' : e instanceof DataError ? 'FAIL' : '?');\n" +
        "console.log([karar(new NetworkError('429')), karar(new DataError('bozuk'))].join(' '));",
      expect: "SKIP FAIL",
      safety: "safe",
    },
    related: ["js-try-catch", "js-class"],
  },
  {
    id: "js-switch",
    track: "js-ts",
    title: "switch — çok dallı ayrım ve fall-through tuzağı",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/switch",
    pattern: /^\s*switch\s*\(/m,
    files: TSFILES,
    what:
      "`switch` sıkı eşitlikle (`===`) karşılaştırır ve `break` yoksa BİR SONRAKİ dala akar. Bu 'fall-through' bazen bilinçli bir gruplamadır (`case 429: case 503:`), çoğu zaman unutulmuş bir `break`'tir.",
    whyHere:
      "Durum kodu sınıflandırması bilinçli fall-through kullanır: 429 ve 503 aynı davranışı paylaşır. TypeScript'te birleşim tipiyle birlikte kullanıldığında derleyici kapatılmamış dalı da gösterir — `default` içinde `never` ataması bu kontrolü zorunlu kılar.",
    exercise:
      "Bir birleşim tipine yeni bir değer ekle ve `switch`'i güncelleme. `default: const _x: never = v` satırı ne hatası verir?",
    recipe: {
      id: "js-switch",
      lang: "node",
      code:
        "function sinifla(kod) {\n" +
        "  switch (kod) {\n" +
        "    case 429:\n" +
        "    case 503: return 'SKIP';\n" +
        "    case 200: return 'PASS';\n" +
        "    default: return 'FAIL';\n" +
        "  }\n" +
        "}\n" +
        "console.log([200, 429, 503, 404].map(sinifla).join(' '));",
      expect: "PASS SKIP SKIP FAIL",
      safety: "safe",
    },
    related: ["ts-union", "http-status"],
  },
  {
    id: "js-finally",
    track: "js-ts",
    title: "finally — temizlik garantisi",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/try...catch",
    pattern: /\}\s*finally\s*\{/,
    files: JSFILES,
    what:
      "`finally` bloğu, `try` başarılı olsa da hata atsa da hatta `return` etse de çalışır. Zamanlayıcı temizleme, kilit bırakma ve dosya kapatma buraya aittir. `finally` içinde `return` yazmak, dışarıdaki `return`'ü SESSİZCE ezer — bilinen bir tuzak.",
    whyHere:
      "Zaman aşımı kuran her çağrı `clearTimeout`'u `finally` içinde yapar. `catch` içine konsaydı başarı yolunda zamanlayıcı asılı kalır ve süreç, iş bittiği hâlde saniyelerce kapanmazdı.",
    exercise:
      "`finally` içine `return 'x'` ekle ve `try` içinde başka bir değer döndür. Hangisi kazanıyor?",
    recipe: {
      id: "js-finally",
      lang: "node",
      code:
        "let temizlendi = false;\n" +
        "function calis(hata) {\n" +
        "  try { if (hata) throw new Error('x'); return 'ok'; }\n" +
        "  catch { return 'hata'; }\n" +
        "  finally { temizlendi = true; }\n" +
        "}\n" +
        "const a = calis(false), b = calis(true);\n" +
        "console.log(a + ' ' + b + ' temizlik:' + temizlendi);",
      expect: "ok hata temizlik:true",
      safety: "safe",
    },
    related: ["js-try-catch", "http-timeout"],
  },
  {
    id: "js-math",
    track: "js-ts",
    title: "Math ve sayı biçimlendirme",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Math",
    pattern: /\bMath\.(round|floor|ceil|max|min|abs|log10|random)/,
    files: JSFILES,
    what:
      "`Math.round` yarımı YUKARI yuvarlar (`-0.5 → -0`), `Math.floor` aşağı. Yüzde ve oran raporlarında `toFixed(n)` metin döndürür — sayı değil; iki `toFixed` sonucunu toplamaya çalışmak metin birleştirir.",
    whyHere:
      "Ölçüm raporlarının hepsi burada: kazanç oranı, ortalama bayt, kapsama yüzdesi. `toFixed`'in metin döndürdüğünü unutmak, 'kazanç 1.9× + 2.1× = 1.92.1×' gibi sessiz bir rapor hatası üretir.",
    exercise:
      "`(0.1 + 0.2).toFixed(2)` ile `0.1 + 0.2 === 0.3` sonuçlarını yaz. Neden ikisi de doğru?",
    recipe: {
      id: "js-math",
      lang: "node",
      code:
        "const kazanc = 26596 / 1040;\n" +
        "console.log('kazanc:' + kazanc.toFixed(1) + ' yuvarlak:' + Math.round(kazanc) + ' metin:' + (typeof kazanc.toFixed(1)));",
      expect: "kazanc:25.6 yuvarlak:26 metin:string",
      safety: "safe",
    },
    related: ["py-math-log", "js-number-parse"],
  },
  {
    id: "js-number-parse",
    track: "js-ts",
    title: "Number.parseInt / parseFloat / isFinite",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number/parseInt",
    pattern: /Number\.(parseInt|parseFloat|isFinite|isNaN|MAX_SAFE)|parseInt\(/,
    files: JSFILES,
    what:
      "`parseInt` baştan okuyabildiği kadarını sayıya çevirir ve gerisini ATAR (`\"12abc\" → 12`); `Number(\"12abc\")` ise `NaN` verir. Katı doğrulama istiyorsan `Number` + `Number.isFinite` ikilisi doğrudur.",
    whyHere:
      "Bayrak ayrıştırma (`--budget 1100`) ve ortam değişkeni okuma bu ikilemle karşılaşır. `parseInt` kullanan bir ayar okuyucu `\"1100x\"` girdisini sessizce 1100 kabul eder; bir kapı için bu, yanlış bir eşikle yeşil vermek demektir.",
    exercise:
      "`--budget abc` gönder. Kod hangi değeri kullanıyor — varsayılan mı, `NaN` mı? `NaN` ile yapılan karşılaştırma her zaman ne döndürür?",
    recipe: {
      id: "js-number-parse",
      lang: "node",
      code:
        "const oku = (s, d) => (Number.isFinite(Number(s)) ? Number(s) : d);\n" +
        "console.log('gevsek:' + parseInt('1100x', 10) + ' katı:' + oku('1100x', 1100) + ' gecerli:' + oku('900', 1100));",
      expect: "gevsek:1100 katı:1100 gecerli:900",
      safety: "safe",
    },
    related: ["js-math", "node-process"],
  },
  {
    id: "js-date",
    track: "js-ts",
    title: "Date ve ISO damgası",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Date",
    pattern: /new Date\(|Date\.now\(\)|toISOString\(/,
    files: JSFILES,
    what:
      "`toISOString()` her zaman UTC verir ve sıralanabilir (`2026-07-25T14:00:00.000Z`). Yerel biçimler makine karşılaştırması için uygun değildir; günlüklerde ve indekslerde ISO tercih edilir.",
    whyHere:
      "Üreticilerin damgası `toISOString().slice(0,19).replace('T',' ')` biçimindedir. Ama ASIL kural şu: damga, üretilen İÇERİĞİN parçası olmamalı — saf üreticiler (`renderLearnReferencesMd`) saat kullanmaz, yoksa her koşuda diff çıkar ve 'değişti mi' sorusu yanıtsız kalır.",
    exercise:
      "Bir üreticiye `Date.now()` ekle ve iki kez çalıştırıp `diff` al. Kaç satır değişti? Bu neden determinizmi bozar?",
    recipe: {
      id: "js-date",
      lang: "node",
      code:
        "const d = new Date(Date.UTC(2026, 6, 25, 14, 0, 0));\n" +
        "console.log(d.toISOString().slice(0, 19).replace('T', ' '));",
      expect: "2026-07-25 14:00:00",
      safety: "safe",
    },
    related: ["js-math", "data-content-hash"],
  },
  {
    id: "js-generator",
    track: "js-ts",
    title: "Generator ve yield — tembel diziler",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function*",
    pattern: /function\*|^\s*yield /m,
    files: TSFILES,
    what:
      "`function*` her `yield`'de duraklar ve çağıran bir sonraki değeri istediğinde devam eder. Tüm sonucu bellekte kurmak yerine akış hâlinde üretir; büyük dosyalarda ve sonsuz dizilerde tek makul yoldur.",
    whyHere:
      "Satır satır tarama ve akış yanıtları böyle yazılır: dosyanın tamamını diziye toplamak 500 kB'lık kaynaklarda bellek dalgalanması üretir. Üretici, tüketici okumayı bırakınca kendiliğinden durur.",
    exercise:
      "Sonsuz bir üreteç yaz ve ilk 3 değeri al. Program neden asılı kalmıyor?",
    recipe: {
      id: "js-generator",
      lang: "node",
      code:
        "function* sayilar() { let i = 1; while (true) yield i++; }\n" +
        "const ilk3 = [];\n" +
        "for (const n of sayilar()) { ilk3.push(n); if (ilk3.length === 3) break; }\n" +
        "console.log('ilk3:' + ilk3.join(','));",
      expect: "ilk3:1,2,3",
      safety: "safe",
    },
    related: ["js-for-await", "js-array-map"],
  },
  {
    id: "js-for-await",
    track: "js-ts",
    title: "for await — eşzamansız akışta gezinmek",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/for-await...of",
    pattern: /for await\s*\(/,
    files: TSFILES,
    what:
      "`for await (const x of akis)` her parçayı geldikçe işler. `Promise.all` ile farkı: `all` hepsini paralel başlatıp beklerken, `for await` SIRAYLA ilerler — sıralama önemliyse ya da bellek sınırlıysa doğru olan budur.",
    whyHere:
      "Model yanıtları ve büyük yanıt gövdeleri parça parça gelir. Tümünü toplayıp sonra işlemek hem gecikmeyi görünür kılar hem de büyük yanıtta bellek şişirir.",
    exercise:
      "10 parçalı bir akışı `for await` ve `Promise.all` ile işle. Hangisinde ilk sonuç daha erken görünür?",
    recipe: {
      id: "js-for-await",
      lang: "node",
      code:
        "async function* akis() { yield 'a'; yield 'b'; yield 'c'; }\n" +
        "(async () => {\n" +
        "  const sira = [];\n" +
        "  for await (const p of akis()) sira.push(p);\n" +
        "  console.log('sirali:' + sira.join(''));\n" +
        "})();",
      expect: "sirali:abc",
      safety: "safe",
    },
    related: ["js-generator", "js-async-await", "http-sse"],
  },
  {
    id: "js-timers",
    track: "js-ts",
    title: "setTimeout / clearTimeout ve olay döngüsü",
    level: "orta",
    source: NODE,
    url: "https://developer.mozilla.org/docs/Web/API/Window/setTimeout",
    pattern: /setTimeout\(|setInterval\(|clearTimeout\(/,
    files: JSFILES,
    what:
      "`setTimeout` bir işi kuyruğa koyar; verilen süre bir GARANTİ değil, EN ERKEN zamandır. Node'da temizlenmemiş bir zamanlayıcı süreci ayakta tutar; `unref()` bunu engeller.",
    whyHere:
      "Her dış çağrının zaman aşımı bir `setTimeout`'tur ve `finally` içinde temizlenir. Temizlenmezse tek seferlik bir betik, işi bittiği hâlde zamanlayıcı süresi dolana kadar kapanmaz — 'komut takıldı' diye yanlış teşhis edilir.",
    exercise:
      "Zamanlayıcıyı temizlemeyen bir betik yaz. `time node betik.js` kaç saniye sürüyor?",
    recipe: {
      id: "js-timers",
      lang: "node",
      code:
        "const t = setTimeout(() => console.log('bu asla yazilmamali'), 5000);\n" +
        "clearTimeout(t);\n" +
        "console.log('temizlendi:true');",
      expect: "temizlendi:true",
      safety: "safe",
    },
    related: ["http-timeout", "js-finally"],
  },
  {
    id: "js-url",
    track: "js-ts",
    title: "URL ve URLSearchParams",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/URL",
    pattern: /new URL\(|URLSearchParams/,
    files: JSFILES,
    what:
      "`new URL()` adresi parçalarına ayırır ve doğrular; `URLSearchParams` sorgu dizesini KAÇIRARAK kurar. Elle `?a=` + değer birleştirmek, değerde `&` ya da boşluk olduğunda adresi sessizce bozar.",
    whyHere:
      "Yerel servis adresleri ortam değişkeninden gelir ve sorgu parametreleriyle birleştirilir. Elle birleştirme, Türkçe karakterli bir sorguda kırılır; `URLSearchParams` yüzde kodlamayı kendisi yapar.",
    exercise:
      "Sorgu değerine `a&b=c` yaz, iki yöntemle URL kur. Hangisi tek parametre olarak kalıyor?",
    recipe: {
      id: "js-url",
      lang: "node",
      code:
        "const p = new URLSearchParams({ query: 'a&b=c' });\n" +
        "const u = new URL('/api/search?' + p.toString(), 'http://127.0.0.1:3000');\n" +
        "console.log(u.pathname + '?' + u.searchParams.get('query'));",
      expect: "/api/search?a&b=c",
      safety: "safe",
    },
    related: ["http-fetch", "web-xss-escape"],
  },
  {
    id: "js-crypto-hash",
    track: "js-ts",
    title: "node:crypto — özet ve rastgelelik",
    level: "orta",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/crypto.html",
    pattern: /node:crypto|createHash\(|randomUUID\(|randomBytes\(/,
    files: JSFILES,
    what:
      "`createHash('sha256').update(x).digest('hex')` içerikten deterministik bir kimlik üretir. `randomUUID()` ise her çağrıda farklıdır — kimlik üretiminde ikisini karıştırmak, 'güncelleme' sanılan bir kopya üretimine yol açar.",
    whyHere:
      "Deterministik id kuralının kod tarafı budur: aynı kaynak+anahtar aynı satırı günceller. Rastgele uuid kullanılan bir köprü, her yeniden çalıştırmada veritabanını kopyalarla şişirir ve recall aynı notu üç kez döndürür.",
    exercise:
      "Aynı içerikten iki kez özet al, sonra iki `randomUUID()` üret. Hangisi eşit?",
    recipe: {
      id: "js-crypto-hash",
      lang: "node",
      code:
        "const { createHash, randomUUID } = require('node:crypto');\n" +
        "const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);\n" +
        "console.log('ozet-esit:' + (h('learn') === h('learn')) + ' uuid-esit:' + (randomUUID() === randomUUID()));",
      expect: "ozet-esit:true uuid-esit:false",
      safety: "safe",
    },
    related: ["data-content-hash", "py-hashlib"],
  },
  {
    id: "js-buffer",
    track: "js-ts",
    title: "Buffer ve bayt uzunluğu — karakter ≠ bayt",
    level: "orta",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/buffer.html",
    pattern: /Buffer\.(from|byteLength|alloc)|Uint8Array/,
    files: JSFILES,
    what:
      "`str.length` KARAKTER sayar, `Buffer.byteLength(str)` UTF-8 BAYT sayar. Türkçe harfler 2 bayttır, emoji 4. Bir bayt bütçesini karakterle ölçmek, bütçeyi sessizce aşmak demektir.",
    whyHere:
      "`learnkb ask` bütçesi bayt cinsindendir ve TL;DR'lar Türkçe. Karakterle ölçülseydi 1100 'karakter' sınırı gerçekte ~1400 bayt olur ve ölçüm raporu yanlış olurdu.",
    exercise:
      "'ölçüm' kelimesinin karakter ve bayt uzunluğunu karşılaştır. Fark yüzde kaç?",
    recipe: {
      id: "js-buffer",
      lang: "node",
      code:
        "const s = 'ölçüm ve kapsül';\n" +
        "console.log('karakter:' + s.length + ' bayt:' + Buffer.byteLength(s));",
      expect: "karakter:15 bayt:19",
      safety: "safe",
    },
    related: ["py-json", "agents-token-budget"],
  },
  {
    id: "js-weakmap",
    track: "js-ts",
    title: "WeakMap / WeakSet — sızdırmayan önbellek",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WeakMap",
    pattern: /new Weak(Map|Set)\(/,
    files: TSFILES,
    what:
      "`WeakMap` anahtarını GÜÇLÜ tutmaz: nesneye başka referans kalmazsa çöp toplayıcı hem nesneyi hem girdiyi alır. Normal `Map` ile yazılmış bir önbellek, anahtar nesneler yaşadıkça büyümeye devam eder.",
    whyHere:
      "Uzun ömürlü süreçlerde (sunucu) istek-başına türetilmiş veriyi önbelleklemek gerektiğinde kullanılır. Aynı işi `Map` ile yapan bir önbellek, günlerce ayakta duran bir süreçte sızıntıya dönüşür.",
    exercise:
      "`Map` ve `WeakMap` ile birer önbellek kur. Anahtar nesneyi `null`'ladıktan sonra hangisi hâlâ girdiyi tutuyor?",
    recipe: {
      id: "js-weakmap",
      lang: "node",
      code:
        "const wm = new WeakMap();\n" +
        "let anahtar = { id: 1 };\n" +
        "wm.set(anahtar, 'turetilmis');\n" +
        "console.log('var:' + wm.has(anahtar) + ' deger:' + wm.get(anahtar));",
      expect: "var:true deger:turetilmis",
      safety: "safe",
    },
    related: ["js-set", "ts-generic"],
  },
  {
    id: "js-getter",
    track: "js-ts",
    title: "get / set — hesaplanan özellikler",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Functions/get",
    pattern: /^\s*(get|set) \w+\(/m,
    files: TSFILES,
    what:
      "`get x()` bir özellik gibi okunur ama her erişimde çalışır. Ucuz türetmeler için uygundur; pahalı iş yapan bir getter, okuyucuyu şaşırtır çünkü `nesne.x` bir alan gibi görünür.",
    whyHere:
      "Skor/özet gibi türetilmiş değerlerde kullanılır. Kural: getter içinde G/Ç YOK — bir alan okur gibi görünen ifadenin diske gitmesi, profil çıkarırken bulunması en zor yavaşlıklardan biridir.",
    exercise:
      "Bir getter'ın kaç kez çağrıldığını say. Aynı ifadeyi bir döngüde üç kez kullanınca ne oluyor?",
    recipe: {
      id: "js-getter",
      lang: "node",
      code:
        "let cagri = 0;\n" +
        "const rapor = { pass: 29, fail: 0, get yesil() { cagri++; return this.fail === 0; } };\n" +
        "void rapor.yesil; void rapor.yesil;\n" +
        "console.log('yesil:' + rapor.yesil + ' cagri:' + cagri);",
      expect: "yesil:true cagri:3",
      safety: "safe",
    },
    related: ["js-class", "js-object-entries"],
  },
  {
    id: "js-test-vitest",
    track: "js-ts",
    title: "Test yazmak — describe / it / expect",
    level: "orta",
    source: NODE,
    url: "https://developer.mozilla.org/docs/Learn/Tools_and_testing",
    pattern: /from "vitest"|describe\(|\bit\(|expect\(/,
    files: TSFILES,
    what:
      "Bir test üç parçadır: kurulum, çağrı, iddia. İyi bir test adı, kırıldığında NE bozulduğunu söyler — 'çalışıyor' değil, 'kanıtsız dersi reddeder' gibi.",
    whyHere:
      "Saf modeller (`learnsite.ts`) diske dokunmadığı için testleri milisaniyelerdir ve kurulum gerektirmez. Asıl kazanç şu: çok satırlı dedektör hatası (her `^---\\n\\w+:` deseninin sessizce sıfır bulması) bir testle yakalanabilirdi; şansla yakalandı.",
    exercise:
      "`learnsite.test.ts` içindeki bir testin adını oku ve kırıldığında ne öğreneceğini söyle. Ad yeterince bilgilendirici mi?",
    recipe: {
      id: "js-test-vitest",
      lang: "node",
      code:
        "const testler = [['kanıtsız dersi reddeder', true], ['boş gövdeyi reddeder', true]];\n" +
        "const gecen = testler.filter(([, ok]) => ok).length;\n" +
        "console.log('test:' + testler.length + ' gecen:' + gecen);",
      expect: "test:2 gecen:2",
      safety: "safe",
    },
    related: ["ts-interface", "js-modules"],
  },
  {
    id: "ts-satisfies",
    track: "js-ts",
    title: "satisfies — tipi doğrula ama daraltmayı koru",
    level: "ileri",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator",
    pattern: /\bsatisfies\b/,
    files: TSFILES,
    what:
      "`x satisfies T`, `x`'in `T`'ye uyduğunu denetler ama `x`'in DAR tipini korur. `const x: T = ...` yazmak ise tipi `T`'ye genişletir ve tek tek anahtarların bilgisini kaybeder.",
    whyHere:
      "Sabit tablolarda (kaynak listesi, katman haritası) hem 'şemaya uyuyor mu' denetimi hem de 'hangi anahtarlar var' bilgisi gerekir. `:T` ile yazılsa `Object.keys` sonucu `string[]` olur ve tam kapsayan `Record` denetimi kaybolur.",
    exercise:
      "Bir sabiti `: T` ile ve `satisfies T` ile yaz. Hangisinde anahtar adları otomatik tamamlanıyor?",
    recipe: {
      id: "ts-satisfies",
      lang: "node",
      code:
        "const KAYNAK = { mdn: 'https://developer.mozilla.org/', w3: 'https://www.w3schools.com/' };\n" +
        "const anahtarlar = Object.keys(KAYNAK);\n" +
        "console.log('anahtar:' + anahtarlar.join(',') + ' ilk:' + KAYNAK.mdn.startsWith('https'));",
      expect: "anahtar:mdn,w3 ilk:true",
      safety: "safe",
    },
    related: ["ts-as-const", "ts-record"],
  },
];
