// track: python — the vault's `_bin/*.py` tooling layer and eCym's local scripts.
//
// Kaynak çapası: docs.python.org. Bu izlek özellikle DETERMİNİSTİK metin araçlarını öğretir:
// kapsül üreticisi, BM25 skorlayıcı, footer onarıcı. Hepsi LLM'siz çalışır — öğretilecek asıl
// şey de budur: bir modele sormadan önce sayılabilir bir çözüm var mı?
import type { Construct } from "./types";

const PY = "python";

/** Python lives in `.py` files plus a few extension-less scripts in bin directories. */
const PYFILES = /(\.py$|(^|\/)(cckb|learnkb|ecy-codekb|ecy-learn|ecy-brain|ecy-orchestrator)$)/;

export const PYTHON: Construct[] = [
  {
    id: "py-shebang",
    track: "python",
    title: "Shebang ve çalıştırılabilir betik",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/using/windows.html#shebang-lines",
    pattern: /^#!.*python3?/m,
    files: PYFILES,
    what:
      "İlk satırdaki `#!/usr/bin/env python3`, dosyaya çalıştırma izni verildiğinde hangi yorumlayıcının kullanılacağını söyler. `env` kullanmak yolu sabitlemekten iyidir: sanal ortamlarda ve Homebrew kurulumlarında doğru python bulunur.",
    whyHere:
      "`_bin/cckb` uzantısız bir dosyadır ama Python'dur — `cckb ask` diye çağrılabilmesi için. Shebang olmasaydı kabuk onu kabuk betiği sanıp ilk satırda sözdizimi hatası verirdi.",
    exercise:
      "`head -1 ~/ollamas-vault/_bin/cckb` çalıştır. `#!/usr/bin/python3` yazsaydı Homebrew python'u olan bir makinede ne olurdu?",
    recipe: {
      id: "py-shebang",
      lang: "bash",
      code: "head -1 \"$HOME/ollamas-vault/_bin/cc-capsules.py\"",
      expect: "#!/usr/bin/env python3",
      safety: "safe",
    },
    related: ["sh-shebang"],
  },
  {
    id: "py-main-guard",
    track: "python",
    title: "`if __name__ == \"__main__\"` — kütüphane mi, komut mu?",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/__main__.html",
    pattern: /__name__\s*==\s*["']__main__["']/,
    files: PYFILES,
    what:
      "Bu koşul, dosya doğrudan çalıştırıldığında `True`, başka bir modül tarafından `import` edildiğinde `False` olur. Aynı dosyanın hem kütüphane hem komut olmasını sağlar.",
    whyHere:
      "Kapsül üreticisi hem `python3 cc-capsules.py` olarak koşar hem de test/ölçüm betikleri tarafından import edilir. Koruma olmasaydı import etmek üretimi tetikler ve ölçüm aracı ölçtüğü şeyi değiştirirdi.",
    exercise:
      "Korumayı kaldır ve dosyayı başka bir betikten import et. Yan etki ne olur?",
    recipe: {
      id: "py-main-guard",
      lang: "python",
      code:
        "def main():\n"
        + "    return 'komut-olarak-calisti'\n"
        + "\n"
        + "print(main() if __name__ == '__main__' else 'kutuphane-olarak-yuklendi')",
      expect: "komut-olarak-calisti",
      safety: "safe",
    },
    related: ["py-shebang", "node-process"],
  },
  {
    id: "py-json",
    track: "python",
    title: "json — okuma, yazma ve Türkçe karakterler",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/json.html",
    pattern: /json\.(load|loads|dump|dumps)\(/,
    files: PYFILES,
    what:
      "`json.load` dosyadan, `json.loads` metinden okur. Yazarken `ensure_ascii=False` verilmezse Türkçe harfler `\\u00e7` gibi kaçış dizilerine dönüşür: dosya hâlâ geçerlidir ama insan okuyamaz ve git diff'i şişer.",
    whyHere:
      "Kapsül indeksi Türkçe TL;DR taşır. `ensure_ascii=False` olmadan `ölçüm` kelimesi 18 bayta çıkar ve token bütçesi ölçümü yanlış yüksek çıkardı — bu tier'ın tüm iddiası bayt saymak üzerine kurulu olduğu için bu ayar kozmetik değil.",
    exercise:
      "Aynı sözlüğü `ensure_ascii` açık ve kapalı yaz, iki dosyanın baytını karşılaştır.",
    recipe: {
      id: "py-json",
      lang: "python",
      code:
        "import json\n"
        + "d = {'tldr': 'ölçüm ve kapsül'}\n"
        + "kacisli = json.dumps(d)\n"
        + "duz = json.dumps(d, ensure_ascii=False)\n"
        + "print('kacisli:%d duz:%d' % (len(kacisli.encode()), len(duz.encode())))",
      expect: "kacisli:47 duz:31",
      safety: "safe",
    },
    related: ["js-json", "data-json-index"],
  },
  {
    id: "py-open-with",
    track: "python",
    title: "`with open(...)` — kapanması garanti dosya",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/tutorial/inputoutput.html#reading-and-writing-files",
    pattern: /with open\(|open\([^)]*encoding=/,
    files: PYFILES,
    what:
      "`with` bloğu çıkışta dosyayı kapatır — istisna atılsa bile. `encoding=\"utf-8\"` yazmak şart: varsayılan kodlama işletim sistemine göre değişir ve Türkçe içerik başka makinede bozulur.",
    whyHere:
      "Vault'taki her not UTF-8'dir ve araçlar macOS'ta yazılıp launchd altında (farklı ortam) okunur. `encoding` verilmeyen tek bir `open` çağrısı, gece çalışan bir görevde `UnicodeDecodeError` üretir.",
    exercise:
      "`_bin/*.py` içinde `open(` çağrılarını say; kaçında `encoding` verilmiş?",
    recipe: {
      id: "py-open-with",
      lang: "python",
      code:
        "import os, tempfile\n"
        + "p = os.path.join(tempfile.gettempdir(), 'learn-open-test.txt')\n"
        + "with open(p, 'w', encoding='utf-8') as f:\n"
        + "    f.write('ölçüm')\n"
        + "with open(p, encoding='utf-8') as f:\n"
        + "    print('okundu:' + f.read())\n"
        + "os.remove(p)",
      expect: "okundu:ölçüm",
      safety: "safe",
    },
    related: ["py-json", "node-fs"],
  },
  {
    id: "py-fstring",
    track: "python",
    title: "f-string ve biçimlendirme",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/reference/lexical_analysis.html#f-strings",
    pattern: /f"[^"]*\{|f'[^']*\{/,
    files: PYFILES,
    what:
      "`f\"...{ifade}...\"` metnin içine ifade gömer. `:.2f` gibi biçim belirteçleri sayıyı yuvarlar, `:>8` sağa yaslar — rapor tabloları böyle hizalanır.",
    whyHere:
      "Kapı çıktıları hizalı olmalı ki 25 satırlık bir raporda PASS/FAIL göz taramasıyla okunabilsin. Hizalama biçim belirteçleriyle yapılır, elle boşluk eklenerek değil.",
    exercise:
      "0.8571 oranını yüzde iki hane ile yazdır. `round()` ile f-string biçimlendirmesi arasındaki fark ne?",
    recipe: {
      id: "py-fstring",
      lang: "python",
      code:
        "p1, h3 = 1.0, 0.95\n"
        + "print(f'P@1={p1:.2f} H@3={h3:.2f} durum={\"PASS\" if p1 >= 0.9 else \"FAIL\"}')",
      expect: "P@1=1.00 H@3=0.95 durum=PASS",
      safety: "safe",
    },
    related: ["js-template-literal"],
  },
  {
    id: "py-list-comp",
    track: "python",
    title: "Liste/sözlük kurgusu (comprehension)",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions",
    pattern: /\[[^\]\n]*\bfor\b[^\]\n]*\bin\b[^\]\n]*\]|\{[^}\n]*\bfor\b[^}\n]*\bin\b[^}\n]*\}/,
    files: PYFILES,
    what:
      "`[f(x) for x in liste if kosul]` tek satırda dönüştür-ve-süz yapar. Okunurluk sınırı vardır: iç içe iki döngü ve iki koşul geçince normal `for` döngüsü daha anlaşılırdır.",
    whyHere:
      "Belge terimlerini çıkarırken kullanılır: `[w for w in re.findall(...) if len(w) >= 3 and w not in STOP]`. Durak-sözcük süzgeci tam burada uygulanır; bu satırdaki bir eksik (ASCII'siz `nasil`) arama sıralamasını bozmuştu.",
    exercise:
      "Durak listesinden `nasil`'ı çıkar ve `cckb ask \"hooks nasil yazilir\"` sıralamasının nasıl değiştiğini gözle.",
    recipe: {
      id: "py-list-comp",
      lang: "python",
      code:
        "STOP = {'nasil', 'nasıl', 've', 'bir'}\n"
        + "kelimeler = ['hooks', 'nasil', 'yazilir', 've', 'test']\n"
        + "terimler = [w for w in kelimeler if len(w) >= 3 and w not in STOP]\n"
        + "print(','.join(terimler))",
      expect: "hooks,yazilir,test",
      safety: "safe",
    },
    related: ["py-set", "js-array-filter"],
  },
  {
    id: "py-set",
    track: "python",
    title: "set ve frozenset — üyelik testleri",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/stdtypes.html#set",
    pattern: /\bset\(\)|\bset\(|frozenset\(|(^|[^\w])\{['"][^}]*['"]\}/,
    files: PYFILES,
    what:
      "Kümede `x in s` sorgusu eleman sayısından bağımsız hızlıdır ve tekrarlar otomatik ayıklanır. Kesişim (`&`) ve fark (`-`) operatörleri iki listeyi karşılaştırmanın en kısa yoludur.",
    whyHere:
      "Skorlama sorgu terimleriyle belge terimlerinin KESİŞİMİNE bakar: `len(sorgu & belge)`. Listelerle yazılsaydı her belge için iç içe döngü olur, 219 kapsülde arama fark edilir şekilde yavaşlardı.",
    exercise:
      "İki kümenin kesişimini hem `&` ile hem iç içe döngüyle yaz. 219 elemanda kaç karşılaştırma farkı olur?",
    recipe: {
      id: "py-set",
      lang: "python",
      code:
        "sorgu = {'hooks', 'yazilir'}\n"
        + "belge = {'hooks', 'guide', 'yazilir', 'ornek'}\n"
        + "print('kesisim:%d fark:%s' % (len(sorgu & belge), sorted(belge - sorgu)))",
      expect: "kesisim:2 fark:['guide', 'ornek']",
      safety: "safe",
    },
    related: ["js-set", "py-list-comp"],
  },
  {
    id: "py-dict-get",
    track: "python",
    title: "Sözlük: get, setdefault, dict.items",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/stdtypes.html#dict",
    pattern: /\.get\(|\.setdefault\(|\.items\(\)|\.keys\(\)|\.values\(\)/,
    files: PYFILES,
    what:
      "`d.get(k, varsayilan)` anahtar yoksa istisna atmaz. `setdefault` yoksa oluşturur ve döndürür — sayaç/gruplama kurarken tek satıra indirir.",
    whyHere:
      "Dış JSON okunurken (`D.get('rules', {})`) şema eksikse araç çökmemeli, boş davranmalıdır. `ecy-codekb` bozuk bir `code-kb.json` ile bile çalışır; çünkü her erişim `get` ile varsayılanlıdır.",
    exercise:
      "`code-kb.json`'u geçici olarak boş `{}` yap ve `ecy-codekb rules server.js` çalıştır. Çöküyor mu, boş mu dönüyor?",
    recipe: {
      id: "py-dict-get",
      lang: "python",
      code:
        "D = {'rules': {'global': ['kural1']}}\n"
        + "print('global:%d backend:%d' % (len(D.get('rules', {}).get('global', [])), len(D.get('rules', {}).get('backend', []))))",
      expect: "global:1 backend:0",
      safety: "safe",
    },
    related: ["js-object-entries", "py-try-except"],
  },
  {
    id: "py-regex",
    track: "python",
    title: "re — findall, sub ve ham dizeler",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/re.html",
    pattern: /\bre\.(findall|search|match|sub|compile|finditer)\(/,
    files: PYFILES,
    what:
      "Desenleri her zaman ham dize (`r\"...\"`) ile yaz; aksi hâlde `\\d` önce Python kaçışı olarak yorumlanır. `findall` eşleşmeleri, `sub` değiştirilmiş metni döndürür.",
    whyHere:
      "Not gövdesinden terim çıkarma ve footer onarımı bu iki fonksiyonla yapılır. Footer onarıcı `re.sub` ile satırın tamamını değiştirir — parça birleştirme yerine desen kullanmak, ikinci kez çalıştığında ikinci footer eklemesini önler (idempotent olur).",
    exercise:
      "Footer onarıcıyı aynı nota iki kez uygula. İkinci çalıştırmada dosya değişiyor mu? Değişiyorsa desen neden idempotent değil?",
    recipe: {
      id: "py-regex",
      lang: "python",
      code:
        "import re\n"
        + "govde = 'ders metni\\n---\\n**Hub:** [[learn]]'\n"
        + "yeni = re.sub(r'\\n---\\n\\*\\*Hub:.*$', '\\n---\\n**Hub:** [[learn]]', govde, flags=re.S)\n"
        + "iki = re.sub(r'\\n---\\n\\*\\*Hub:.*$', '\\n---\\n**Hub:** [[learn]]', yeni, flags=re.S)\n"
        + "print('idempotent:' + str(yeni == iki))",
      expect: "idempotent:True",
      safety: "safe",
    },
    related: ["js-regex", "py-str-translate"],
  },
  {
    id: "py-str-translate",
    track: "python",
    title: "str.translate — Türkçe `İ` katlaması (gerçek bir hata dersi)",
    level: "ileri",
    source: PY,
    url: "https://docs.python.org/3/library/stdtypes.html#str.translate",
    pattern: /\.translate\(|str\.maketrans\(/,
    files: PYFILES,
    what:
      "`.lower()` Türkçe `İ`yi `i̇` (i + birleşen nokta) yapar; iki karakterlik bu sonuç hiçbir terimle eşleşmez. `str.maketrans` ile kurulan bir tablo, harfleri tek adımda ve öngörülebilir biçimde katlar.",
    whyHere:
      "Arama, kullanıcının `İ` ile yazdığı sorguyu bulamıyordu. Kök neden `.lower()`'ın Unicode davranışıydı; çözüm çeviri tablosu oldu. Bu ders, 'küçük harfe çevir' gibi masum görünen bir çağrının Türkçe'de neden bir hata kaynağı olduğunu anlatır.",
    exercise:
      "`'İSTANBUL'.lower()` uzunluğu kaç? `len()` ile ölç ve neden 8 değil 9 olduğunu açıkla.",
    recipe: {
      id: "py-str-translate",
      lang: "python",
      code:
        "TR = str.maketrans('ÇŞĞIİÖÜ', 'csgiiou')\n"
        + "s = 'İSTANBUL'\n"
        + "print('lower:%d translate:%s' % (len(s.lower()), s.translate(TR).lower()))",
      expect: "lower:9 translate:istanbul",
      safety: "safe",
    },
    related: ["py-regex", "data-bm25"],
  },
  {
    id: "py-sorted-key",
    track: "python",
    title: "sorted(key=...) — çok anahtarlı sıralama",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/howto/sorting.html",
    pattern: /sorted\(|\.sort\(key=/,
    files: PYFILES,
    what:
      "`sorted(liste, key=lambda x: (-x['skor'], x['slug']))` demet döndüren bir anahtarla önce skora göre azalan, eşitlikte slug'a göre artan sıralar. Eşitlik kuralı yazılmazsa sıralama girdi düzenine bağlı kalır ve çıktı deterministik olmaz.",
    whyHere:
      "Kapsül arama sonuçları iki koşuşturmada aynı sırayı vermeli, yoksa kapı 'değişti' der. İkincil anahtar tam olarak bu belirsizliği kapatmak için var.",
    exercise:
      "Eşit skorlu iki kapsül üret ve ikincil anahtarı kaldır. İki çalıştırmada sıra aynı mı?",
    recipe: {
      id: "py-sorted-key",
      lang: "python",
      code:
        "kapsuller = [{'slug': 'b', 'skor': 5}, {'slug': 'a', 'skor': 5}, {'slug': 'c', 'skor': 9}]\n"
        + "s = sorted(kapsuller, key=lambda x: (-x['skor'], x['slug']))\n"
        + "print(','.join(k['slug'] for k in s))",
      expect: "c,a,b",
      safety: "safe",
    },
    related: ["js-array-sort", "data-bm25"],
  },
  {
    id: "py-try-except",
    track: "python",
    title: "try / except — dar yakalama ve zarif degrade",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/tutorial/errors.html",
    pattern: /\btry:|except\s+\w*Error|except Exception/,
    files: PYFILES,
    what:
      "`except Exception` her şeyi yutar ve `KeyboardInterrupt` dışındaki gerçek hataları gizler. Beklenen hatayı ADIYLA yakalamak (`FileNotFoundError`, `json.JSONDecodeError`) doğrusudur.",
    whyHere:
      "Kapılar brain kapalıyken FAIL değil SKIP vermeli — ama bu, hatayı yutmak değil SINIFLANDIRMAK demek. Bağlantı hatası SKIP, bozuk JSON FAIL'dir. Geniş `except` bu ayrımı imkânsız kılar ve kapı sahte yeşile döner.",
    exercise:
      "Bir kapı kontrolünde `except Exception: return 'SKIP'` yazsan, bozuk bir indeks dosyası hangi rengi üretirdi? Bu neden tehlikeli?",
    recipe: {
      id: "py-try-except",
      lang: "python",
      code:
        "import json\n"
        + "def oku(metin):\n"
        + "    try:\n"
        + "        return 'ok:%d' % len(json.loads(metin))\n"
        + "    except json.JSONDecodeError:\n"
        + "        return 'FAIL-bozuk-json'\n"
        + "    except OSError:\n"
        + "        return 'SKIP-erisim-yok'\n"
        + "print(oku('[1,2]') + ' ' + oku('{bozuk'))",
      expect: "ok:2 FAIL-bozuk-json",
      safety: "safe",
    },
    related: ["js-try-catch", "sh-exit-code"],
  },
  {
    id: "py-subprocess",
    track: "python",
    title: "subprocess — dış komutu argüman listesiyle çağırmak",
    level: "ileri",
    source: PY,
    url: "https://docs.python.org/3/library/subprocess.html",
    pattern: /subprocess\.(run|check_output|Popen|call)\(/,
    files: PYFILES,
    what:
      "`subprocess.run([\"curl\", \"-s\", url])` argümanları liste olarak alır ve kabuk açmaz. `shell=True` yazmak, url içindeki `;` karakterini komut ayracına dönüştürür — dış girdi varsa bu bir açıktır.",
    whyHere:
      "Yenileme betiği kaynak URL'lerini curl ile yoklar. URL listesi bizim dosyamızdan gelse de liste biçimi tercih edilir: bugün sabit olan girdi, yarın bir yapılandırma dosyasından gelir.",
    exercise:
      "`shell=True` ile bir URL'nin sonuna `; echo x` ekle. Ne çalışır? Liste biçiminde ne olur?",
    recipe: {
      id: "py-subprocess",
      lang: "python",
      code:
        "import subprocess\n"
        + "p = subprocess.run(['echo', 'hi; whoami'], capture_output=True, text=True, timeout=10)\n"
        + "print('kabuk-yok:' + p.stdout.strip())",
      expect: "kabuk-yok:hi; whoami",
      safety: "safe",
    },
    related: ["node-child-process", "agents-allowlist"],
  },
  {
    id: "py-hashlib",
    track: "python",
    title: "hashlib — içerik özeti ile değişim tespiti",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/hashlib.html",
    pattern: /hashlib\.(sha1|sha256|md5|blake2b)\(/,
    files: PYFILES,
    what:
      "Özet (hash), içerik aynı kaldıkça aynı, tek bayt değişince tamamen farklı çıkar. Değişip değişmediğini anlamak için tüm içeriği saklamak yerine 64 karakterlik özeti saklamak yeter.",
    whyHere:
      "Kapsül üreticisi artımlıdır: not gövdesinin özeti değişmediyse kapsül yeniden hesaplanmaz. Kaynak-sürüklenme izleyicisi de aynı yöntemi kullanır — sayfanın HTML'ini saklamadan 'değişti mi' sorusunu yanıtlar.",
    exercise:
      "Aynı metnin özetini iki kez al; sonra tek bir boşluk ekleyip yeniden al. Kaç karakter değişti?",
    recipe: {
      id: "py-hashlib",
      lang: "python",
      code:
        "import hashlib\n"
        + "h = lambda s: hashlib.sha256(s.encode()).hexdigest()[:12]\n"
        + "a, b = h('ders govdesi'), h('ders govdesi ')\n"
        + "print('ayni:%s farkli:%s' % (h('ders govdesi') == a, a != b))",
      expect: "ayni:True farkli:True",
      safety: "safe",
    },
    related: ["data-content-hash"],
  },
  {
    id: "py-math-log",
    track: "python",
    title: "math.log — IDF ve logaritmik ağırlık",
    level: "ileri",
    source: PY,
    url: "https://docs.python.org/3/library/math.html",
    pattern: /math\.log|from math import|\blog\(/,
    files: PYFILES,
    what:
      "Logaritma büyük farkları sıkıştırır. Arama skorlamasında bu iki yerde işe yarar: nadir terimlere yüksek ağırlık veren IDF, ve uzun belgeyi 'daha çok bilgi' saymayan otorite çarpanı.",
    whyHere:
      "BM25'te uzunluk normalizasyonu (`b`) 0.75 iken 1,2 KB'lık bir taslak, 9,2 KB'lık dolu bir sayfayı yeniyordu. `b`nin 0.15'e çekilmesi ve logaritmik otorite çarpanı bu ters sonucu düzeltti — sayısal bir parametrenin arama kalitesini nasıl belirlediğinin somut örneği.",
    exercise:
      "Aynı sorguda `b=0.75` ve `b=0.15` ile sıralamayı karşılaştır. Hangi belge öne çıkıyor?",
    recipe: {
      id: "py-math-log",
      lang: "python",
      code:
        "import math\n"
        + "N, df = 219, 4\n"
        + "idf = math.log(1 + (N - df + 0.5) / (df + 0.5))\n"
        + "print('idf:%.3f' % idf)",
      expect: "idf:3.890",
      safety: "safe",
    },
    related: ["data-bm25", "py-sorted-key"],
  },
  {
    id: "py-argv",
    track: "python",
    title: "sys.argv — alt komut ve bayrak ayrıştırma",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/sys.html#sys.argv",
    pattern: /sys\.argv/,
    files: PYFILES,
    what:
      "`sys.argv[0]` betiğin yolu, kalanlar argümanlardır. Küçük araçlarda `argparse` yerine elle ayrıştırmak kabul edilir ama bayrakları argümanlardan ayırmayı unutmamak gerekir.",
    whyHere:
      "`cckb ask -k 5 \"soru\"` biçimi: alt komut, sayısal bayrak ve serbest metin bir arada. Bayraklar önce ayıklanmazsa `-k` sorgunun parçası sanılır ve arama terimlerine karışır.",
    exercise:
      "`learnkb ask --json \"bm25\"` çağrısında sorgu metni hangi elemandır? `--json` filtrelenmezse skorlama nasıl bozulur?",
    recipe: {
      id: "py-argv",
      lang: "python",
      code:
        "argv = ['learnkb', 'ask', '--json', '-k', '5', 'bm25 nedir']\n"
        + "rest = argv[2:]\n"
        + "flags = [a for a in rest if a.startswith('--')]\n"
        + "words = [a for i, a in enumerate(rest) if not a.startswith('-') and (i == 0 or rest[i-1] != '-k')]\n"
        + "print('bayrak:%s sorgu:%s' % (','.join(flags), ' '.join(words)))",
      expect: "bayrak:--json sorgu:bm25 nedir",
      safety: "safe",
    },
    related: ["node-process", "sh-arg-parse"],
  },
  {
    id: "py-enumerate-zip",
    track: "python",
    title: "enumerate ve zip",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/functions.html#enumerate",
    pattern: /\benumerate\(|\bzip\(/,
    files: PYFILES,
    what:
      "`enumerate` indeks ile elemanı birlikte verir; elle sayaç tutmayı gereksiz kılar. `zip` iki diziyi eşler ve KISA olanda durur — uzunluklar farklıysa sessizce veri kaybedebilirsin.",
    whyHere:
      "Satır numarası üretirken (`for i, line in enumerate(lines, 1)`) kanıt satırı `dosya:satır` biçiminde yazılabilsin diye kullanılır. Bu tier'ın tüm örnekleri o satır numarasına dayanır.",
    exercise:
      "3 ve 5 elemanlı iki listeyi `zip`le. Kaç çift çıkar, kaç eleman düşer?",
    recipe: {
      id: "py-enumerate-zip",
      lang: "python",
      code:
        "lines = ['import os', 'def f():', '    return 1']\n"
        + "hits = [(i, l.strip()) for i, l in enumerate(lines, 1) if 'def' in l]\n"
        + "print('satir:%d icerik:%s duseng:%d' % (hits[0][0], hits[0][1], len(list(zip([1,2,3], [1,2])))))",
      expect: "satir:2 icerik:def f(): duseng:2",
      safety: "safe",
    },
    related: ["py-list-comp"],
  },
  {
    id: "py-os-path",
    track: "python",
    title: "os.path / expanduser — ev dizinine göre yol",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/os.path.html",
    pattern: /os\.path\.(join|exists|basename|dirname|getmtime|expanduser)|expanduser\(/,
    files: PYFILES,
    what:
      "`os.path.expanduser(\"~/x\")` tilde'yi gerçek ev dizinine çevirir. Kabuk bunu kendisi yapar ama Python yapmaz — `open(\"~/dosya\")` çağrısı `~` adlı bir klasör arar ve bulamaz.",
    whyHere:
      "Vault yolu her araçta `expanduser` ile kurulur. Bir yerde unutulsaydı araç elle çalışırken sorunsuz görünüp launchd altında dosyayı bulamazdı — 'bende çalışıyor' hatasının klasik biçimi.",
    exercise:
      "`open('~/ollamas-vault/README.md')` dene. Hata ne? `expanduser` ile farkı?",
    recipe: {
      id: "py-os-path",
      lang: "python",
      code:
        "import os\n"
        + "p = os.path.expanduser('~/ollamas-vault/_index/cc-capsules.json')\n"
        + "print('tilde-cozuldu:%s var:%s' % (not p.startswith('~'), os.path.exists(p)))",
      expect: "tilde-cozuldu:True var:True",
      safety: "safe",
    },
    related: ["node-path", "sh-home"],
  },
  {
    id: "py-freq-count",
    track: "python",
    title: "Frekans sayımı — neden `Counter` değil, düz sözlük",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/stdtypes.html#dict.get",
    pattern: /\w+\[\w+\]\s*=\s*\w+\.get\(\w+,\s*0\)\s*\+\s*1/,
    files: PYFILES,
    what:
      "`freq[w] = freq.get(w, 0) + 1` bir terim sayacının tamamıdır. `collections.Counter` aynı işi yapar ve daha kısadır — ama `most_common` EŞİT frekanslarda sıralamayı garanti etmez, ekleme sırasına düşer.",
    whyHere:
      "Kapsül üreticisi bilinçli olarak `Counter` KULLANMAZ: `sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:60]` yazar. İkincil anahtar (`kv[0]`, yani terimin kendisi) eşit frekanslı terimlerde alfabetik sıra dayatır; böylece indeks iki farklı makinede bayt-bayt aynı çıkar. Kısa kod ile deterministik kod arasında ikincisi seçilmiştir.",
    exercise:
      "`_bin/cc-capsules.py:214` satırındaki sıralama anahtarını `-kv[1]` ile sınırla (ikincil anahtarı sil), indeksi iki kez üret ve `diff` al. Fark çıkıyor mu?",
    recipe: {
      id: "py-freq-count",
      lang: "python",
      code:
        "freq = {}\n"
        + "for w in 'hook skill hook mcp skill hook'.split():\n"
        + "    freq[w] = freq.get(w, 0) + 1\n"
        + "print(sorted(freq.items(), key=lambda kv: (-kv[1], kv[0])))",
      expect: "[('hook', 3), ('skill', 2), ('mcp', 1)]",
      safety: "safe",
    },
    related: ["py-sorted-key", "py-dict-get", "data-bm25"],
  },
  {
    id: "py-type-hints",
    track: "python",
    title: "Tip ipuçları — çalışmaz ama okunur",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/typing.html",
    pattern: /def \w+\([^)]*:\s*(str|int|float|bool|list|dict|Any|Optional)|->\s*(str|int|bool|None|list|dict)/,
    files: PYFILES,
    what:
      "Python tip ipuçlarını çalışma zamanında ZORLAMAZ; onlar okuyucu ve araçlar içindir. Yine de imzayı okunur yapar ve `mypy` gibi araçlar kullanıldığında gerçek denetim sağlar.",
    whyHere:
      "Vault araçları küçük ama uzun ömürlü. `def score(query: str, doc: dict) -> float` imzası, altı ay sonra dosyayı açan kişiye üç yorum satırından fazlasını anlatır.",
    exercise:
      "Tip ipucu olan bir fonksiyona yanlış tip gönder. Python hata verir mi? Bu neden 'belge' sayılır, 'garanti' değil?",
    recipe: {
      id: "py-type-hints",
      lang: "python",
      code:
        "def skor(sorgu: str, k: int = 3) -> float:\n"
        + "    return len(sorgu) / k\n"
        + "print('calisti:%.2f tip-zorlanmadi:%s' % (skor('bm25'), skor(['liste'] * 4) == 4/3))",
      expect: "calisti:1.33 tip-zorlanmadi:True",
      safety: "safe",
    },
    related: ["ts-interface"],
  },
];
