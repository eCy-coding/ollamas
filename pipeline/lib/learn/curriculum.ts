// curriculum — the MDN/W3Schools chapter walk, and the account we owe for every chapter.
//
// WHY THIS EXISTS
// The operator asked for the sources to be walked "sırayla tüm bilgileri" — in order, all of it.
// `learn-inventory.ts` answers a different question: it proves coverage against OUR CODE. That
// leaves the other half unanswered: *which chapter of the HTML tutorial is covered, which is not,
// and why not?* Without this file the tier can only say "we teach 175 things"; with it, it can
// say "here is the full chapter list, and here is where each one went".
//
// THE ACCOUNTING RULE
// Every chapter must carry exactly one of three verdicts — there is no blank:
//   • `covered`       → the lesson id that teaches it
//   • `not-used-here` → this codebase does not use it; the reason is stated, and the claim is
//                       falsifiable (run the detector, get zero)
//   • `external`      → real topic, deliberately out of scope (a different stack)
// `curriculumCoverage = (covered + not-used-here + external) / total` must be 1.0, because the
// promise is that every chapter is ACCOUNTED FOR — not that every chapter is taught. Teaching a
// topic this codebase never uses would mean writing a stub, and a stub is the one thing this
// tier refuses to ship.
//
// LICENCE
// Chapter TITLES are taxonomy — the structural fact that a tutorial has a chapter called
// "Attributes". No sentence, example or explanation is taken from any source; every `why` below
// is written here. This is the same line `learnrefs.ts` draws with `textPolicy`.

export type ChapterStatus = "covered" | "not-used-here" | "external";

export interface Chapter {
  title: string;
  status: ChapterStatus;
  /** Lesson id for `covered`. */
  lesson?: string;
  /** Mandatory for `not-used-here` / `external` — the honest reason. */
  why?: string;
}

export interface CurriculumUnit {
  /** Source id from LEARN_SOURCES. */
  source: string;
  /** Which of our tracks this unit maps onto. */
  track: string;
  title: string;
  /** Deep link to the source's index for this unit. */
  url: string;
  chapters: Chapter[];
}

const c = (title: string, lesson: string): Chapter => ({ title, status: "covered", lesson });
const n = (title: string, why: string): Chapter => ({ title, status: "not-used-here", why });
const x = (title: string, why: string): Chapter => ({ title, status: "external", why });

/**
 * The units, in the operator's order: MDN first, W3Schools second, then the rest.
 * Chapter lists follow each source's own ordering.
 */
