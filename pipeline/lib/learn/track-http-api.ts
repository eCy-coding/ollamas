// track: http-api — sunucu uçları, istemci çağrıları ve hata sınıflandırması.
//
// Bu depoda HTTP iki yönlüdür: ollamas :3000 bir API SUNAR, aynı zamanda kapılar ve araçlar
// dışarıya İSTEK ATAR. İzleğin ağırlık merkezi durum kodlarını doğru YORUMLAMAKTIR — 429 ile
// 404'ü aynı kefeye koyan bir kapı, kalıcı yanlış alarm üretir.
import type { Construct } from "./types";

const MDN = "mdn";
const NODE = "nodejs";

const SERVERFILES = /(^|\/)server\/[\w-]+\.ts$|(^|\/)cli\/.*\.ts$/;
const CLIENTFILES = /(\.(ts|js|mjs|py|sh)$|(^|\/)(cckb|learnkb|ecy-[a-z]+)$)/;

export const HTTP_API: Construct[] = [
  {
    id: "http-route",
    track: "http-api",
    title: "Uç nokta tanımı — GET okur, POST değiştirir",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Methods",
    pattern: /app\.(get|post|put|delete)\(|router\.(get|post)\(/,
    files: SERVERFILES,
    what:
      "GET güvenli ve önbelleklenebilir olmalıdır: aynı isteği iki kez atmak durumu değiştirmemeli. Durum değiştiren her şey POST/PUT/DELETE'tir. Bu ayrım bir görgü kuralı değil; proxy'ler ve tarayıcılar GET'i istedikleri zaman tekrarlar.",
    whyHere:
      "`/api/brain/recall` GET mantığında bir sorgudur ama POST ile yazılmıştır çünkü sorgu gövdesi uzun ve yapılıdır. Karar bilinçlidir; bedeli, yanıtın önbelleklenememesidir — ve token maliyetinin kapsül katmanıyla çözülmesinin bir nedeni de budur.",
    exercise:
      "Sunucuda kaç GET, kaç POST ucu var? Durum değiştiren bir GET var mı?",
    recipe: {
      id: "http-route",
      lang: "node",
      code:
        "const kod = \"app.get('/api/health', h); app.post('/api/brain/remember', r); app.get('/api/docs', d);\";\n" +
        "const say = (m) => [...kod.matchAll(new RegExp('app\\\\.' + m + '\\\\(', 'g'))].length;\n" +
        "console.log('get:' + say('get') + ' post:' + say('post'));",
      expect: "get:2 post:1",
      safety: "safe",
    },
    related: ["http-status", "http-json"],
  },
  {
    id: "http-status",
    track: "http-api",
    title: "Durum kodları — 2xx / 4xx / 5xx ayrımı",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Status",
    pattern: /res\.status\(\d{3}\)|status:\s*\d{3}|http_code/,
    files: CLIENTFILES,
    what:
      "4xx 'senin isteğin hatalı', 5xx 'benim tarafımda hata' demektir. Bu ayrım tekrar denenip denenmeyeceğini belirler: 400'ü tekrar denemek anlamsız, 503'ü denemek doğrudur.",
    whyHere:
      "Kapılar bu sınıflandırmaya göre PASS/SKIP/FAIL verir. Doğrulama hatasına 500 döndüren bir uç, istemciye 'tekrar dene' sinyali verir ve sonsuz döngü üretir — bu yüzden girdi hataları 4xx olarak ayrılır.",
    exercise:
      "Bozuk gövdeyle bir uca istek at. 400 mü 500 mü dönüyor? Hangisi doğru olurdu?",
    recipe: {
      id: "http-status",
      lang: "node",
      code:
        "const sinif = (c) => (c < 300 ? 'ok' : c < 500 ? 'istemci' : 'sunucu');\n" +
        "const tekrar = (c) => c === 429 || c >= 500;\n" +
        "console.log([200, 404, 429, 503].map((c) => c + ':' + sinif(c) + (tekrar(c) ? '/tekrar' : '')).join(' '));",
      expect: "200:ok 404:istemci 429:istemci/tekrar 503:sunucu/tekrar",
      safety: "safe",
    },
    related: ["http-rate-limit", "sh-case"],
  },
  {
    id: "http-json",
    track: "http-api",
    title: "JSON gövdesi ve içerik tipi",
    level: "temel",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Type",
    pattern: /res\.json\(|application\/json|Content-Type/,
    files: CLIENTFILES,
    what:
      "`Content-Type: application/json` istemciye gövdeyi nasıl ayrıştıracağını söyler. Başlık yanlışsa gövde doğru olsa bile istemci metin sanır. Hata yanıtları da JSON olmalı; HTML hata sayfası döndüren bir API, istemcide ayrıştırma hatasına dönüşür.",
    whyHere:
      "Araçlar yanıtları `--json` bayrağıyla makine biçiminde ister; tüketiciler (ollamas, eCym, pipeline) bunu doğrudan ayrıştırır. İnsan biçimi ile makine biçimi ayrı tutulmasaydı, renk kaçış dizileri JSON'a sızar ve ayrıştırma kırılırdı.",
    exercise:
      "`learnkb ask --json` çıktısını `python3 -m json.tool`'a boru ile ver. Geçerli mi?",
    recipe: {
      id: "http-json",
      lang: "node",
      code:
        "const yanit = { ok: true, items: [{ id: 'js-regex' }] };\n" +
        "const govde = JSON.stringify(yanit);\n" +
        "console.log('tip:application/json gecerli:' + (JSON.parse(govde).items.length === 1));",
      expect: "tip:application/json gecerli:true",
      safety: "safe",
    },
    related: ["js-json", "http-route"],
  },
  {
    id: "http-headers",
    track: "http-api",
    title: "Başlıklar ve setHeader",
    level: "orta",
    source: NODE,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Headers",
    pattern: /setHeader\(|headers:\s*\{|\.set\(['"]Content/,
    files: CLIENTFILES,
    what:
      "Başlıklar gövdeden ÖNCE yazılmalıdır; gövde akmaya başladıktan sonra `setHeader` çağırmak hata verir. Akış (stream) yanıtlarında bu sıra kritik hâle gelir.",
    whyHere:
      "SSE uçlarında `Content-Type: text/event-stream`, `Cache-Control: no-cache` ve `Connection: keep-alive` üçlüsü ilk yazılan şeydir. Sıra bozulursa istemci akışı normal bir yanıt sanar ve ilk parçadan sonra bağlantıyı kapatır.",
    exercise:
      "SSE ucunda başlıkları gövdeden sonra yazmayı dene. Hangi hata gelir?",
    recipe: {
      id: "http-headers",
      lang: "node",
      code:
        "const yazilan = [];\n" +
        "const setHeader = (k, v) => { if (yazilan.length) throw new Error('ERR_HTTP_HEADERS_SENT'); return k + '=' + v; };\n" +
        "const h = setHeader('Content-Type', 'text/event-stream');\n" +
        "yazilan.push('data: ilk\\n\\n');\n" +
        "let hata = '';\n" +
        "try { setHeader('X-Late', '1'); } catch (e) { hata = e.message; }\n" +
        "console.log(h + ' | ' + hata);",
      expect: "Content-Type=text/event-stream | ERR_HTTP_HEADERS_SENT",
      safety: "safe",
    },
    related: ["http-sse", "http-json"],
  },
  {
    id: "http-sse",
    track: "http-api",
    title: "Server-Sent Events — parça parça yanıt",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Server-sent_events",
    pattern: /text\/event-stream|data:\s.*\\n\\n|EventSource/,
    files: CLIENTFILES,
    what:
      "SSE tek yönlü bir akıştır: sunucu `data: ...\\n\\n` biçiminde olaylar yazar, istemci `EventSource` ile dinler. WebSocket'ten basittir çünkü sıradan bir HTTP yanıtıdır; ama yalnız sunucudan istemciye akar.",
    whyHere:
      "Model yanıtları token token gelir; tamamını bekleyip göndermek kullanıcıya 'donmuş' hissi verir. Çift satır sonu (`\\n\\n`) olay sınırıdır — tek satır sonu gönderen bir uygulama, istemcide hiçbir olay tetiklemez ve sessizce 'çalışmıyor' görünür.",
    exercise:
      "Bir SSE olayını tek `\\n` ile bitir. İstemci kaç olay alır?",
    recipe: {
      id: "http-sse",
      lang: "node",
      code:
        "const akis = 'data: bir\\n\\ndata: iki\\n\\n';\n" +
        "const olaylar = akis.split('\\n\\n').filter((s) => s.startsWith('data: '));\n" +
        "console.log('olay:' + olaylar.length + ' ilk:' + olaylar[0].slice(6));",
      expect: "olay:2 ilk:bir",
      safety: "safe",
    },
    related: ["http-headers", "js-async-await"],
  },
  {
    id: "http-fetch",
    track: "http-api",
    title: "fetch — istek atmak ve hatayı doğru anlamak",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/Fetch_API/Using_Fetch",
    pattern: /\bfetch\(|curl -s|requests\.(get|post)/,
    files: CLIENTFILES,
    what:
      "`fetch` 404 ya da 500 aldığında REDDETMEZ — yalnız ağ hatasında reddeder. `response.ok` kontrolü yapılmazsa hata sayfası başarılı yanıt gibi ayrıştırılır.",
    whyHere:
      "Sağlık kontrolleri bu yüzden gövdeye değil durum koduna bakar. `fetch` sonucunu doğrudan `.json()` ile ayrıştıran bir kontrol, 500 yanıtında 'ayrıştırma hatası' der ve gerçek sorunu (sunucu hatası) gizler.",
    exercise:
      "404 dönen bir uca `fetch` at ve `response.ok` değerini yazdır. `catch` bloğu tetikleniyor mu?",
    recipe: {
      id: "http-fetch",
      lang: "node",
      code:
        "const yanit = { status: 404, ok: false };\n" +
        "let sonuc;\n" +
        "if (!yanit.ok) sonuc = 'HTTP-' + yanit.status;\n" +
        "else sonuc = 'govde';\n" +
        "console.log('reddetmedi:true sonuc:' + sonuc);",
      expect: "reddetmedi:true sonuc:HTTP-404",
      safety: "safe",
    },
    related: ["http-status", "http-timeout"],
  },
  {
    id: "http-timeout",
    track: "http-api",
    title: "Zaman aşımı ve AbortController",
    level: "orta",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API/AbortController",
    pattern: /AbortController|--max-time|timeout[:=]\s*\d|signal:/,
    files: CLIENTFILES,
    what:
      "`fetch`'in varsayılan zaman aşımı YOKTUR; yanıt vermeyen bir sunucu isteği süresiz asar. `AbortController` ile bir zamanlayıcı kurulup `signal` geçilmelidir; `curl` tarafında karşılığı `--max-time`'dır.",
    whyHere:
      "Gece koşan sağlık turu, yanıt vermeyen bir servis yüzünden sabaha kadar açık kalabilir ve bir sonraki turu bloke eder. Her dış çağrıda zaman aşımı bu yüzden zorunlu kabul edilir — otomasyonun canlı kalması buna bağlı.",
    exercise:
      "Zaman aşımı olmadan kapalı bir porta istek at ve süreyi ölç. Sistem varsayılanı kaç saniye?",
    recipe: {
      id: "http-timeout",
      lang: "node",
      code:
        "(async () => {\n" +
        "  const ac = new AbortController();\n" +
        "  const t = setTimeout(() => ac.abort(), 50);\n" +
        "  const bekle = new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error('AbortError'))));\n" +
        "  try { await bekle; } catch (e) { console.log('iptal:' + e.message); } finally { clearTimeout(t); }\n" +
        "})();",
      expect: "iptal:AbortError",
      safety: "safe",
    },
    related: ["http-fetch", "sh-curl-status"],
  },
  {
    id: "http-rate-limit",
    track: "http-api",
    title: "429 ve hız sınırı — kopuk çapa DEĞİLDİR",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/HTTP/Status/429",
    pattern: /\b429\b|rate.?limit|Retry-After/i,
    files: CLIENTFILES,
    what:
      "429 'çok hızlısın' demektir, 'kaynak yok' değil. `Retry-After` başlığı ne kadar bekleneceğini söyler. Üstel geri çekilme (her denemede süreyi katla) standart yanıttır.",
    whyHere:
      "Çapa denetimi arka arkaya koşunca destek sitesi 429 verdi ve kapı kırmızıya düştü — oysa çapa sağlamdı. Sınıflandırma düzeltildi: `429|503 → SKIP`. Bir kapının en tehlikeli hatası yanlış negatif değil, GÜVENİLMEZ olmaktır; kalıcı yanlış-kırmızı, gerçek kırmızıyı görünmez yapar.",
    exercise:
      "Bir kaynağa 20 kez üst üste istek at. Kaçıncı istekte 429 geliyor ve kapı ne rapor ediyor?",
    recipe: {
      id: "http-rate-limit",
      lang: "node",
      code:
        "const karar = (c) => (c === 200 ? 'PASS' : c === 429 || c === 503 ? 'SKIP' : 'FAIL');\n" +
        "console.log([200, 429, 503, 404].map(karar).join(' '));",
      expect: "PASS SKIP SKIP FAIL",
      safety: "safe",
    },
    related: ["http-status", "sh-case", "js-promise-all"],
  },
  {
    id: "http-openapi",
    track: "http-api",
    title: "OpenAPI — sözleşmeyi koddan üretmek",
    level: "ileri",
    source: MDN,
    url: "https://developer.mozilla.org/docs/Web/API",
    pattern: /openapi|"paths"|components:|swagger/i,
    files: SERVERFILES,
    what:
      "OpenAPI, API'nin makine-okunur sözleşmesidir: yollar, gövde şemaları, yanıt kodları. Elle yazılan bir şema koddan ayrı yaşar ve bayatlar; koddan üretilen şema bayatlayamaz.",
    whyHere:
      "`recall` ucunun kırpma parametresi OLMADIĞI, şemaya bakılarak kanıtlandı (`{query, k, ns, graphExpand}`) — token sorununun kök nedeni tam olarak bu satırda görüldü. Sözleşmenin yazılı olması, bir tahmini bir ölçüme çevirdi.",
    exercise:
      "`server/openapi.ts` içinde `recall` ucunun kabul ettiği alanları listele. Kırpma/limit alanı var mı?",
    recipe: {
      id: "http-openapi",
      lang: "node",
      code:
        "const sema = { '/api/brain/recall': { body: ['query', 'k', 'ns', 'graphExpand'] } };\n" +
        "const alanlar = sema['/api/brain/recall'].body;\n" +
        "console.log('alan:' + alanlar.join(',') + ' kirpma-var:' + alanlar.some((a) => /trim|limit|maxBytes/.test(a)));",
      expect: "alan:query,k,ns,graphExpand kirpma-var:false",
      safety: "safe",
    },
    related: ["http-route", "agents-token-budget"],
  },
];
