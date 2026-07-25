// track: js-ts — TypeScript ve JavaScript dersleri.
//
// Kaynak çapası: TypeScript Handbook (tip sistemi), MDN (dil ve standart kütüphane),
// Node.js docs (çalışma zamanı). Metin hiçbirinden kopyalanmaz; örnekler kendi depomuzdan gelir.
import type { Construct } from "./types";

const TS = "typescript";
const MDN = "mdn";
const NODE = "nodejs";

/** Where TypeScript/JavaScript ground truth lives in our systems. */
const TSFILES = /\.(ts|mts|cts)$/;
const JSFILES = /\.(ts|mts|cts|js|mjs)$/;

export const JS_TS: Construct[] = [
  {
    id: "ts-interface",
    track: "js-ts",
    title: "interface — bir nesnenin sözleşmesi",
    level: "temel",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/objects.html",
    pattern: /^\s*export interface \w+/m,
    files: TSFILES,
    what:
      "`interface` bir nesnenin hangi alanlara, hangi tiplerle sahip olacağını yazar. Çalışma zamanında hiçbir şey üretmez — yalnızca derleyiciye ve editöre konuşur. " +
      "Alan adı yanlış yazıldığında ya da bir alan unutulduğunda hata kodu çalışmadan önce görünür.",
    whyHere:
      "Bu depoda arayüzler *veri sözleşmesi* olarak kullanılır: `HelpPage`, `HelpSection`, `HelpSite` üçlüsü yardım sitesinin tüm şeklini tanımlar ve doğrulayıcı (`validateHelpSite`) yalnız bu şekle bakarak diske dokunmadan 'site tam mı' sorusunu yanıtlayabilir.",
    exercise:
      "`pipeline/lib/helpsite.ts` içindeki `HelpPage` arayüzüne zorunlu bir `level: string` alanı eklediğini varsay. `npx tsc --noEmit` kaç dosyada hata verirdi? Tahminini yaz, sonra alanı `level?: string` yapınca sayının neden 0'a düştüğünü açıkla.",
    recipe: {
      id: "ts-interface",
      lang: "node",
      code:
        "// interface derlenince kaybolur; kalan sadece düz nesnedir.\n" +
        "const page = { slug: 'a/b', title: 'Ders', body: 'gövde', sources: ['https://x'] };\n" +
        "const required = ['slug', 'title', 'body', 'sources'];\n" +
        "const missing = required.filter((k) => !(k in page));\n" +
        "console.log(missing.length === 0 ? 'sozlesme-tam' : 'eksik:' + missing.join(','));",
      expect: "sozlesme-tam",
      safety: "safe",
    },
    related: ["ts-type-alias", "ts-optional-prop"],
  },
  {
    id: "ts-type-alias",
    track: "js-ts",
    title: "type — tip takma adı",
    level: "temel",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-aliases",
    pattern: /^\s*export type \w+\s*=/m,
    files: TSFILES,
    what:
      "`type` var olan tiplere isim verir. `interface`'ten farkı: yalnız nesneleri değil, birleşimleri, fonksiyon imzalarını ve ilkel tipleri de adlandırabilir.",
    whyHere:
      "`Archetype = \"docs\" | \"marketing\" | \"kb\"` gibi kapalı kümeleri adlandırmak için kullanılır. İsim verilince aynı küme üç ayrı yerde tekrar yazılmaz ve yeni bir değer eklendiğinde onu işleyen tüm `Record` tabloları derleyici tarafından eksik bulunur.",
    exercise:
      "`lib/learnrefs.ts` içindeki `TextPolicy` birleşimine dördüncü bir değer ekle. `POLICY_TR` tablosunu güncellemeden `tsc --noEmit` çalıştırınca hangi hatayı alırsın? Bu neden istenen davranıştır?",
    recipe: {
      id: "ts-type-alias",
      lang: "node",
      code:
        "const POLICY_TR = { 'attribute-never-mirror': 'aynalanmaz', 'taxonomy-only': 'yalniz-taksonomi', 'link-only': 'yalniz-link' };\n" +
        "const policies = Object.keys(POLICY_TR);\n" +
        "console.log('kapali-kume:' + policies.length);",
      expect: "kapali-kume:3",
      safety: "safe",
    },
    related: ["ts-union", "ts-record"],
  },
  {
    id: "ts-union",
    track: "js-ts",
    title: "Birleşim tipleri (union) ve ayırt edici alan",
    level: "orta",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
    pattern: /:\s*"[^"]+"\s*\|\s*"/,
    files: TSFILES,
    what:
      "Birleşim, bir değerin sonlu sayıda seçenekten biri olduğunu söyler. Seçenekler string sabitleri olduğunda derleyici yazım hatasını yakalar; `switch` içinde tüm dallar kapatılmazsa uyarır.",
    whyHere:
      "`HelpIssue.level: \"error\" | \"warn\"` ayrımı bu depodaki en kritik ayrımlardan biri: *hata* yayını durdurur, *uyarı* durdurmaz. Bunu boolean yerine birleşimle yazmak, ileride üçüncü bir seviye (`info`) eklendiğinde onu işlemeyen her yeri derleyicinin göstermesini sağlar.",
    exercise:
      "`validateHelpSite` çıktısında `level` alanını `boolean isError` yapsaydık hangi bilgi kaybolurdu? `_help` altında kaç sayfa hâlâ üretilirdi?",
    recipe: {
      id: "ts-union",
      lang: "node",
      code:
        "const issues = [{ level: 'error', msg: 'dangling link' }, { level: 'warn', msg: 'ince bolum' }];\n" +
        "const blocking = issues.filter((i) => i.level === 'error').length;\n" +
        "console.log('bloklayan:' + blocking + ' uyari:' + (issues.length - blocking));",
      expect: "bloklayan:1 uyari:1",
      safety: "safe",
    },
    related: ["ts-type-alias", "ts-narrowing"],
  },
  {
    id: "ts-narrowing",
    track: "js-ts",
    title: "Tip daraltma (narrowing) — typeof ve Array.isArray",
    level: "orta",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
    pattern: /typeof \w+ [!=]==? "|Array\.isArray\(/,
    files: TSFILES,
    what:
      "Bir değer birden çok tip olabiliyorsa, onu kullanmadan önce hangisi olduğunu kanıtlaman gerekir. `typeof x === \"string\"` ya da `Array.isArray(x)` kontrolünden sonra derleyici o blok içinde daha dar bir tip görür.",
    whyHere:
      "Doğrulayıcılar dış dünyadan gelen (JSON'dan okunmuş) veriyi alır. `validateHelpSite` ilk satırında `typeof site !== \"object\"` diye bakar; bu kontrol olmadan bozuk bir JSON, anlamsız bir hata yığını yerine tek satırlık dürüst bir mesaj üretemezdi.",
    exercise:
      "`Array.isArray(site.sections)` kontrolünü kaldır ve `sections`'ı `null` yap. Hata mesajı okunur mu, yoksa `Cannot read properties of null` mu alırsın?",
    recipe: {
      id: "ts-narrowing",
      lang: "node",
      code:
        "function describe(v) {\n" +
        "  if (Array.isArray(v)) return 'dizi:' + v.length;\n" +
        "  if (typeof v === 'string') return 'metin:' + v.length;\n" +
        "  if (v === null) return 'null';\n" +
        "  return typeof v;\n" +
        "}\n" +
        "console.log([describe([1,2]), describe('abc'), describe(null)].join(' '));",
      expect: "dizi:2 metin:3 null",
      safety: "safe",
    },
    related: ["ts-union", "js-try-catch"],
  },
  {
    id: "ts-generic",
    track: "js-ts",
    title: "Generic — tipi parametre yapmak",
    level: "ileri",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
    pattern: /\b(Array|Set|Map|Record|Promise|Partial|Readonly)<|function \w+<[A-Z]/,
    files: TSFILES,
    what:
      "Generic, bir yapının içindeki tipi çağıran tarafın belirlemesine izin verir. `Set<string>` ile `Set<number>` aynı kodu paylaşır ama karışmazlar.",
    whyHere:
      "Grafik ve dedupe kodunda `Set<string>` her yerde: 'gördüğüm slug'lar' kümesi string tutar ve yanlışlıkla bir nesne eklenirse derleyici durdurur. Kapsül indeksinde `Map<string, Capsule>` slug→kapsül eşlemesini tip-güvenli tutar.",
    exercise:
      "`new Set()` (generic'siz) ile `new Set<string>()` arasında, içine sayı eklemeye çalıştığında ne fark eder? Çalışma zamanında bir fark var mı?",
    recipe: {
      id: "ts-generic",
      lang: "node",
      code:
        "const seen = new Set();\n" +
        "for (const slug of ['a', 'b', 'a', 'c', 'b']) seen.add(slug);\n" +
        "console.log('benzersiz:' + seen.size);",
      expect: "benzersiz:3",
      safety: "safe",
    },
    related: ["js-set", "ts-record"],
  },
  {
    id: "ts-record",
    track: "js-ts",
    title: "Record<K, V> — tam kapsayan eşleme tablosu",
    level: "orta",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type",
    pattern: /Record<[^>]+>/,
    files: TSFILES,
    what:
      "`Record<K, V>`, anahtar kümesi K olan bir nesne tipidir. K bir birleşimse, tablodaki her seçenek için bir değer yazmak ZORUNLUDUR — eksik bırakılan derleme hatası verir.",
    whyHere:
      "`ARCHETYPE_TR: Record<Archetype, string>` çeviri tablosu böyle yazılmıştır. Yeni bir arketip eklendiği gün Türkçe karşılığı unutulamaz; derleyici bunu bir insanın gözden kaçırmasına bırakmaz.",
    exercise:
      "`POLICY_TR` tablosunu `Record<TextPolicy, string>` yerine düz `{ [k: string]: string }` yapsan hangi güvenlik kaybolur?",
    recipe: {
      id: "ts-record",
      lang: "node",
      code:
        "const KIND_TR = { reference: 'referans', tutorial: 'ogretici', curriculum: 'mufredat', aggregator: 'toplayici' };\n" +
        "const kinds = ['reference', 'tutorial', 'curriculum', 'aggregator'];\n" +
        "const eksik = kinds.filter((k) => !(k in KIND_TR));\n" +
        "console.log(eksik.length === 0 ? 'tablo-tam:' + kinds.length : 'eksik:' + eksik);",
      expect: "tablo-tam:4",
      safety: "safe",
    },
    related: ["ts-union", "ts-generic"],
  },
  {
    id: "ts-optional-prop",
    track: "js-ts",
    title: "İsteğe bağlı alan (`?:`) ve varsayılan değer",
    level: "temel",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/2/objects.html#optional-properties",
    pattern: /^\s*\/?\*?\s*\w+\?:\s/m,
    files: TSFILES,
    what:
      "`alan?: T`, alanın olmayabileceğini söyler. Okuyan taraf `undefined` ihtimalini ele almak zorunda kalır; bu, 'bazen var bazen yok' bilgisini yorumdan tipe taşır.",
    whyHere:
      "`Construct.url?` böyle yazıldı: her dersin derin bağlantısı yok, olmayınca kaynağın kök URL'sine düşülür. Zorunlu yapılsaydı 150 derste anlamsız URL tekrarı olurdu.",
    exercise:
      "`url?: string` alanını zorunlu yapıp `learn-build` çalıştır. Kaç ders derlenmez? Bu sayı, isteğe bağlılığın kaç yerde iş gördüğünün ölçüsüdür.",
    recipe: {
      id: "ts-optional-prop",
      lang: "node",
      code:
        "const src = { id: 'mdn', url: 'https://developer.mozilla.org/' };\n" +
        "const lessons = [{ id: 'a', url: 'https://developer.mozilla.org/deep' }, { id: 'b' }];\n" +
        "console.log(lessons.map((l) => l.url ?? src.url).join(' '));",
      expect: "https://developer.mozilla.org/deep https://developer.mozilla.org/",
      safety: "safe",
    },
    related: ["js-nullish", "js-optional-chain"],
  },
  {
    id: "ts-as-const",
    track: "js-ts",
    title: "`as const` — değişmez, daraltılmış sabitler",
    level: "ileri",
    source: TS,
    url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions",
    pattern: /\bas const\b/,
    files: TSFILES,
    what:
      "`as const`, bir dizi ya da nesneyi hem salt-okunur yapar hem de değerlerini geniş tipe (`string`) değil tam sabite (`\"getting-started\"`) daraltır. Böylece o dizi bir birleşim tipinin kaynağı olabilir.",
    whyHere:
      "`REQUIRED_SECTIONS = [...] as const` zorunlu bölüm listesidir. `as const` olmadan tipi `string[]` olur ve 'bölüm adı yanlış yazılmış' hatası derleme zamanında değil, kullanıcı boş bir yardım sitesi gördüğünde ortaya çıkardı.",
    exercise:
      "`REQUIRED_SECTIONS`'tan `as const`'ı kaldır. `typeof REQUIRED_SECTIONS[number]` artık hangi tipe dönüşür ve bu neden işe yaramaz?",
    recipe: {
      id: "ts-as-const",
      lang: "node",
      code:
        "const REQUIRED = ['getting-started', 'guides', 'reference', 'troubleshooting'];\n" +
        "const have = ['getting-started', 'reference'];\n" +
        "console.log('eksik-bolum:' + REQUIRED.filter((r) => !have.includes(r)).join(','));",
      expect: "eksik-bolum:guides,troubleshooting",
      safety: "safe",
    },
    related: ["ts-union", "js-array-filter"],
  },
  {
    id: "js-array-map",
    track: "js-ts",
    title: "map — her elemanı dönüştür",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
    pattern: /\.map\(/,
    files: JSFILES,
    what:
      "`map` bir diziyi aynı uzunlukta yeni bir diziye çevirir; kaynağı değiştirmez. Döngü yazmak yerine 'her eleman şuna dönüşür' demenin yolu.",
    whyHere:
      "Tüm markdown üreticileri bunun üstünde durur: `REFERENCES.map(...)` her kaynağı bir tablo satırına çevirir. Üretici saf kaldığı için aynı veriden her seferinde bayt-bayt aynı dosya çıkar — diff görülürse veri değişmiştir, üretici değil.",
    exercise:
      "`renderLearnReferencesMd()`'yi iki kez çağırıp çıktıları karşılaştır. Eşit mi? Üretici içinde `Date.now()` kullansaydık ne olurdu?",
    recipe: {
      id: "js-array-map",
      lang: "node",
      code:
        "const kaynaklar = [{ t: 'MDN' }, { t: 'W3Schools' }, { t: 'DevDocs' }];\n" +
        "const satirlar = kaynaklar.map((k, i) => '| ' + (i + 1) + ' | ' + k.t + ' |');\n" +
        "console.log(satirlar.join('\\n'));",
      expect: "| 1 | MDN |",
      safety: "safe",
    },
    related: ["js-array-filter", "js-array-join"],
  },
  {
    id: "js-array-filter",
    track: "js-ts",
    title: "filter — koşulu sağlayanları seç",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/filter",
    pattern: /\.filter\(/,
    files: JSFILES,
    what:
      "`filter` koşulu sağlayan elemanlardan yeni bir dizi kurar. Sonuç boş olabilir; bu bir hata değil, cevabın kendisidir.",
    whyHere:
      "Kapı mantığı buradan gelir: `issues.filter(i => i.level === 'error')` boş dönerse yayın serbesttir. 'Hata var mı' sorusunu saymaya indirger — kapılar bu yüzden tartışmasızdır.",
    exercise:
      "`learn-verify.sh` çıktısındaki FAIL sayısını, `filter(...).length` ile aynı anlama gelecek şekilde tarif et. SKIP'ler neden bu filtreye girmez?",
    recipe: {
      id: "js-array-filter",
      lang: "node",
      code:
        "const sonuclar = [{ s: 'PASS' }, { s: 'FAIL' }, { s: 'SKIP' }, { s: 'PASS' }];\n" +
        "const fail = sonuclar.filter((r) => r.s === 'FAIL').length;\n" +
        "console.log(fail === 0 ? 'kapi-acik' : 'kapi-kapali:' + fail);",
      expect: "kapi-kapali:1",
      safety: "safe",
    },
    related: ["js-array-map", "js-array-some-every"],
  },
  {
    id: "js-array-reduce",
    track: "js-ts",
    title: "reduce — diziyi tek değere katla",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce",
    pattern: /\.reduce\(/,
    files: JSFILES,
    what:
      "`reduce` bir biriktirici ile diziyi gezip tek bir sonuç üretir: toplam, en büyük, ya da bir nesne. Başlangıç değerini vermek neredeyse her zaman doğrudur — boş dizide patlamayı önler.",
    whyHere:
      "Token ölçümü böyle yapılır: her kapsülün baytı biriktirilerek toplam bulunur. Başlangıç `0` verilmeseydi kapsül indeksi boşken `reduce` istisna atardı ve ölçüm aracının kendisi çökerdi.",
    exercise:
      "Başlangıç değerini kaldır ve boş dizide çalıştır. Hata mesajı ne? Bu neden 'boş girdi' senaryosunu test etmenin gerekçesidir?",
    recipe: {
      id: "js-array-reduce",
      lang: "node",
      code:
        "const kapsuller = [{ b: 420 }, { b: 380 }, { b: 240 }];\n" +
        "const toplam = kapsuller.reduce((acc, k) => acc + k.b, 0);\n" +
        "console.log('toplam-bayt:' + toplam + ' bos-dizi:' + [].reduce((a, b) => a + b, 0));",
      expect: "toplam-bayt:1040 bos-dizi:0",
      safety: "safe",
    },
    related: ["js-array-map", "js-array-sort"],
  },
  {
    id: "js-array-sort",
    track: "js-ts",
    title: "sort — karşılaştırıcı ile sırala",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/sort",
    pattern: /\.sort\(/,
    files: JSFILES,
    what:
      "`sort` diziyi YERİNDE sıralar ve karşılaştırıcı vermezsen elemanları metne çevirip alfabetik sıralar — sayılarda bu neredeyse her zaman yanlıştır. `(a, b) => b.score - a.score` azalan skor demektir.",
    whyHere:
      "Kapsül arama sonuçları skora göre azalan sıralanır. Karşılaştırıcı unutulsaydı `10` skoru `9`'dan önce değil sonra gelirdi (metin sıralaması) ve arama kalitesi sessizce çökerdi — tam olarak P@1'in 1.0'dan 0.0'a düştüğü türden bir hata.",
    exercise:
      "`[10, 9, 100].sort()` ne döndürür? `sort((a,b)=>a-b)` ile farkı neden bu tier için kritik?",
    recipe: {
      id: "js-array-sort",
      lang: "node",
      code:
        "const naif = [10, 9, 100].sort().join(',');\n" +
        "const dogru = [10, 9, 100].sort((a, b) => a - b).join(',');\n" +
        "console.log('naif:' + naif + ' dogru:' + dogru);",
      expect: "naif:10,100,9 dogru:9,10,100",
      safety: "safe",
    },
    related: ["js-array-reduce", "js-array-slice"],
  },
  {
    id: "js-array-some-every",
    track: "js-ts",
    title: "some / every / includes — varlık ve kapsama testleri",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/some",
    pattern: /\.(some|every|includes)\(/,
    files: JSFILES,
    what:
      "`some` en az biri, `every` hepsi, `includes` tam eşleşme sorar. Üçü de erken çıkar; koşul sağlanınca kalan elemanlara bakılmaz.",
    whyHere:
      "İzin listesi kontrolü `ALLOWED_BINARIES.includes(first)` tek satırdır. Bu satır olmadan bilinmeyen bir komut kabuğa ulaşır; bu satırın YANLIŞ tarafında kalmak ise exit 126 üretir ve 'komut çalıştı' diye kaydedilir (L37 dersi).",
    exercise:
      "`isAllowedBinary('learnkb ask \"x\"')` nasıl `true` döner? Fonksiyon komutun tamamına değil, neden yalnız ilk kelimeye bakar?",
    recipe: {
      id: "js-array-some-every",
      lang: "node",
      code:
        "const ALLOWED = ['git', 'node', 'python3', 'cckb', 'learnkb'];\n" +
        "const izinli = (cmd) => ALLOWED.includes(String(cmd).trim().split(/\\s+/)[0] ?? '');\n" +
        "console.log([izinli('learnkb ask \"bm25\"'), izinli('rm -rf /')].join(' '));",
      expect: "true false",
      safety: "safe",
    },
    related: ["js-array-filter", "agents-allowlist"],
  },
  {
    id: "js-array-join",
    track: "js-ts",
    title: "join / split — dizi ile metin arasında gidip gelmek",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/join",
    pattern: /\.join\(|\.split\(/,
    files: JSFILES,
    what:
      "`join` diziyi ayraçla birleştirip metin yapar, `split` tersini yapar. Satır listesi ↔ dosya içeriği dönüşümünün tamamı bu ikilidir.",
    whyHere:
      "Bütün markdown üreticileri `const L: string[] = []` ile satır biriktirip sonunda `L.join(\"\\n\")` döner. Metni parça parça birleştirmek yerine satır listesi tutmak, araya satır eklemeyi ve testte satır saymayı kolaylaştırır.",
    exercise:
      "`renderLearnReferencesMd()` çıktısında kaç satır var? `split('\\n').length` ile ölç ve tablo satır sayısıyla karşılaştır.",
    recipe: {
      id: "js-array-join",
      lang: "node",
      code:
        "const L = ['# Baslik', '', '| # | Kaynak |', '|---|--------|'];\n" +
        "const md = L.join('\\n');\n" +
        "console.log('satir:' + md.split('\\n').length + ' bayt:' + Buffer.byteLength(md));",
      expect: "satir:4",
      safety: "safe",
    },
    related: ["js-array-map", "js-template-literal"],
  },
  {
    id: "js-array-slice",
    track: "js-ts",
    title: "slice — kopyalayarak parça al",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array/slice",
    pattern: /\.slice\(/,
    files: JSFILES,
    what:
      "`slice` kaynağı bozmadan bir aralık kopyası verir. Negatif indeks sondan sayar. `splice` ile karıştırılmamalı — o kaynağı değiştirir.",
    whyHere:
      "Kaynak dosyaların ilk satırlarından açıklama çıkarırken (`binDesc`) `lines.slice(0, 8)` kullanılır: dosyanın tamamını okumak yerine yalnız başlık yorumuna bakmak hem hızlı hem de yanlış eşleşmeye kapalıdır.",
    exercise:
      "`slice(0, 8)` yerine tüm dosyada arama yapsaydık `binDesc` hangi yanlış satırı açıklama sanabilirdi?",
    recipe: {
      id: "js-array-slice",
      lang: "node",
      code:
        "const lines = ['#!/usr/bin/env node', '// learnkb — token-ucuz kapi', 'import x', '// baska yorum'];\n" +
        "const head = lines.slice(0, 2);\n" +
        "const desc = head.find((l) => /^\\/\\/\\s*\\S+\\s+—\\s+/.test(l));\n" +
        "console.log(desc ? desc.replace(/^\\/\\/\\s*\\S+\\s+—\\s+/, '') : 'yok');",
      expect: "token-ucuz kapi",
      safety: "safe",
    },
    related: ["js-array-sort", "js-string-methods"],
  },
  {
    id: "js-string-methods",
    track: "js-ts",
    title: "String metodları — trim, startsWith, padEnd, replace",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String",
    pattern: /\.(trim|startsWith|endsWith|padEnd|padStart|toLowerCase|replace)\(/,
    files: JSFILES,
    what:
      "String metodları yeni metin döndürür; hiçbiri kaynağı değiştirmez. `replace` yalnız ilk eşleşmeyi değiştirir — hepsini istiyorsan `/g` bayrağı ya da `replaceAll` gerekir.",
    whyHere:
      "Markdown hücrelerinde `|` karakteri tabloyu bozar; `cell()` yardımcısı `replace(/\\|/g, '\\\\|')` ile kaçırır. `/g` unutulsa satırdaki ikinci boru işareti tabloyu sessizce kırardı.",
    exercise:
      "`'a|b|c'.replace('|','-')` ile `'a|b|c'.replace(/\\|/g,'-')` sonuçlarını karşılaştır. Hangisi tablo üreticisinde kullanılmalı?",
    recipe: {
      id: "js-string-methods",
      lang: "node",
      code:
        "const cell = (c) => String(c).replace(/\\|/g, '\\\\|').replace(/\\n/g, ' ').trim();\n" +
        "console.log(cell('  a|b\\nc  '));",
      expect: "a\\|b c",
      safety: "safe",
    },
    related: ["js-regex", "js-template-literal"],
  },
  {
    id: "js-template-literal",
    track: "js-ts",
    title: "Şablon metinleri (`` ` ``) ve ifade gömme",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Template_literals",
    pattern: /`[^`]*\$\{/,
    files: JSFILES,
    what:
      "Ters tırnaklı metinler çok satırlı olabilir ve `${...}` ile ifade gömer. Birleştirme operatörüne göre okunurluk kazandırır ama HTML üretirken kaçırma (escape) sorumluluğunu ortadan KALDIRMAZ.",
    whyHere:
      "`renderReferencesHtml` şablon metinleriyle yazılır ama her kullanıcı verisi `escapeHtml()`'den geçirilir. Şablonun kolaylığı, kaçırmayı unutmanın da o kadar kolay olduğu anlamına gelir — bu yüzden kaçırma ayrı bir fonksiyondur, satır içi değil.",
    exercise:
      "`escapeHtml` çağrısını bir alandan kaldır ve başlığa `<script>` yaz. Üretilen HTML'de ne olur? Bu neden bir güvenlik dersi?",
    recipe: {
      id: "js-template-literal",
      lang: "node",
      code:
        "const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n" +
        "const title = '<script>x</script>';\n" +
        "console.log(`<h3>${esc(title)}</h3>`);",
      expect: "<h3>&lt;script&gt;x&lt;/script&gt;</h3>",
      safety: "safe",
    },
    related: ["js-string-methods", "web-xss-escape"],
  },
  {
    id: "js-regex",
    track: "js-ts",
    title: "Düzenli ifadeler — yakalama grupları ve /g",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Guide/Regular_expressions",
    pattern: /\/\^?[^/\n]{3,}\/[gimsu]*\.(test|exec)\(|new RegExp\(/,
    files: JSFILES,
    what:
      "Düzenli ifade bir metin desenidir. Parantezler *yakalama grubu* açar ve eşleşmenin parçalarını verir. `/g` bayrağı 'hepsini bul' demektir ve `matchAll` ile birlikte kullanılır.",
    whyHere:
      "`wikilinks()` tüm `[[hedef|takma]]` bağlantılarını bu şekilde çıkarır. Bağlantı grafiği bu tek düzenli ifadeye dayanır; yanlış yazılsa 'kopuk link yok' raporu yalan olurdu — kapının en yük taşıyan satırı budur.",
    exercise:
      "`[[a|b]]` ve `[[a#bölüm]]` biçimlerinin ikisinden de yalnız `a` çıkması gerekir. Deseni `[[([^\\]|#]+)` yerine `[[(.+)` yapsan hangi bağlantı yanlış çözülür?",
    recipe: {
      id: "js-regex",
      lang: "node",
      code:
        "const body = 'bkz [[learn-js-ts]] ve [[learn|Hub]] ve [[cc-hooks#yaz]]';\n" +
        "const targets = [...body.matchAll(/\\[\\[([^\\]|#]+)(?:[|#][^\\]]*)?\\]\\]/g)].map((m) => m[1].trim());\n" +
        "console.log(targets.join(','));",
      expect: "learn-js-ts,learn,cc-hooks",
      safety: "safe",
    },
    related: ["js-string-methods", "py-regex"],
  },
  {
    id: "js-set",
    track: "js-ts",
    title: "Set ve Map — benzersizlik ve hızlı arama",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Set",
    pattern: /new (Set|Map)\(/,
    files: JSFILES,
    what:
      "`Set` aynı değeri iki kez tutmaz; `has` sorgusu eleman sayısından bağımsız hızlıdır. `Map` ise anahtarı string olmak zorunda olmayan bir sözlüktür.",
    whyHere:
      "Bağlantı doğrulaması `targets` kümesi kurar ve her wikilink'i ona sorar. Dizi üzerinde `includes` ile yapılsaydı 200 not × 1169 bağlantı karşılaştırması karesel olurdu; küme bunu doğrusala indirir.",
    exercise:
      "Kaç `[[...]]` hedefi var ve kaç tanesi benzersiz? İkisi arasındaki fark ne anlama gelir?",
    recipe: {
      id: "js-set",
      lang: "node",
      code:
        "const targets = ['learn', 'learn-js-ts', 'learn', 'learn-web'];\n" +
        "const pages = new Set(['learn', 'learn-js-ts', 'learn-web']);\n" +
        "const dangling = targets.filter((t) => !pages.has(t));\n" +
        "console.log('hedef:' + targets.length + ' benzersiz:' + new Set(targets).size + ' kopuk:' + dangling.length);",
      expect: "hedef:4 benzersiz:3 kopuk:0",
      safety: "safe",
    },
    related: ["ts-generic", "js-array-filter"],
  },
  {
    id: "js-nullish",
    track: "js-ts",
    title: "?? — yalnız null/undefined için varsayılan",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing",
    pattern: /\?\?/,
    files: JSFILES,
    what:
      "`a ?? b`, `a` yalnızca `null` ya da `undefined` ise `b` verir. `||`'den farkı kritiktir: `0`, `\"\"` ve `false` geçerli değerlerdir ve `??` onları ezmez.",
    whyHere:
      "`process.env.OBSIDIAN_VAULT ?? join(HOME, 'ollamas-vault')` — ortam değişkeni boş string olarak tanımlıysa `||` onu da ezip varsayılana düşerdi ve 'ben yolu verdim ama başka yere yazdı' hatası doğardı.",
    exercise:
      "`0 || 5` ile `0 ?? 5` sonuçlarını yaz. Bütçe değeri 0 olan bir ayar `||` ile okunursa ne olur?",
    recipe: {
      id: "js-nullish",
      lang: "node",
      code:
        "const budget = 0;\n" +
        "console.log('pipe:' + (budget || 1100) + ' nullish:' + (budget ?? 1100));",
      expect: "pipe:1100 nullish:0",
      safety: "safe",
    },
    related: ["js-optional-chain", "ts-optional-prop"],
  },
  {
    id: "js-optional-chain",
    track: "js-ts",
    title: "?. — güvenli zincir erişimi",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Operators/Optional_chaining",
    pattern: /\?\./,
    files: JSFILES,
    what:
      "`a?.b`, `a` yoksa hata atmak yerine `undefined` verir. Derin JSON okurken her katman için `if` yazmayı gereksiz kılar — ama 'değer yoktu' ile 'değer undefined'ı ayırmaz.",
    whyHere:
      "Dış JSON (kapsül indeksi, dataset) okunurken kullanılır: `site.hubTitle?.trim()`. Dosya bozuksa doğrulayıcı anlamlı bir hata satırı üretir, yığın izi değil.",
    exercise:
      "`site.hubTitle?.trim()` yerine `site.hubTitle.trim()` yazıp `hubTitle` alanını sil. Hata mesajı hangi dosyayı işaret eder — bozuk veriyi mi, doğrulayıcıyı mı?",
    recipe: {
      id: "js-optional-chain",
      lang: "node",
      code:
        "const site = { sections: [{ pages: [] }] };\n" +
        "console.log('baslik:' + (site.hubTitle?.trim() ?? '(yok)') + ' sayfa:' + (site.sections?.[0]?.pages?.length ?? -1));",
      expect: "baslik:(yok) sayfa:0",
      safety: "safe",
    },
    related: ["js-nullish", "ts-optional-prop"],
  },
  {
    id: "js-destructuring",
    track: "js-ts",
    title: "Ayrıştırma (destructuring) ve spread",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment",
    pattern: /^\s*(const|let)\s*\{[^}]+\}\s*=|\.\.\./m,
    files: JSFILES,
    what:
      "Ayrıştırma bir nesneden alanları isimleriyle çeker; `...` (spread) bir nesneyi/diziyi başka birinin içine açar. Spread SIĞ kopya yapar: iç içe nesneler hâlâ paylaşılır.",
    whyHere:
      "`{...defaults, ...user}` deseni ayarlarda kullanılır ve bir gotcha üretmiştir: `undefined` bir alan yayıldığında varsayılanı EZER. Bu yüzden birleştirme fonksiyonları önce tanımsızları ayıklar.",
    exercise:
      "`{...{k: 1}, ...{k: undefined}}` sonucunda `k` nedir? Bu neden ayar birleştirmede hata kaynağıdır?",
    recipe: {
      id: "js-destructuring",
      lang: "node",
      code:
        "const varsayilan = { budget: 1100, k: 3 };\n" +
        "const kullanici = { k: undefined };\n" +
        "const naif = { ...varsayilan, ...kullanici };\n" +
        "const temiz = { ...varsayilan, ...Object.fromEntries(Object.entries(kullanici).filter(([, v]) => v !== undefined)) };\n" +
        "console.log('naif-k:' + naif.k + ' temiz-k:' + temiz.k);",
      expect: "naif-k:undefined temiz-k:3",
      safety: "safe",
    },
    related: ["js-object-entries", "js-nullish"],
  },
  {
    id: "js-object-entries",
    track: "js-ts",
    title: "Object.keys / entries / fromEntries",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/entries",
    pattern: /Object\.(keys|values|entries|fromEntries|assign)\(/,
    files: JSFILES,
    what:
      "Bu üçlü nesne ile dizi arasında köprüdür: `entries` `[anahtar, değer]` çiftleri verir, `fromEntries` geri çevirir. Aradaki adımda `map`/`filter` kullanılabilir.",
    whyHere:
      "JSON indekslerini (kapsüller, tarifler) süzerken kullanılır; nesneyi diziye çevirmek, aynı `filter` mantığını hem dizilere hem sözlüklere uygulamayı sağlar.",
    exercise:
      "Bir sözlükten değeri boş olan anahtarları at. `entries → filter → fromEntries` zincirini yaz.",
    recipe: {
      id: "js-object-entries",
      lang: "node",
      code:
        "const kapsuller = { a: 'dolu', b: '', c: 'dolu' };\n" +
        "const temiz = Object.fromEntries(Object.entries(kapsuller).filter(([, v]) => v.length > 0));\n" +
        "console.log(Object.keys(temiz).join(','));",
      expect: "a,c",
      safety: "safe",
    },
    related: ["js-destructuring", "data-json-index"],
  },
  {
    id: "js-json",
    track: "js-ts",
    title: "JSON.parse / JSON.stringify",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/JSON",
    pattern: /JSON\.(parse|stringify)\(/,
    files: JSFILES,
    what:
      "`stringify` nesneyi metne, `parse` metni nesneye çevirir. Üçüncü parametre girinti verir; `parse` bozuk girdide istisna atar, bu yüzden `try` ile sarılır.",
    whyHere:
      "Tüm indeksler (`learn-capsules.json`, `learn-recipes.json`) makine tüketicisi içindir; 2 boşluk girintiyle yazılırlar ki git diff'i insan-okunur kalsın. Tek satır yazılsalardı her küçük değişiklik tüm dosyayı 'değişmiş' gösterirdi.",
    exercise:
      "Aynı indeksi girintili ve girintisiz yaz, ikisini de bir alan değiştirdikten sonra `git diff | wc -l` ile ölç.",
    recipe: {
      id: "js-json",
      lang: "node",
      code:
        "const idx = { count: 2, items: [{ id: 'a' }, { id: 'b' }] };\n" +
        "const pretty = JSON.stringify(idx, null, 2);\n" +
        "console.log('satir:' + pretty.split('\\n').length + ' geri:' + JSON.parse(pretty).items.length);",
      expect: "geri:2",
      safety: "safe",
    },
    related: ["js-try-catch", "data-json-index"],
  },
  {
    id: "js-async-await",
    track: "js-ts",
    title: "async / await — sırayla okunan eşzamansız kod",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/async_function",
    pattern: /\basync\b|\bawait\b/,
    files: JSFILES,
    what:
      "`async` fonksiyon her zaman bir Promise döndürür; `await` o sözün çözülmesini bekler. Kod yukarıdan aşağı okunur ama bekleme sırasında çalışma zamanı başka işe geçebilir.",
    whyHere:
      "Ağ ve süreç çağrıları (brain :3000, alt-model) böyle yazılır. `await` unutulduğunda fonksiyon `Promise { <pending> }` döner ve 'sonuç boş geldi' diye yanlış teşhis edilir — bu depoda birden çok kez yaşandı.",
    exercise:
      "`await` olmadan bir async fonksiyonun dönüşünü `console.log` ile yaz. Çıktı neden veri değil?",
    recipe: {
      id: "js-async-await",
      lang: "node",
      code:
        "const gecikmeli = async (v) => v;\n" +
        "(async () => {\n" +
        "  const bekleyen = gecikmeli('deger');\n" +
        "  const cozulen = await gecikmeli('deger');\n" +
        "  console.log('await-yok:' + (bekleyen instanceof Promise) + ' await-var:' + cozulen);\n" +
        "})();",
      expect: "await-yok:true await-var:deger",
      safety: "safe",
    },
    related: ["js-promise-all", "http-fetch"],
  },
  {
    id: "js-promise-all",
    track: "js-ts",
    title: "Promise.all / allSettled — paralel bekleme",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise/all",
    pattern: /Promise\.(all|allSettled|race)\(/,
    files: JSFILES,
    what:
      "`Promise.all` hepsini paralel başlatır ve BİRİ hata verirse tümünü reddeder. `allSettled` ise hepsini bekler ve her biri için ayrı sonuç verir — kısmi başarıyı görmek istediğinde doğru olan budur.",
    whyHere:
      "Kaynak çapalarını canlı denetlerken `allSettled` mantığı gerekir: bir kaynak 429 verdi diye diğer on kaynağın denetimi iptal edilmemeli, o tek kaynak SKIP sayılmalıdır.",
    exercise:
      "On URL'den biri hata verirken `all` ile `allSettled` sonuçlarını karşılaştır. Kapı hangisiyle dürüst olur?",
    recipe: {
      id: "js-promise-all",
      lang: "node",
      code:
        "(async () => {\n" +
        "  const isler = [Promise.resolve(200), Promise.reject(new Error('429')), Promise.resolve(200)];\n" +
        "  const r = await Promise.allSettled(isler);\n" +
        "  const ok = r.filter((x) => x.status === 'fulfilled').length;\n" +
        "  console.log('basarili:' + ok + ' atlanan:' + (r.length - ok));\n" +
        "})();",
      expect: "basarili:2 atlanan:1",
      safety: "safe",
    },
    related: ["js-async-await", "http-rate-limit"],
  },
  {
    id: "js-try-catch",
    track: "js-ts",
    title: "try / catch / throw — hata sınırları",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/try...catch",
    pattern: /\btry\s*\{|throw new Error\(/,
    files: JSFILES,
    what:
      "`try` bloğundaki hata `catch`'e düşer. Yakalayıp yutmak en tehlikeli desendir: hata kaybolur, program yanlış veriyle devam eder. Yakala–zenginleştir–yeniden at genellikle doğrudur.",
    whyHere:
      "`sourceById()` bilinmeyen id'de bilerek `throw` eder. Sessizce `undefined` dönseydi, bir yazım hatası derste kaynaksız bir çapa olarak görünür ve kapı bunu ancak çok sonra yakalardı — hatanın en ucuz olduğu an, oluştuğu andır.",
    exercise:
      "`sourceById('mdnn')` çağır. Hata mesajı hangi bilgiyi içeriyor ve bu neden `undefined` dönmekten iyi?",
    recipe: {
      id: "js-try-catch",
      lang: "node",
      code:
        "const IDS = ['mdn', 'w3schools'];\n" +
        "function sourceById(id) { const s = IDS.includes(id); if (!s) throw new Error(\"unknown source id '\" + id + \"'\"); return id; }\n" +
        "try { sourceById('mdnn'); } catch (e) { console.log('yakalandi: ' + e.message); }",
      expect: "yakalandi: unknown source id 'mdnn'",
      safety: "safe",
    },
    related: ["ts-narrowing", "py-try-except"],
  },
  {
    id: "js-modules",
    track: "js-ts",
    title: "import / export — modül sınırları",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules",
    pattern: /^\s*import .* from ["']|^\s*export (const|function|interface|type|class)/m,
    files: TSFILES,
    what:
      "Her dosya kendi kapsamıdır; dışarı yalnız `export` edilen görünür. `import type` yalnız tip taşır ve derlemede tamamen silinir.",
    whyHere:
      "Bu depoda saf model (`helpsite.ts`, `learnsite.ts`) ile G/Ç yapan üretici (`bin/*.ts`) ayrılır. Saf tarafın hiçbir `node:fs` importu yoktur; bu yüzden doğrulayıcı testte diske dokunmadan çalışır — 'saf' iddiası import listesiyle kanıtlanabilir.",
    exercise:
      "`grep -cE '^import .*node:fs' pipeline/lib/learnsite.ts` çalıştır. Sonuç neden 0 olmalı? (Dosyada `node:fs` YAZISI yorumda geçiyor — bu yüzden desen satır başına çapalanmalı.)",
    recipe: {
      id: "js-modules",
      lang: "bash",
      code: "grep -cE '^import .*node:fs' \"$HOME/Desktop/ollamas/pipeline/lib/learnsite.ts\" || true",
      expect: "0",
      safety: "safe",
    },
    related: ["node-fs", "ts-interface"],
  },
  {
    id: "node-fs",
    track: "js-ts",
    title: "node:fs — dosya okuma ve yazma",
    level: "orta",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/fs.html",
    pattern: /readFileSync|writeFileSync|mkdirSync|existsSync|readdirSync/,
    files: JSFILES,
    what:
      "`readFileSync`/`writeFileSync` senkron çalışır: basit betikler için doğru, sunucu isteği içinde yanlıştır (olay döngüsünü bloklar). `mkdirSync(..., {recursive:true})` iç içe klasörü tek çağrıda kurar.",
    whyHere:
      "Üretici betikler tek seferlik çalışır ve sıralı davranmaları okunurluk kazandırır, o yüzden senkron API tercih edilir. Sunucu tarafında (`server/*.ts`) aynı çağrılar bilinçli olarak kullanılmaz.",
    exercise:
      "`mkdirSync` çağrısından `{recursive:true}` seçeneğini kaldır ve iki kademe derin bir klasöre yazmayı dene. Hata kodu ne?",
    recipe: {
      id: "node-fs",
      lang: "node",
      code:
        "const { existsSync } = require('node:fs');\n" +
        "const { join } = require('node:path');\n" +
        "const p = join(process.env.HOME, 'ollamas-vault', '_index', 'cc-capsules.json');\n" +
        "console.log(existsSync(p) ? 'kapsul-indeksi-var' : 'yok');",
      expect: "kapsul-indeksi-var",
      safety: "safe",
    },
    related: ["node-path", "js-modules"],
  },
  {
    id: "node-path",
    track: "js-ts",
    title: "node:path ve os.homedir — taşınabilir yollar",
    level: "temel",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/path.html",
    pattern: /from "node:path"|from "node:os"|homedir\(\)|\bjoin\(/,
    files: JSFILES,
    what:
      "`join` yol parçalarını platformun ayracıyla birleştirir ve fazladan eğik çizgileri temizler. Elle `\"a\" + \"/\" + \"b\"` yazmak, çift ayraç ve platform farkı üretir.",
    whyHere:
      "Vault kökü `join(homedir(), 'ollamas-vault')` ile bulunur ve `OBSIDIAN_VAULT` ortam değişkeniyle geçersiz kılınabilir. Sabit `/Users/...` yazılsaydı bu araçlar başka bir kullanıcıda hiç çalışmazdı.",
    exercise:
      "`join('a/', '/b', 'c')` ne döndürür? Elle birleştirmeyle farkı ne?",
    recipe: {
      id: "node-path",
      lang: "node",
      code:
        "const { join } = require('node:path');\n" +
        "console.log(join('a/', '/b', 'c') + ' vs ' + ('a/' + '/' + '/b' + '/' + 'c'));",
      expect: "a/b/c vs a///b/c",
      safety: "safe",
    },
    related: ["node-fs", "js-nullish"],
  },
  {
    id: "node-child-process",
    track: "js-ts",
    title: "child_process — başka bir programı çalıştırmak",
    level: "ileri",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/child_process.html",
    pattern: /execFileSync|execFile\(|spawn\(|execSync/,
    files: JSFILES,
    what:
      "`execFile` programı DOĞRUDAN çalıştırır; `exec` ise araya bir kabuk sokar ve kabuk metakarakterlerini (`;`, `|`, `` ` ``) yorumlar. Dış girdi varsa `execFile` tercih edilir.",
    whyHere:
      "Orkestrada komut çalıştırma bilinçli olarak kabuksuzdur; tek istisna `| head -n N` desenidir ve o da sökülüp `execFile`'a argüman olarak verilir. Bu ayrım, katalogdan gelen bir komutun kabuk enjeksiyonuna dönüşmesini yapısal olarak engeller.",
    exercise:
      "`exec(\"echo hi; whoami\")` ile `execFile(\"echo\", [\"hi; whoami\"])` çıktılarını karşılaştır. Hangisi ikinci komutu çalıştırır?",
    recipe: {
      id: "node-child-process",
      lang: "node",
      code:
        "const { execFileSync } = require('node:child_process');\n" +
        "const out = execFileSync('echo', ['hi; whoami'], { encoding: 'utf8' }).trim();\n" +
        "console.log('kabuk-yok:' + out);",
      expect: "kabuk-yok:hi; whoami",
      safety: "safe",
    },
    related: ["agents-allowlist", "sh-command-substitution"],
  },
  {
    id: "node-process",
    track: "js-ts",
    title: "process.argv / env / exitCode",
    level: "orta",
    source: NODE,
    url: "https://nodejs.org/docs/latest/api/process.html",
    pattern: /process\.(argv|env|exit|exitCode)/,
    files: JSFILES,
    what:
      "`process.argv` komut satırı argümanlarıdır (ilk ikisi node ve betik yolu). `process.exitCode = 1` betiği hemen kesmeden başarısız işaretler — açık dosya tamponlarının boşalmasına izin verir.",
    whyHere:
      "Üretici betikler `--vault` gibi bayrakları `argv`'den okur ve doğrulama hatasında çıkış kodunu 1 yapar. Kapılar bu çıkış kodunu okur; `console.log('hata')` yazıp 0 dönmek, otomasyonda sahte yeşil üretir.",
    exercise:
      "Bir betik hata mesajı yazıp 0 ile çıksa, `launchd` bunu başarılı sayar mı? Bu neden 'sahte yeşil' denen şeydir?",
    recipe: {
      id: "node-process",
      lang: "node",
      code:
        "const argv = ['node', 'script.js', '--vault', '--json'];\n" +
        "const flags = argv.slice(2).filter((a) => a.startsWith('--'));\n" +
        "console.log('bayrak:' + flags.join(',') + ' home-var:' + Boolean(process.env.HOME));",
      expect: "bayrak:--vault,--json home-var:true",
      safety: "safe",
    },
    related: ["sh-exit-code", "js-array-filter"],
  },
];