export const CURRICULUM_UNITS: CurriculumUnit[] = [
  /* ─────────────────────────────────────────────── 1. MDN — HTML */
  {
    source: "mdn",
    track: "web",
    title: "MDN — HTML (yapı)",
    url: "https://developer.mozilla.org/docs/Web/HTML",
    chapters: [
      c("Belge yapısı, doctype ve head", "web-doctype-head"),
      c("Anlamsal bölümleme (header/nav/main/aside/footer)", "web-semantic"),
      c("Metin içeriği ve listeler", "md-list-task"),
      c("Bağlantılar ve çapa id'leri", "web-anchor-link"),
      c("Bağlantı ilişkileri (rel)", "web-rel-attr"),
      c("Görseller ve alternatif metin", "web-img-alt"),
      c("Tablolar", "web-table"),
      c("Formlar ve girdi öğeleri", "web-form"),
      c("Etkileşimli öğeler (details/summary)", "web-details"),
      c("Viewport ve responsive temel", "web-meta-viewport"),
      c("Erişilebilirlik ve ARIA", "web-a11y"),
      c("Güvenlik: kullanıcı içeriğini kaçırmak", "web-xss-escape"),
      n("Multimedya (audio/video)", "Bu dört sistemde ses/video gömülü yüzey yok; `<video`/`<audio` taraması 0 dosya."),
      n("Canvas / WebGL", "Görselleştirme Obsidian Canvas (JSON) ile yapılıyor, tarayıcı canvas API'siyle değil."),
      n("Web bileşenleri (custom elements, shadow DOM)", "Yüzeyler sıfır-bağımlı düz HTML; `customElements.define` 0 dosya."),
      n("iframe ve gömülü içerik", "Gömme kullanılmıyor; CSP kısıtı ve `file://` hedefi nedeniyle bilinçli."),
    ],
  },
  /* ─────────────────────────────────────────────── 2. MDN — CSS */
  {
    source: "mdn",
    track: "web",
    title: "MDN — CSS (sunum)",
    url: "https://developer.mozilla.org/docs/Web/CSS",
    chapters: [
      c("Özel değişkenler (design token)", "css-variables"),
      c("Flexbox ve Grid düzeni", "css-flex-grid"),
      c("Medya sorguları ve kırılma noktaları", "css-media-query"),
      c("Renk şeması ve tema (prefers-color-scheme)", "css-dark-mode"),
      c("Konumlandırma (sticky/fixed)", "css-sticky"),
      c("Geçişler, animasyon ve hareket tercihi", "css-transition"),
      n("Cascade layers (@layer)", "Tek dosyalık, çakışmasız stil; katman soyutlaması gerekmedi."),
      n("Container queries", "Tek kırılma noktası yeterli; bileşen-bazlı sorgu kullanılmıyor."),
      n("CSS preprocessor (Sass/Less)", "Sıfır-bağımlılık kuralı: derleme adımı yok, düz CSS."),
      n("Print stilleri", "Çıktı hedefi ekran ve `file://`; baskı yüzeyi yok."),
    ],
  },
  /* ─────────────────────────────────────────────── 3. MDN — JavaScript / DOM */
  {
    source: "mdn",
    track: "js-ts",
    title: "MDN — JavaScript dili",
    url: "https://developer.mozilla.org/docs/Web/JavaScript",
    chapters: [
      c("Değişkenler, kapsam ve modüller", "js-modules"),
      c("Metin işleme (String metodları)", "js-string-methods"),
      c("Şablon metinleri", "js-template-literal"),
      c("Sayılar ve Math", "js-math"),
      c("Sayı ayrıştırma ve doğrulama", "js-number-parse"),
      c("Tarih ve zaman", "js-date"),
      c("Diziler: map", "js-array-map"),
      c("Diziler: filter", "js-array-filter"),
      c("Diziler: reduce", "js-array-reduce"),
      c("Diziler: sort ve karşılaştırıcı", "js-array-sort"),
      c("Diziler: some/every/includes", "js-array-some-every"),
      c("Diziler: slice", "js-array-slice"),
      c("Diziler ↔ metin (join/split)", "js-array-join"),
      c("Nesneler: keys/entries/fromEntries", "js-object-entries"),
      c("Ayrıştırma (destructuring) ve spread", "js-destructuring"),
      c("Set ve Map", "js-set"),
      c("WeakMap ve WeakSet", "js-weakmap"),
      c("Düzenli ifadeler", "js-regex"),
      c("JSON", "js-json"),
      c("Koşullar: switch ve fall-through", "js-switch"),
      c("Nullish birleştirme (??)", "js-nullish"),
      c("İsteğe bağlı zincir (?.)", "js-optional-chain"),
      c("Hata yakalama (try/catch/throw)", "js-try-catch"),
      c("finally ve temizlik", "js-finally"),
      c("Özel hata tipleri", "js-error-subclass"),
      c("Sınıflar", "js-class"),
      c("Getter/setter", "js-getter"),
      c("Üreteçler (generator, yield)", "js-generator"),
      c("async/await", "js-async-await"),
      c("Promise.all / allSettled", "js-promise-all"),
      c("for await ve eşzamansız akış", "js-for-await"),
      c("Zamanlayıcılar", "js-timers"),
      c("URL ve URLSearchParams", "js-url"),
      n("Prototip zinciri ve `this` bağlama", "Kod sınıf + saf fonksiyon kullanıyor; `bind/call/apply` 0 anlamlı kullanım."),
      n("Proxy / Reflect", "Meta-programlama kullanılmıyor; kasıtlı sadelik."),
      n("Symbol ve iyi bilinen semboller", "Tek kullanım var, desen oluşturacak yoğunlukta değil."),
      n("BigInt", "Sayısal alan bayt/sayaç düzeyinde; 2^53 sınırına yaklaşan değer yok."),
      n("Etiketli şablonlar (tagged templates)", "Kullanılmıyor; kaçırma ayrı fonksiyonla yapılıyor."),
    ],
  },
  {
    source: "mdn",
    track: "web",
    title: "MDN — Web API'leri (DOM)",
    url: "https://developer.mozilla.org/docs/Web/API",
    chapters: [
      c("Öğe seçme (querySelector)", "dom-query"),
      c("Olaylar ve delegasyon", "dom-events"),
      c("classList ve dataset", "dom-classlist"),
      c("Web Storage (localStorage)", "web-localstorage"),
      c("Clipboard API ve güvenli bağlam", "web-clipboard"),
      c("fetch ile istek", "http-fetch"),
      c("AbortController ve zaman aşımı", "http-timeout"),
      n("History API / Routing", "Sayfalar statik; istemci-taraflı yönlendirme yok."),
      n("IntersectionObserver / ResizeObserver", "Tembel yükleme gerekmiyor, sayfalar küçük."),
      n("Service Worker / PWA önbelleği", "`file://` hedefi service worker'ı zaten dışlar."),
      n("WebSocket", "Akış SSE ile yapılıyor; çift yönlü kanal gerekmedi."),
    ],
  },
  /* ─────────────────────────────────────────────── 4. W3Schools sırası */
  {
    source: "w3schools",
    track: "js-ts",
    title: "W3Schools — TypeScript",
    url: "https://www.w3schools.com/typescript/",
    chapters: [
      c("Tipler ve tip takma adları", "ts-type-alias"),
      c("Arayüzler (interface)", "ts-interface"),
      c("Birleşim tipleri", "ts-union"),
      c("Tip daraltma (narrowing)", "ts-narrowing"),
      c("İsteğe bağlı alanlar", "ts-optional-prop"),
      c("Generic tipler", "ts-generic"),
      c("Yardımcı tipler (Record)", "ts-record"),
      c("const iddiaları (as const)", "ts-as-const"),
      c("satisfies işleci", "ts-satisfies"),
      n("Enum", "Kapalı kümeler `as const` + birleşim ile yazılıyor; `enum` çalışma-zamanı nesnesi üretir, tercih edilmedi."),
      n("Decorator", "Framework yok; dekoratör gerektiren bir katman bulunmuyor."),
      n("Namespace", "ES modülleri kullanılıyor; namespace eski bir mekanizma."),
      n("Şartlı ve eşlemeli tipler (conditional/mapped)", "Tip düzeyinde meta-programlama gerekmedi; okunurluk tercih edildi."),
    ],
  },
  {
    source: "w3schools",
    track: "python",
    title: "W3Schools — Python",
    url: "https://www.w3schools.com/python/",
    chapters: [
      c("Sözdizimi ve çalıştırılabilir betik (shebang)", "py-shebang"),
      c("Modül mü komut mu (__main__)", "py-main-guard"),
      c("Metin biçimlendirme (f-string)", "py-fstring"),
      c("Dilimleme", "py-slicing"),
      c("Listeler ve kurgular (comprehension)", "py-list-comp"),
      c("Sözlükler", "py-dict-get"),
      c("Kümeler", "py-set"),
      c("Koşullu ifade", "py-ternary"),
      c("any / all", "py-any-all"),
      c("Sıralama ve anahtar fonksiyonu", "py-sorted-key"),
      c("Frekans sayımı", "py-freq-count"),
      c("enumerate ve zip", "py-enumerate-zip"),
      c("Fonksiyonlar: lambda", "py-lambda"),
      c("Tip ipuçları", "py-type-hints"),
      c("Dosya G/Ç", "py-open-with"),
      c("JSON", "py-json"),
      c("Düzenli ifadeler", "py-regex"),
      c("Metin çevirme (str.translate)", "py-str-translate"),
      c("Hata yakalama", "py-try-except"),
      c("os.path ve ev dizini", "py-os-path"),
      c("Dosya ağacında gezinme (os.walk/glob)", "py-walk-glob"),
      c("Dosya kopyalama (shutil)", "py-shutil"),
      c("Alt süreç çalıştırma", "py-subprocess"),
      c("HTTP istekleri (urllib)", "py-urllib"),
      c("Komut satırı argümanları", "py-argv"),
      c("argparse", "py-argparse"),
      c("Hash (hashlib)", "py-hashlib"),
      c("Matematik ve logaritma", "py-math-log"),
      c("Çıkış kodu (sys.exit)", "py-sys-exit"),
      n("Sınıflar ve OOP", "Vault araçları modül-düzeyi fonksiyonlar; `class` tanımı 0 dosya."),
      n("Dataclass", "Sözlük + JSON şeması yeterli; sınıf yok."),
      n("Sanal ortam ve pip paketleri", "Sıfır-bağımlılık kuralı: yalnız standart kütüphane."),
      n("Üreteçler (yield)", "Python tarafında akış gerekmedi; dosyalar küçük."),
      n("datetime modülü", "Zaman damgası kabuk `date` ile üretiliyor; Python tarafında kullanılmıyor."),
      x("NumPy / Pandas / Matplotlib", "Veri bilimi yığını bu sistemlerin kapsamı dışında."),
    ],
  },
  {
    source: "w3schools",
    track: "shell",
    title: "W3Schools — Bash / Shell",
    url: "https://www.w3schools.com/bash/",
    chapters: [
      c("Betik başlatma ve set seçenekleri", "sh-shebang"),
      c("Değişkenler ve varsayılanlar", "sh-param-default"),
      c("Ev dizini ve taşınabilir yollar", "sh-home"),
      c("Ortam değişkenleri ve export", "sh-export-env"),
      c("Komut ikamesi", "sh-command-substitution"),
      c("Borular ve metin süzgeçleri", "sh-pipe"),
      c("Koşullar ve testler", "sh-test-if"),
      c("case ile dallanma", "sh-case"),
      c("Döngüler", "sh-loop"),
      c("Satır satır okuma", "sh-read-loop"),
      c("Fonksiyonlar", "sh-function"),
      c("Aritmetik", "sh-arithmetic"),
      c("printf ve renkler", "sh-printf"),
      c("Argüman ve bayrak ayrıştırma", "sh-arg-parse"),
      c("Çıkış kodları", "sh-exit-code"),
      c("Heredoc", "sh-heredoc"),
      c("Dosya bulma (find)", "sh-find"),
      c("tee ile günlükleme", "sh-tee"),
      c("Tarih damgası", "sh-date-stamp"),
      c("Kilit dosyası", "sh-lock"),
      c("Zamanlanmış görev (launchd)", "sh-launchd"),
      c("curl ile HTTP yoklama", "sh-curl-status"),
      n("Diziler ve ilişkisel diziler", "Betikler küçük; dizi gerektiren bir veri yapısı yok."),
      n("trap ve sinyal yakalama", "Kapılar kısa ömürlü; temizlik gerektiren uzun oturum yok."),
      n("getopts", "Bayrak sayısı 1-2; elle kontrol yeterli ve daha okunur."),
      n("sed -i / yerinde düzenleme", "Vault dosyaları Python araçlarıyla yazılıyor (UTF-8 ve idempotency kontrolü için)."),
    ],
  },
  {
    source: "w3schools",
    track: "data",
    title: "W3Schools — SQL",
    url: "https://www.w3schools.com/sql/",
    chapters: [
      c("Tablo oluşturma ve kısıtlar", "sql-create-table"),
      c("SELECT, WHERE, ORDER BY", "sql-select"),
      c("LIMIT / OFFSET", "sql-limit"),
      c("GROUP BY ve toplama", "sql-group-by"),
      c("INSERT ve UPSERT", "sql-upsert"),
      c("UPDATE ve DELETE", "sql-delete-update"),
      c("İndeksler", "sql-index"),
      c("Parametreli sorgu ve enjeksiyon", "sql-params"),
      c("İşlemler (transaction)", "sql-transaction"),
      n("JOIN türleri", "Şema tek tablolu ve gömme-merkezli; birleştirme gerektiren ilişki modeli yok."),
      n("View ve stored procedure", "SQLite gömülü kullanılıyor; sunucu-taraflı nesne yok."),
      n("Kullanıcı/yetki yönetimi (GRANT)", "Tek kullanıcılı yerel dosya veritabanı."),
      x("MySQL/PostgreSQL'e özgü sözdizimi", "Veri katmanı SQLite; başka motor kullanılmıyor."),
    ],
  },
  {
    source: "w3schools",
    track: "data",
    title: "W3Schools — JSON ve veri biçimleri",
    url: "https://www.w3schools.com/js/js_json_intro.asp",
    chapters: [
      c("JSON sözdizimi ve indeks dosyası", "data-json-index"),
      c("JSON ayrıştırma/serileştirme (JS)", "js-json"),
      c("JSON ve Unicode (Python)", "py-json"),
      c("JSONL — satır başına kayıt", "data-jsonl"),
      c("İçerik özeti ve deterministik id", "data-content-hash"),
      c("Bayt ve karakter farkı", "js-buffer"),
      n("XML / XSLT", "Yalnız launchd plist'i XML; onu düzenleyen bir katman yok."),
      n("YAML şema doğrulama", "Frontmatter ve `.base` elle yazılıyor; şema doğrulayıcı gerekmedi."),
      n("CSV", "Tablo verisi JSON indekslerinde tutuluyor."),
    ],
  },
  /* ─────────────────────────────────────────────── 5. Node.js */
  {
    source: "nodejs",
    track: "js-ts",
    title: "Node.js — çalışma zamanı",
    url: "https://nodejs.org/docs/latest/api/",
    chapters: [
      c("fs — dosya okuma/yazma", "node-fs"),
      c("path ve os.homedir", "node-path"),
      c("child_process", "node-child-process"),
      c("process: argv, env, exitCode", "node-process"),
      c("crypto — özet ve rastgelelik", "js-crypto-hash"),
      c("Buffer ve bayt uzunluğu", "js-buffer"),
      c("Test çalıştırıcı (vitest)", "js-test-vitest"),
      n("Stream API (pipe, Transform)", "Dosyalar küçük; senkron okuma bilinçli tercih."),
      n("Worker threads / cluster", "Paralellik süreç düzeyinde (bounded-parallel görevler) çözülüyor."),
      n("net / dgram (düşük seviye ağ)", "HTTP yeterli; ham soket kullanılmıyor."),
      n("Native addon / N-API", "Sıfır-bağımlılık ve taşınabilirlik kuralı."),
    ],
  },
  /* ─────────────────────────────────────────────── 6. HTTP */
  {
    source: "mdn",
    track: "http-api",
    title: "MDN — HTTP",
    url: "https://developer.mozilla.org/docs/Web/HTTP",
    chapters: [
      c("Metodlar ve uç tanımı", "http-route"),
      c("Durum kodları", "http-status"),
      c("İstek gövdesi ve doğrulama", "http-req-body"),
      c("Sorgu parametreleri", "http-query-params"),
      c("İçerik tipi ve JSON yanıt", "http-json"),
      c("Başlıklar ve yazım sırası", "http-headers"),
      c("Kimlik doğrulama (Bearer)", "http-auth"),
      c("Önbellek ve ETag", "http-cache-header"),
      c("Hız sınırı (429)", "http-rate-limit"),
      c("Server-Sent Events", "http-sse"),
      c("İstemci tarafı: fetch", "http-fetch"),
      c("Zaman aşımı ve iptal", "http-timeout"),
      c("API sözleşmesi (OpenAPI)", "http-openapi"),
      n("CORS", "Tüm tüketiciler aynı kaynakta (localhost); tarayıcı çapraz-origin çağrısı yok."),
      n("Çerezler ve oturum", "Kimlik Bearer başlığıyla; çerez kullanılmıyor."),
      n("HTTP/2 ve öncelik", "Yerel servis; protokol ayarı işletim sistemine bırakılıyor."),
      n("İçerik sıkıştırma (gzip/br)", "Yerel ağda gecikme yok; sıkıştırma kazancı ölçülebilir değil."),
    ],
  },
  /* ─────────────────────────────────────────────── 7. Obsidian */
  {
    source: "obsidian-help",
    track: "md-obsidian",
    title: "Obsidian Help — vault yüzeyleri",
    url: "https://obsidian.md/help/",
    chapters: [
      c("Markdown temel biçimlendirme", "md-heading"),
      c("Listeler ve görev kutuları", "md-list-task"),
      c("Tablolar", "md-table"),
      c("Kod blokları", "md-fence"),
      c("Callout kutuları", "md-callout"),
      c("Özellikler (frontmatter)", "md-frontmatter"),
      c("İç bağlantılar (wikilink)", "obs-wikilink"),
      c("Gömme (embed)", "obs-embed"),
      c("Kalıcı bağlantı footer'ı", "md-body-footer"),
      c("Dataview sorguları", "obs-dataview"),
      c("Bases (.base görünümleri)", "obs-base"),
      c("Canvas", "obs-canvas"),
      c("Graph görünümü ve renk grupları", "obs-graph-layers"),
      n("Publish / yayımlama", "Vault yerel ve gizli; dışa gönderim HİÇ (operatör kararı)."),
      n("Sync / çoklu cihaz", "Tek makine; yedekleme git + tar ile yapılıyor."),
      n("Excalidraw eklentisi", "Diyagramlar Canvas ve mermaid ile üretiliyor."),
    ],
  },
  /* ─────────────────────────────────────────────── 8. Ajan katmanı */
  {
    source: "claude-code-docs",
    track: "agents",
    title: "Claude Code — ajan katmanı",
    url: "https://code.claude.com/docs/en/quickstart",
    chapters: [
      c("Skill dosyaları", "agents-skill-frontmatter"),
      c("Slash komutları ve araç daraltma", "agents-slash-command"),
      c("Hook'lar", "agents-hook"),
      c("MCP sunucuları", "agents-mcp"),
      c("İzin listesi ve çalıştırma sınırı", "agents-allowlist"),
      c("Bağlam maliyeti ve kademeli açılım", "agents-capsule-first"),
      c("Oturum başlangıç bağlamı", "agents-progressive-context"),
      c("Token bütçesi", "agents-token-budget"),
      c("Doğruluk ölçümü (P@1/H@3)", "agents-quality-set"),
      c("Kalıcı bellek (UPSERT)", "agents-upsert-remember"),
      c("Çalıştırılabilir tarif sözleşmesi", "agents-recipe-contract"),
      c("Sağlık turu ve zarif degrade", "agents-health-loop"),
      c("Model yerine deterministik çözüm", "agents-determinism"),
      n("Alt-ajanlar (subagent) orkestrasyonu", "Bu tier tek-ajan; çok-ajan orkestrasyonu `orchestration/` lane'inin konusu."),
      n("Bulut/uzak yürütme", "Yerel ve $0 çalışma kuralı."),
    ],
  },
];

