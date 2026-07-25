// track: web — HTML, CSS ve DOM.
//
// Bu depodaki web yüzeyi bilinçli olarak SIFIR BAĞIMLIDIR: yardım sitesi `file://` altında,
// ağ olmadan, hiçbir CDN'e dokunmadan çalışmak zorundadır. Bu kısıt izleğin tamamını belirler —
// framework dersi yok, platformun kendisi var. Kaynak çapası MDN; sıralama W3Schools'un
// HTML→CSS→JS akışını izler.
import type { Construct } from "./types";

const MDN = "mdn";
const W3 = "w3schools";

/**
 * Web dosyaları: gerçek `.html`/`.css` yüzeyleri VE onları üreten `htmlsite.ts`.
 * Üretici dahil edilir çünkü bu depoda CSS/JS'in çoğu orada bir metin sabiti olarak yaşar —
 * dersi orada göstermemek, kodun yarısını görmezden gelmek olurdu.
 */
const WEBFILES = /(\.(html|css)$|htmlsite\.ts$|helpsite\.ts$|landing\.(js|css)$)/;

export const WEB: Construct[] = [
  {
    id: "web-doctype-head",
    track: "web",
    title: "doctype, lang ve `<head>` sözleşmesi",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Glossary/Doctype",
    pattern: /<!doctype html>|<html lang=|<meta charset=/i,
    files: WEBFILES,
    what:
      "`<!doctype html>` tarayıcıyı standart moda alır; olmadığı zaman 'quirks mode' devreye girer ve kutu modeli eski kurallara döner. `<html lang=\"tr\">` ekran okuyucuya ve arama motoruna dili söyler, `<meta charset=\"UTF-8\">` Türkçe karakterlerin bozulmamasını sağlar.",
    whyHere:
      "Yardım sitesi `file://` üzerinden açılır; sunucu `Content-Type` başlığı GÖNDEREMEZ, dolayısıyla kodlama bilgisinin tek kaynağı `<meta charset>` etiketidir. Unutulduğunda 'ölçüm' kelimesi bozuk görünür — ve bu yalnızca yerel dosyada olur, sunucuda olmaz.",
    exercise:
      "`_web/help-home.html`'den `<meta charset>` satırını sil ve dosyayı çift tıkla. Türkçe harfler nasıl görünüyor?",
    recipe: {
      id: "web-doctype-head",
      lang: "bash",
      code: "grep -ci '<!doctype html>' \"$HOME/ollamas-vault/help/_web/help-home.html\" 2>/dev/null || printf '0\\n'",
      expect: "1",
      safety: "safe",
    },
    related: ["web-semantic", "web-meta-viewport"],
  },
  {
    id: "web-semantic",
    track: "web",
    title: "Anlamsal etiketler — header, nav, main, aside, footer",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Element#content_sectioning",
    pattern: /<(header|nav|main|aside|footer|section|article)[\s>]/,
    files: WEBFILES,
    what:
      "Anlamsal etiketler `div`'in yaptığı işi yapar ama ne olduklarını da söyler. Ekran okuyucular `main`'e doğrudan atlar, `nav` bölgesini listeler; arama motorları içeriği bu yapıdan çıkarır.",
    whyHere:
      "Yardım sitesinin iskeleti kenar-çubuğu + içerik + TOC üçlüsüdür ve üçü `nav`/`main`/`aside` ile işaretlenir. `div` kullanılsaydı klavye ile gezinen bir okuyucu içeriğe atlamak için 40 bağlantıyı tek tek geçmek zorunda kalırdı.",
    exercise:
      "Üretilen bir sayfada kaç `nav` bölgesi var? Birden fazlaysa hangisi `aria-label` taşıyor ve neden gerekiyor?",
    recipe: {
      id: "web-semantic",
      lang: "node",
      code:
        "const html = '<header><nav aria-label=\"Ana\"><a href=\"#\">x</a></nav></header><main><h1>T</h1></main><aside>TOC</aside>';\n" +
        "const tags = [...html.matchAll(/<(header|nav|main|aside)[\\s>]/g)].map((m) => m[1]);\n" +
        "console.log(tags.join(','));",
      expect: "header,nav,main,aside",
      safety: "safe",
    },
    related: ["web-a11y", "web-doctype-head"],
  },
  {
    id: "web-meta-viewport",
    track: "web",
    title: "viewport ve responsive temel",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTML/Viewport_meta_tag",
    pattern: /<meta name="viewport"/,
    files: WEBFILES,
    what:
      "`<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` olmadan mobil tarayıcı sayfayı 980 piksel genişlikte varsayıp küçültür; medya sorguların hiç tetiklenmez.",
    whyHere:
      "Sitenin mobil çekmece davranışı medya sorgularına bağlı. Viewport etiketi olmadan CSS doğru yazılsa bile telefon masaüstü düzenini küçültülmüş hâlde gösterirdi — 'CSS'im çalışmıyor' sanılan klasik hata.",
    exercise:
      "Viewport etiketini kaldırıp sayfayı telefon genişliğinde aç. `@media (max-width: 860px)` kuralı devreye giriyor mu?",
    recipe: {
      id: "web-meta-viewport",
      lang: "bash",
      code: "grep -c 'name=\"viewport\"' \"$HOME/Desktop/ollamas/web/index.html\"",
      expect: "1",
      safety: "safe",
    },
    related: ["css-media-query"],
  },
  {
    id: "css-variables",
    track: "web",
    title: "CSS özel değişkenleri (design token)",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/CSS/Using_CSS_custom_properties",
    pattern: /--[a-z-]+:\s*[^;]+;|var\(--/,
    files: WEBFILES,
    what:
      "`--bg: #fff;` bir değişken tanımlar, `var(--bg)` onu kullanır. Sass değişkenlerinden farkı: bunlar ÇALIŞMA ZAMANINDA yaşar, kaskad ile devralınır ve JavaScript'ten değiştirilebilir.",
    whyHere:
      "Tema anahtarı tek satırla çalışır çünkü tüm renkler `:root` üzerindeki dokuz değişkene bağlıdır. Koyu tema, bu dokuz değeri değiştiren tek bir seçicidir — her kural için ayrı koyu varyant yazmak gerekmez.",
    exercise:
      "`--accent` değişkenini `:root` yerine tek bir bileşende tanımla. Devralma nedeniyle hangi öğeler etkilenir?",
    recipe: {
      id: "css-variables",
      lang: "node",
      code:
        "const css = ':root{--bg:#fff;--fg:#111;--accent:#c96}[data-theme=dark]{--bg:#0b0d12;--fg:#e6e6e6}';\n" +
        "const tokens = new Set([...css.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));\n" +
        "console.log('token:' + [...tokens].sort().join(','));",
      expect: "token:accent,bg,fg",
      safety: "safe",
    },
    related: ["css-dark-mode", "css-media-query"],
  },
  {
    id: "css-flex-grid",
    track: "web",
    title: "Flexbox ve Grid — düzenin iki aracı",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/CSS/CSS_grid_layout",
    pattern: /display:\s*(flex|grid)|grid-template|flex:\s*\d/,
    files: WEBFILES,
    what:
      "Flexbox tek eksende dizer (satır ya da sütun), Grid iki eksende yerleştirir. Kart ızgarası için `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` deseni, medya sorgusu YAZMADAN responsive olur.",
    whyHere:
      "Açılış kart-ızgarası tam olarak bu desendir; kırılma noktası sayısı sıfırdır. Sabit sütun sayısı verilseydi her ekran genişliği için ayrı bir `@media` bloğu gerekirdi ve site 3 yerine 8 kuralla bakılır olurdu.",
    exercise:
      "`minmax(240px, 1fr)` yerine sabit `1fr 1fr 1fr` yaz. 400 piksel genişlikte ne olur?",
    recipe: {
      id: "css-flex-grid",
      lang: "node",
      code:
        "const rule = 'grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))';\n" +
        "const w = 1000, min = 240;\n" +
        "console.log('sutun:' + Math.max(1, Math.floor(w / min)) + ' kural-medyasiz:' + !rule.includes('@media'));",
      expect: "sutun:4 kural-medyasiz:true",
      safety: "safe",
    },
    related: ["css-media-query", "css-variables"],
  },
  {
    id: "css-media-query",
    track: "web",
    title: "@media — kırılma noktaları",
    level: "orta",
    source: W3,
    url: "https://developer.mozilla.org/docs/Web/CSS/CSS_media_queries",
    pattern: /@media[^{]*\(/,
    files: WEBFILES,
    what:
      "`@media (max-width: 860px) { ... }` yalnız o genişliğin altında uygulanır. Kırılma noktası cihaz modeline göre değil, DÜZENİN bozulduğu genişliğe göre seçilir.",
    whyHere:
      "Tek bir kırılma noktası var: kenar-çubuğunun çekmeceye dönüştüğü genişlik. Fazlası bakım yüküdür — her ek kırılma, tema × düzen kombinasyonlarını ikiye katlar.",
    exercise:
      "Sitenin CSS'inde kaç `@media` bloğu var? Her biri hangi düzen bozulmasını çözüyor?",
    recipe: {
      id: "css-media-query",
      lang: "node",
      code:
        "const css = '@media (max-width: 860px){.side{display:none}} @media print{.nav{display:none}}';\n" +
        "console.log('media-blok:' + [...css.matchAll(/@media/g)].length);",
      expect: "media-blok:2",
      safety: "safe",
    },
    related: ["css-flex-grid", "css-dark-mode"],
  },
  {
    id: "css-dark-mode",
    track: "web",
    title: "prefers-color-scheme ve tema anahtarı",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/CSS/@media/prefers-color-scheme",
    pattern: /prefers-color-scheme|data-theme/,
    files: WEBFILES,
    what:
      "`@media (prefers-color-scheme: dark)` işletim sisteminin tercihini okur. Kullanıcı bunu sayfa üzerinden DEĞİŞTİREBİLMELİYSE, tercih `data-theme` gibi bir nitelikte saklanmalı ve o nitelik medya sorgusunu geçersiz kılabilmelidir.",
    whyHere:
      "Site iki sinyali birlikte kullanır: varsayılan sistem tercihi, üzerine kullanıcının seçimi (`localStorage`). Yalnız medya sorgusu kullanılsaydı tema düğmesi hiç çalışmazdı; yalnız nitelik kullanılsaydı ilk açılış her zaman açık temada olurdu.",
    exercise:
      "`data-theme` niteliğini kaldır ve düğmeye bas. Tema neden değişmiyor?",
    recipe: {
      id: "css-dark-mode",
      lang: "node",
      code:
        "const kayit = null;\n" +
        "const sistemKoyu = true;\n" +
        "const tema = kayit ?? (sistemKoyu ? 'dark' : 'light');\n" +
        "console.log('ilk-tema:' + tema + ' kullanici-secti:' + (kayit !== null));",
      expect: "ilk-tema:dark kullanici-secti:false",
      safety: "safe",
    },
    related: ["web-localstorage", "css-variables"],
  },
  {
    id: "dom-query",
    track: "web",
    title: "querySelector / querySelectorAll",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Document/querySelector",
    pattern: /querySelector(All)?\(/,
    files: WEBFILES,
    what:
      "`querySelector` ilk eşleşen öğeyi, `querySelectorAll` statik bir NodeList döndürür. `getElementsByClassName`'in aksine bu liste CANLI DEĞİLDİR: sonradan eklenen öğeler listeye girmez.",
    whyHere:
      "Arama kutusu ve TOC bağlantıları sayfa yüklendiğinde bir kez toplanır. Liste canlı olsaydı her DOM değişikliğinde yeniden hesaplanır ve büyük sayfalarda yazarken hissedilir gecikme olurdu.",
    exercise:
      "`querySelectorAll` sonucuna `map` uygulamayı dene. Neden önce `[...liste]` gerekir?",
    recipe: {
      id: "dom-query",
      lang: "node",
      code:
        "const nodeListBenzeri = { 0: 'h2#a', 1: 'h2#b', length: 2 };\n" +
        "const dizi = Array.from(nodeListBenzeri);\n" +
        "console.log('toc:' + dizi.join(',') + ' map-var:' + (typeof dizi.map === 'function'));",
      expect: "toc:h2#a,h2#b map-var:true",
      safety: "safe",
    },
    related: ["dom-events", "js-array-map"],
  },
  {
    id: "dom-events",
    track: "web",
    title: "addEventListener ve olay delegasyonu",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener",
    pattern: /addEventListener\(/,
    files: WEBFILES,
    what:
      "`addEventListener` aynı olaya birden fazla dinleyici bağlayabilir (`onclick=` bağlayamaz, üzerine yazar). Olaylar kabarcıklanır: tek bir üst öğeye dinleyici koyup `event.target` ile hangi çocuğa tıklandığını bulmak, yüz düğmeye yüz dinleyici bağlamaktan ucuzdur.",
    whyHere:
      "Kopyala düğmeleri delegasyonla çalışır: her kod bloğuna ayrı dinleyici bağlanmaz, `main` üzerinde tek dinleyici vardır. 200 kod bloklu bir sayfada bu, 200 kapanış nesnesinin oluşmaması demektir.",
    exercise:
      "Kopyala düğmelerine tek tek dinleyici bağlayan bir sürüm yaz ve 200 blokta bellek farkını tartış.",
    recipe: {
      id: "dom-events",
      lang: "node",
      code:
        "const dinleyiciler = [];\n" +
        "const on = (hedef) => dinleyiciler.push(hedef);\n" +
        "on('main');\n" +
        "const bloklar = 200;\n" +
        "console.log('delegasyon:' + dinleyiciler.length + ' naif:' + bloklar);",
      expect: "delegasyon:1 naif:200",
      safety: "safe",
    },
    related: ["dom-query", "web-clipboard"],
  },
  {
    id: "dom-classlist",
    track: "web",
    title: "classList ve dataset",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Element/classList",
    pattern: /classList\.(add|remove|toggle|contains)|\.dataset\./,
    files: WEBFILES,
    what:
      "`classList.toggle('acik')` sınıfı ekler/çıkarır; `className` ile metin birleştirmekten güvenlidir çünkü diğer sınıfları silmez. `dataset.slug`, HTML'deki `data-slug` niteliğini okur — durum bilgisini DOM'da tutmanın standart yolu.",
    whyHere:
      "Aktif kenar-çubuğu bağlantısı ve açık çekmece durumu sınıflarla tutulur; arama sonucu eşleşmeleri `data-*` nitelikleriyle işaretlenir. Ayrı bir JavaScript durum nesnesi tutulmadığı için DOM ile durum arasında tutarsızlık oluşamaz.",
    exercise:
      "`className = 'aktif'` ile `classList.add('aktif')` arasında, öğede zaten `kart` sınıfı varken ne fark eder?",
    recipe: {
      id: "dom-classlist",
      lang: "node",
      code:
        "let siniflar = new Set(['kart']);\n" +
        "siniflar.add('aktif');\n" +
        "const naif = 'aktif';\n" +
        "console.log('classlist:' + [...siniflar].join(' ') + ' | className:' + naif);",
      expect: "classlist:kart aktif | className:aktif",
      safety: "safe",
    },
    related: ["dom-query", "css-dark-mode"],
  },
  {
    id: "web-localstorage",
    track: "web",
    title: "localStorage — kalıcı küçük durum",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Window/localStorage",
    pattern: /localStorage\.(getItem|setItem|removeItem)/,
    files: WEBFILES,
    what:
      "`localStorage` yalnız METİN saklar; nesne koyacaksan `JSON.stringify` gerekir. Alan doluysa ya da tarayıcı özel moddaysa `setItem` İSTİSNA atar — bu yüzden çağrı `try` içine alınmalıdır.",
    whyHere:
      "Tema tercihi burada tutulur. `file://` altında bazı tarayıcılar depolamayı kısıtlar; sarmalayıcı `try` olmadan sitenin TÜM betiği ilk satırda çökerdi ve arama da tema da çalışmazdı.",
    exercise:
      "Depolamayı devre dışı bırakılmış bir bağlamda `setItem` çağır. Hata yakalanmazsa sayfanın kalan JavaScript'i çalışır mı?",
    recipe: {
      id: "web-localstorage",
      lang: "node",
      code:
        "const store = { veri: {}, setItem(k, v) { if (k === 'kilitli') throw new Error('QuotaExceeded'); this.veri[k] = String(v); } };\n" +
        "let saglam = true;\n" +
        "try { store.setItem('kilitli', 'dark'); } catch { saglam = true; }\n" +
        "store.setItem('tema', 'dark');\n" +
        "console.log('tema:' + store.veri.tema + ' sayfa-ayakta:' + saglam);",
      expect: "tema:dark sayfa-ayakta:true",
      safety: "safe",
    },
    related: ["css-dark-mode", "js-try-catch"],
  },
  {
    id: "web-clipboard",
    track: "web",
    title: "Clipboard API ve güvenli bağlam kısıtı",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Clipboard/writeText",
    pattern: /navigator\.clipboard|execCommand\(['"]copy/,
    files: WEBFILES,
    what:
      "`navigator.clipboard.writeText()` bir Promise döndürür ve yalnız GÜVENLİ BAĞLAMDA (https ya da localhost) tanımlıdır. `file://` üzerinde çoğu tarayıcıda `undefined`'dır; bu yüzden yedek yol gerekir.",
    whyHere:
      "Kopyala düğmesi sitenin `file://` altında da çalışması gereken bir özelliği. API yoksa düğme sessizce kaybolmaz — geçici bir `textarea` üzerinden eski yönteme düşer. 'Özellik yoksa kullanıcıya bozuk düğme gösterme' kuralı burada somutlaşır.",
    exercise:
      "Siteyi `file://` ile aç ve kopyala düğmesine bas. Hangi yol çalıştı? Konsolda hata var mı?",
    recipe: {
      id: "web-clipboard",
      lang: "node",
      code:
        "const navigatorSahte = {};\n" +
        "const yol = navigatorSahte.clipboard ? 'modern-api' : 'yedek-textarea';\n" +
        "console.log('secilen:' + yol);",
      expect: "secilen:yedek-textarea",
      safety: "safe",
    },
    related: ["dom-events", "web-a11y"],
  },
  {
    id: "web-a11y",
    track: "web",
    title: "Erişilebilirlik — aria-label, skip link, odak",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/Accessibility/ARIA",
    pattern: /aria-[a-z]+=|role="|skip.?to.?content|tabindex=/i,
    files: WEBFILES,
    what:
      "`aria-label` görsel metni olmayan bir öğeye ad verir; iki `nav` varsa ikisini ayırmak için gereklidir. 'İçeriğe atla' bağlantısı, klavyeyle gezen kullanıcıyı kenar çubuğunu geçmeye zorlamadan `main`'e taşır.",
    whyHere:
      "Referans sitelerin hepsinde bu çapa var ve özellik sözleşmesine alındı. Erişilebilirlik burada bir ekleme değil, kabul kriteri: klavyeyle üç sekmede içeriğe ulaşılamıyorsa sayfa tamamlanmamıştır.",
    exercise:
      "Sayfayı yalnız klavye ile gez. `main` içeriğine ulaşmak kaç `Tab` sürüyor?",
    recipe: {
      id: "web-a11y",
      lang: "node",
      code:
        "const html = '<a class=\"skip\" href=\"#main\">Icerige atla</a><nav aria-label=\"Ana\"></nav><nav aria-label=\"Bolum\"></nav>';\n" +
        "const labels = [...html.matchAll(/aria-label=\"([^\"]+)\"/g)].map((m) => m[1]);\n" +
        "console.log('skip:' + html.includes('href=\"#main\"') + ' nav-adlari:' + labels.join('/'));",
      expect: "skip:true nav-adlari:Ana/Bolum",
      safety: "safe",
    },
    related: ["web-semantic", "dom-events"],
  },
  {
    id: "web-xss-escape",
    track: "web",
    title: "HTML kaçırma — üretilen sayfada güvenlik",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/Security/Attacks/XSS",
    pattern: /escapeHtml|&amp;|&lt;|innerHTML/,
    files: WEBFILES,
    what:
      "Metni HTML'e gömerken `&`, `<`, `>`, `\"` karakterleri kaçırılmalıdır. `innerHTML` ile veri yazmak, o verinin kod olarak çalışmasına izin verir; `textContent` ise her zaman metin olarak yazar.",
    whyHere:
      "Site kendi verimizden üretiliyor diye kaçırma atlanmaz: ders başlıkları ve kaynak URL'leri veri dosyalarından gelir ve yarın bir başkası düzenleyebilir. `escapeHtml` ayrı bir fonksiyondur ki her çağrı yerinde görünür olsun — satır içi yazılsaydı unutulduğu fark edilmezdi.",
    exercise:
      "Bir ders başlığına `<img src=x onerror=alert(1)>` yaz, siteyi üret ve HTML çıktısına bak. Kaçırma çalıştı mı?",
    recipe: {
      id: "web-xss-escape",
      lang: "node",
      code:
        "const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n" +
        "console.log(esc('<img src=x onerror=\"alert(1)\">'));",
      expect: "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
      safety: "safe",
    },
    related: ["js-template-literal", "web-a11y"],
  },
  {
    id: "web-anchor-link",
    track: "web",
    title: "Başlık çapaları ve sayfa-içi gezinme",
    level: "temel",
    source: W3,
    url: "https://developer.mozilla.org/docs/Web/HTML/Global_attributes/id",
    pattern: /<h[23][^>]*id="|href="#/,
    files: WEBFILES,
    what:
      "Bir başlığa `id` verirsen `#id` ile doğrudan ona bağlanılabilir. `id` değerleri sayfada BENZERSİZ olmalı; iki aynı `id` varsa tarayıcı ilkine gider ve ikinci bağlantı sessizce yanlış yere götürür.",
    whyHere:
      "Sağdaki 'bu sayfada' listesi başlıkların `id`'lerinden üretilir. Slug üretici Türkçe harfleri katlar ve çakışmaya sayı ekler; katlama olmasaydı 'Ölçüm' ve 'Olcum' başlıkları aynı `id`'yi üretirdi.",
    exercise:
      "Bir sayfada aynı metinli iki H2 oluştur. Üretilen `id`'ler farklı mı? TOC ikinciye gidiyor mu?",
    recipe: {
      id: "web-anchor-link",
      lang: "node",
      code:
        "const slug = (s) => s.toLowerCase().replace(/[çğıöşü]/g, (c) => ({ 'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u' })[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n" +
        "const ids = ['Ölçüm', 'Olcum'].map(slug);\n" +
        "const benzersiz = ids.map((id, i) => (ids.indexOf(id) === i ? id : id + '-' + i));\n" +
        "console.log(benzersiz.join(','));",
      expect: "olcum,olcum-1",
      safety: "safe",
    },
    related: ["md-heading", "web-semantic"],
  },
];
