// track: python (dalga 2) — envanterin ikinci taramasında kanıtlanan yapılar.
import type { Construct } from "./types";

const PY = "python";
const PYFILES = /(\.py$|(^|\/)(cckb|learnkb|ecy-codekb|ecy-learn|ecy-brain|ecy-orchestrator)$)/;

export const PYTHON_2: Construct[] = [
  {
    id: "py-argparse",
    track: "python",
    title: "argparse — bayrakları elle ayrıştırmayı bırakmak",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/argparse.html",
    pattern: /import argparse|ArgumentParser\(/,
    files: PYFILES,
    what:
      "`argparse` bayrakları, tipleri, varsayılanları ve `--help` metnini tek yerden üretir. Elle `sys.argv` ayrıştırmak küçük araçlarda kabul edilebilir ama üç bayraktan sonra hata kaynağına dönüşür.",
    whyHere:
      "Araçların bir kısmı `argparse`, bir kısmı elle ayrıştırma kullanıyor — ayrım bilinçli: tek bayraklı betikler elle, çok bayraklı olanlar `argparse` ile. Karışıklığın bedeli, `--help`'i olmayan bir aracın altı ay sonra nasıl çağrıldığının unutulmasıdır.",
    exercise:
      "`_bin/*.py` içinde kaç araç `argparse` kullanıyor, kaçı elle ayrıştırıyor? Elle olanların kaç bayrağı var?",
    recipe: {
      id: "py-argparse",
      lang: "python",
      code:
        "import argparse\n"
        + "p = argparse.ArgumentParser(prog='learnkb')\n"
        + "p.add_argument('--budget', type=int, default=1100)\n"
        + "p.add_argument('-k', type=int, default=3)\n"
        + "a = p.parse_args(['--budget', '900'])\n"
        + "print('budget:%d k:%d' % (a.budget, a.k))",
      expect: "budget:900 k:3",
      safety: "safe",
    },
    related: ["py-argv", "sh-arg-parse"],
  },
  {
    id: "py-urllib",
    track: "python",
    title: "urllib.request — bağımlılıksız HTTP",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/urllib.request.html",
    pattern: /urllib\.request|from urllib/,
    files: PYFILES,
    what:
      "`urllib.request` standart kütüphanededir; `requests` kurmadan HTTP yapar. Karşılığında elle iş vardır: başlıkları `Request` ile ekle, zaman aşımını her çağrıda ver, `HTTPError` ile `URLError`'ı AYRI yakala.",
    whyHere:
      "Vault araçları **sıfır bağımlılık** kuralına tabidir: `pip install` gerektiren bir betik, launchd altında farklı bir Python'la koşup çökebilir. Bedeli biraz daha uzun kod, kazancı 'her makinede çalışır'.",
    exercise:
      "`HTTPError` (404) ile `URLError` (ağ yok) durumlarını ayrı yakala. Kapı hangisine SKIP, hangisine FAIL demeli?",
    recipe: {
      id: "py-urllib",
      lang: "python",
      code:
        "import urllib.error\n"
        + "def sinif(e):\n"
        + "    if isinstance(e, urllib.error.HTTPError):\n"
        + "        return 'SKIP' if e.code in (429, 503) else 'FAIL'\n"
        + "    return 'SKIP'\n"
        + "h429 = urllib.error.HTTPError('u', 429, 'rate', None, None)\n"
        + "h404 = urllib.error.HTTPError('u', 404, 'nf', None, None)\n"
        + "print('%s %s %s' % (sinif(h429), sinif(h404), sinif(urllib.error.URLError('ag yok'))))",
      expect: "SKIP FAIL SKIP",
      safety: "safe",
    },
    related: ["http-status", "py-try-except"],
  },
  {
    id: "py-walk-glob",
    track: "python",
    title: "os.walk / glob — ağaç gezmek ve budamak",
    level: "orta",
    source: PY,
    url: "https://docs.python.org/3/library/os.html#os.walk",
    pattern: /os\.walk\(|glob\.glob\(|import glob/,
    files: PYFILES,
    what:
      "`os.walk` üçlü döndürür: `(kök, klasörler, dosyalar)`. Kritik ayrıntı: `dirs[:] = [...]` ile YERİNDE budama yaparsan `walk` o dalları hiç açmaz; yeni bir listeye atamak budamaz.",
    whyHere:
      "Kapsül toplayıcı ve link denetleyici `.git`, `.obsidian`, `node_modules` dallarını budar. Budama `dirs[:] =` yerine `dirs = ` yazılsaydı denetim on binlerce dosyayı gezer ve saniyeler yerine dakikalar sürerdi.",
    exercise:
      "`dirs[:] =` yerine `dirs =` yaz ve süreyi ölç. Kaç kat yavaşladı?",
    recipe: {
      id: "py-walk-glob",
      lang: "python",
      code:
        "dirs = ['.git', '_learn', '.obsidian']\n"
        + "kopya = dirs\n"
        + "kopya[:] = [d for d in kopya if not d.startswith('.')]\n"
        + "print('yerinde-budama:%s kalan:%s' % (dirs is kopya, ','.join(dirs)))",
      expect: "yerinde-budama:True kalan:_learn",
      safety: "safe",
    },
    related: ["py-os-path", "py-list-comp"],
  },
  {
    id: "py-lambda",
    track: "python",
    title: "lambda — tek ifadelik fonksiyon",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/reference/expressions.html#lambda",
    pattern: /\blambda\b/,
    files: PYFILES,
    what:
      "`lambda` tek bir İFADE alır, gövde yazamaz. `sorted(key=...)` ve küçük yardımcılar için doğrudur; iki satırdan uzun bir mantık `def` olmalıdır çünkü lambda'nın adı ve dokümanı yoktur.",
    whyHere:
      "Sıralama anahtarları ve kısa dönüştürücüler lambda ile yazılır (`key=lambda kv: (-kv[1], kv[0])`). Bu satır kritik bir kural taşır (deterministik sıra) ve tam da o yüzden yorumla açıklanır — lambda kendini anlatamaz.",
    exercise:
      "Bir lambda'yı `def`'e çevir ve ona docstring ekle. Hangi bilgi kazanıldı?",
    recipe: {
      id: "py-lambda",
      lang: "python",
      code:
        "kayitlar = [('b', 5), ('a', 5), ('c', 9)]\n"
        + "print(sorted(kayitlar, key=lambda kv: (-kv[1], kv[0])))",
      expect: "[('c', 9), ('a', 5), ('b', 5)]",
      safety: "safe",
    },
    related: ["py-sorted-key", "py-freq-count"],
  },
  {
    id: "py-slicing",
    track: "python",
    title: "Dilimleme — [a:b], negatif indeks ve kopya",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/reference/expressions.html#slicings",
    pattern: /\[[0-9]*:[0-9-]+\]|\[:-?[0-9]+\]/,
    files: PYFILES,
    what:
      "`s[:200]` ilk 200 birimi alır, `s[-4:]` son dördü. Dilim SINIR AŞMAZ: `s[:999]` kısa bir metinde hata vermez, olanı verir. Bu güvenlik aynı zamanda tuzaktır: kör kırpma sessizce cümle ortasından böler.",
    whyHere:
      "TL;DR üretimi bilerek `[:200]` ile BİTMEZ; sınır CÜMLE sınırına çekilir. Kör kırpma kapsülün tüm değerini (tek bakışta doğru fikir) yok eder ve okuyucuya yarım bilgi verir.",
    exercise:
      "Bir TL;DR'ı önce `[:200]` ile, sonra cümle-bütün kırpmayla üret. Hangisi tek başına anlaşılıyor?",
    recipe: {
      id: "py-slicing",
      lang: "python",
      code:
        "s = 'BM25 uzunluk normalizasyonu. Kisa belgeyi kayirir. Bu bizde yanlis sonuc uretti.'\n"
        + "kor = s[:40]\n"
        + "cut = s[:40]\n"
        + "i = cut.rfind('. ')\n"
        + "butun = cut[:i+1]\n"
        + "print('kor:%s|butun:%s' % (kor[-6:], butun[-6:]))",
      expect: "kor:belgey|butun:syonu.",
      safety: "safe",
    },
    related: ["js-array-slice", "agents-token-budget"],
  },
  {
    id: "py-ternary",
    track: "python",
    title: "Koşullu ifade — `a if kosul else b`",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/reference/expressions.html#conditional-expressions",
    pattern: /\S+ if .+ else /,
    files: PYFILES,
    what:
      "Python'un üçlü işleci DEĞER üretir, ifade çalıştırmaz. İç içe kullanınca okunurluk hızla düşer; ikiden fazla dal gerekiyorsa sözlük araması ya da `if/elif` daha nettir.",
    whyHere:
      "Rapor satırlarında yoğun: `'PASS' if fail == 0 else 'FAIL'`. Tek satırda karar + biçim üretmek, kapı çıktısının hepsinin aynı şekilde okunmasını sağlar.",
    exercise:
      "Üç dallı bir karar hem iç içe üçlüyle hem sözlükle yaz. Hangisi altı ay sonra okunur?",
    recipe: {
      id: "py-ternary",
      lang: "python",
      code:
        "def durum(fail, skip):\n"
        + "    return 'FAIL' if fail else ('SKIP' if skip else 'PASS')\n"
        + "print('%s %s %s' % (durum(1, 0), durum(0, 2), durum(0, 0)))",
      expect: "FAIL SKIP PASS",
      safety: "safe",
    },
    related: ["py-fstring", "sh-case"],
  },
  {
    id: "py-any-all",
    track: "python",
    title: "any / all — küme üzerinde tek cümlelik iddia",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/functions.html#any",
    pattern: /\b(any|all)\(/,
    files: PYFILES,
    what:
      "`all([])` **True** döndürür (boş küme üzerindeki her iddia doğrudur), `any([])` **False**. Bu matematiksel doğru, kapı yazarken sık bir hata kaynağıdır: hiç kontrol çalışmadıysa `all` yine yeşil verir.",
    whyHere:
      "Kapılar `all(...)` ile 'hepsi geçti' demek yerine SAYI karşılaştırır (`fail == 0` **ve** `pass > 0`). Boş girdi durumunda `all` yeşil verirdi ve hiç kontrol koşmamış bir tur 'sağlam' raporlanırdı — sahte yeşilin en sinsi biçimi.",
    exercise:
      "`all([])` ve `any([])` sonuçlarını yaz. Bir kapı yalnız `all(...)` ile karar verseydi, kontrol listesi boşalınca ne raporlardı?",
    recipe: {
      id: "py-any-all",
      lang: "python",
      code:
        "bos = []\n"
        + "print('all_bos:%s any_bos:%s guvenli:%s' % (all(bos), any(bos), bool(bos) and all(bos)))",
      expect: "all_bos:True any_bos:False guvenli:False",
      safety: "safe",
    },
    related: ["js-array-some-every", "sh-exit-code"],
  },
  {
    id: "py-sys-exit",
    track: "python",
    title: "sys.exit — çıkış kodunu kim okuyor",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/sys.html#sys.exit",
    pattern: /sys\.exit\(/,
    files: PYFILES,
    what:
      "`sys.exit(n)` bir `SystemExit` istisnası atar; geniş bir `except Exception` bunu YAKALAMAZ (SystemExit `BaseException`'dan türer), ama çıplak `except:` yakalar ve çıkışı yutar.",
    whyHere:
      "Kapı betikleri Python araçlarının çıkış kodunu okur. Bir araç hata mesajı yazıp 0 ile çıkarsa launchd bunu başarı sayar — sahte yeşil. Bu yüzden her araç `return 1` yolunu açıkça taşır.",
    exercise:
      "Bir aracı bilerek bozuk girdiyle çalıştır ve `echo $?` yaz. 0 mı 1 mi?",
    recipe: {
      id: "py-sys-exit",
      lang: "python",
      code:
        "import sys\n"
        + "def ana(fail):\n"
        + "    print('FAIL=%d' % fail)\n"
        + "    return 1 if fail else 0\n"
        + "kod = ana(0)\n"
        + "print('cikis:%d' % kod)",
      expect: "FAIL=0\ncikis:0",
      safety: "safe",
    },
    related: ["sh-exit-code", "node-process"],
  },
  {
    id: "py-shutil",
    track: "python",
    title: "shutil — güvenli kopya (yedek almanın kodu)",
    level: "temel",
    source: PY,
    url: "https://docs.python.org/3/library/shutil.html",
    pattern: /import shutil|shutil\.(copy|copy2|move|rmtree)/,
    files: PYFILES,
    what:
      "`shutil.copy2` içerikle birlikte zaman damgalarını da korur. `move` aynı dosya sisteminde ucuz bir yeniden adlandırma, farklı sistemde kopyala-sil'dir. `rmtree` geri dönüşü olmayan bir işlemdir.",
    whyHere:
      "Paylaşılan dosyalara (dataset, kod-KB) ekleme yapmadan önce **timestamped yedek** almanın kodu budur. Bu vault'ta silme yalnız `_sandbox/` altında serbesttir; `rmtree` bu depoda bilinçli olarak kullanılmaz.",
    exercise:
      "Bir dosyayı `copy` ve `copy2` ile kopyala, `stat -f %m` ile değişim zamanlarını karşılaştır. Hangisi korudu?",
    recipe: {
      id: "py-shutil",
      lang: "python",
      code:
        "import os, shutil, tempfile\n"
        + "d = tempfile.mkdtemp()\n"
        + "a = os.path.join(d, 'a.txt'); b = a + '.bak'\n"
        + "open(a, 'w', encoding='utf-8').write('veri')\n"
        + "shutil.copy2(a, b)\n"
        + "print('yedek-var:%s icerik-ayni:%s' % (os.path.exists(b), open(b, encoding='utf-8').read() == 'veri'))\n"
        + "os.remove(a); os.remove(b); os.rmdir(d)",
      expect: "yedek-var:True icerik-ayni:True",
      safety: "safe",
    },
    related: ["py-os-path", "sh-home"],
  },
];