/** Aggregate numbers the gate re-checks. */
export function curriculumStats() {
  let total = 0;
  const by: Record<ChapterStatus, number> = { covered: 0, "not-used-here": 0, external: 0 };
  const unaccounted: string[] = [];
  for (const u of CURRICULUM_UNITS) {
    for (const ch of u.chapters) {
      total++;
      if (ch.status === "covered" && !ch.lesson) unaccounted.push(`${u.title}: ${ch.title} (ders yok)`);
      else if (ch.status !== "covered" && !ch.why) unaccounted.push(`${u.title}: ${ch.title} (gerekçe yok)`);
      by[ch.status]++;
    }
  }
  return {
    total,
    ...by,
    unaccounted,
    /** 1.0 when every chapter carries a verdict AND its required justification. */
    coverage: total === 0 ? 0 : (total - unaccounted.length) / total,
  };
}

/**
 * Validate the map against the real lesson set.
 * A `covered` chapter pointing at a non-existent lesson is the classic rot: the map claims
 * completeness the notes do not back. That must be an ERROR, not a warning.
 */
export function validateCurriculum(taughtIds: Set<string>): string[] {
  const errs: string[] = [];
  for (const u of CURRICULUM_UNITS) {
    // Cross-listing ACROSS units is legitimate and common: JSON really is a chapter in both the
    // JavaScript tutorial and the JSON tutorial, and `fetch` really appears under both Web APIs
    // and HTTP. Forbidding it would force us to duplicate a lesson just to satisfy the map —
    // exactly the duplication this tier refuses. What is NOT legitimate is the same lesson
    // answering two chapters of the SAME unit: that means one of the two chapters is unaccounted
    // for and is hiding behind a reused link.
    const withinUnit = new Map<string, string>();
    for (const ch of u.chapters) {
      if (ch.status !== "covered") continue;
      if (!ch.lesson || !taughtIds.has(ch.lesson)) {
        errs.push(`${u.title} → "${ch.title}" var olmayan derse işaret ediyor: ${ch.lesson}`);
        continue;
      }
      const prev = withinUnit.get(ch.lesson);
      if (prev) errs.push(`${u.title}: aynı ders iki bölümde — ${ch.lesson} ("${prev}" + "${ch.title}")`);
      else withinUnit.set(ch.lesson, ch.title);
    }
  }
  return errs;
}

/** Lessons deliberately answering chapters in more than one curriculum (informational). */
export function crossListed(): Array<{ lesson: string; units: string[] }> {
  const map = new Map<string, string[]>();
  for (const u of CURRICULUM_UNITS) {
    for (const ch of u.chapters) {
      if (ch.status !== "covered" || !ch.lesson) continue;
      const arr = map.get(ch.lesson) ?? [];
      if (!arr.includes(u.title)) arr.push(u.title);
      map.set(ch.lesson, arr);
    }
  }
  return [...map.entries()].filter(([, us]) => us.length > 1).map(([lesson, units]) => ({ lesson, units }));
}

/** Lessons that exist but no chapter points at them — the reverse gap. */
export function orphanLessons(taughtIds: Set<string>): string[] {
  const mapped = new Set<string>();
  for (const u of CURRICULUM_UNITS) for (const ch of u.chapters) if (ch.lesson) mapped.add(ch.lesson);
  return [...taughtIds].filter((id) => !mapped.has(id)).sort();
}

const BADGE: Record<ChapterStatus, string> = {
  covered: "✅ ders",
  "not-used-here": "➖ bu depoda kullanılmıyor",
  external: "↗︎ kapsam dışı",
};

/** The rendered chapter walk. Deterministic. */
export function renderCurriculumMd(stats: ReturnType<typeof curriculumStats>, orphans: string[]): string {
  const L: string[] = [
    "# Müfredat Yürüyüşü — kaynakların bölümleri, sırayla",
    "",
    "> Emre'nin isteği: *\"MDN web docs, ardından W3Schools, **sırayla tüm bilgileri**\"*.",
    "> Bu sayfa o yürüyüştür: her kaynağın bölüm listesi, kendi sırasıyla, ve her bölüm için",
    "> **bir hesap**. Üç sonuçtan biri yazılır, boş bırakılmaz:",
    "",
    "| İşaret | Anlamı |",
    "|--------|--------|",
    "| ✅ ders | O bölümü öğreten dersimiz var (bağlantılı) |",
    "| ➖ bu depoda kullanılmıyor | Bu dört sistem o yapıyı kullanmıyor; gerekçe yazılı ve **yanlışlanabilir** (dedektörü çalıştır, sıfır bulur) |",
    "| ↗︎ kapsam dışı | Gerçek bir konu ama başka bir yığın (ör. veri bilimi) |",
    "",
    `**Toplam bölüm: ${stats.total} · ✅ ${stats.covered} · ➖ ${stats["not-used-here"]} · ↗︎ ${stats.external} · hesabı verilmeyen: ${stats.unaccounted.length}**`,
    "",
    "> Neden \"her bölüm ders olsun\" demiyoruz: kullanılmayan bir konu için ders yazmak **taslak**",
    "> üretmek olurdu ve taslak, bu tier'ın reddettiği tek şeydir (`learnsite.ts` boş gövdeyi HATA",
    "> sayar). Kapsama iddiası bu yüzden \"hepsini öğretiyoruz\" değil, **\"hepsinin hesabını veriyoruz\"**.",
    "",
    "> Telif: buradaki bölüm **adları** taksonomidir (bir öğreticinin hangi bölümlere ayrıldığı,",
    "> yapısal bir olgudur). Hiçbir kaynaktan cümle, açıklama ya da örnek alınmamıştır.",
    "",
  ];

  for (const u of CURRICULUM_UNITS) {
    const cov = u.chapters.filter((ch) => ch.status === "covered").length;
    L.push(`## ${u.title}`);
    L.push("");
    L.push(`<${u.url}> · izlek [[learn-${u.track}]] · **${cov}/${u.chapters.length} bölüm dersli**`);
    L.push("");
    L.push("| # | Bölüm | Durum | Nerede |", "|---|-------|-------|--------|");
    u.chapters.forEach((ch, i) => {
      const where =
        ch.status === "covered" ? `[[learn-${ch.lesson}]]` : (ch.why ?? "").replace(/\|/g, "\\|");
      L.push(`| ${i + 1} | ${ch.title.replace(/\|/g, "\\|")} | ${BADGE[ch.status]} | ${where} |`);
    });
    L.push("");
  }

  const cross = crossListed();
  if (cross.length) {
    L.push("## Birden çok müfredatta geçen dersler", "");
    L.push("> Aynı ders farklı kaynakların bölüm listelerinde birden çok kez karşımıza çıkabilir");
    L.push("> (JSON hem JavaScript hem JSON öğreticisinde bir bölümdür). Ders **kopyalanmaz**;");
    L.push("> haritada iki yerden aynı nota bağlanılır.");
    L.push("");
    for (const cl of cross) L.push(`- [[learn-${cl.lesson}]] — ${cl.units.join(" · ")}`);
    L.push("");
  }

  if (orphans.length) {
    L.push("## Haritada yeri olmayan dersler", "");
    L.push("> Ters yöndeki boşluk: kodumuzdan kanıtlanmış ama yukarıdaki bölüm listelerinin");
    L.push("> hiçbirine düşmeyen dersler. Gizlenmez — kaynak taksonomisinde karşılığı olmayan,");
    L.push("> **bu sisteme özgü** bilgilerdir.");
    L.push("");
    for (const id of orphans) L.push(`- [[learn-${id}]]`);
    L.push("");
  }

  if (stats.unaccounted.length) {
    L.push("## ⚠️ Hesabı verilmeyen bölümler", "");
    for (const u of stats.unaccounted) L.push(`- ${u}`);
    L.push("");
  }

  L.push("---");
  L.push("**Hub:** [[learn]] · **Kaynaklar:** [[learn-kaynaklar]] · **Envanter:** [[learn-envanter]]");
  L.push("");
  return L.join("\n");
}
