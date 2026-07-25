// track: shell — kapı betikleri, sağlık turları ve launchd otomasyonu.
//
// Bu izleğin merkezinde tek bir fikir var: **sahte yeşil üretme**. Bir kabuk betiği sessizce
// başarısız olmanın en kolay yeridir (yanlış çıkış kodu, yutulan hata, tanımsız değişken), ve
// bu depodaki kapıların tamamı kabuk betiğidir. Dersler bu yüzden söz dizimi kadar ÇIKIŞ KODU
// ve DEGRADE davranışı üzerinedir.
import type { Construct } from "./types";

const W3 = "w3schools";
const DEVDOCS = "devdocs";
const ODIN = "odin";

const SHFILES = /(\.sh$|\.command$|\.zsh$|\.bash$)/;
const PLIST = /\.plist$/;

export const SHELL: Construct[] = [
  {
    id: "sh-shebang",
    track: "shell",
    title: "Shebang ve `set -u` — betiğin sözleşmesi",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_intro.php",
    pattern: /^#!\/bin\/(ba|z)?sh|^set -[eu]/m,
    files: SHFILES,
    what:
      "İlk satır yorumlayıcıyı seçer. `set -u` tanımsız değişken kullanımını hataya çevirir; `set -e` ilk hatada betiği durdurur. `set -e` her zaman istenmez: bir kapı, bir kontrol başarısız olsa da kalan kontrolleri koşmalıdır.",
    whyHere:
      "`cc-verify.sh` bilinçli olarak `set -u` kullanır ama `set -e` KULLANMAZ: amacı ilk hatada kaçmak değil, 25 kontrolün tamamını koşup sonunda FAIL sayısını bildirmektir. Kapı bir raporlayıcıdır, bir montaj hattı değil.",
    exercise:
      "`cc-verify.sh`'ye `set -e` ekle ve bir kontrolü bilerek bozacak şekilde çalıştır. Kaç kontrol raporlanır?",
    recipe: {
      id: "sh-shebang",
      lang: "bash",
      code: "set -u\nPASS=0; FAIL=1\nprintf 'ozet PASS=%d FAIL=%d\\n' \"$PASS\" \"$FAIL\"",
      expect: "ozet PASS=0 FAIL=1",
      safety: "safe",
    },
    related: ["py-shebang", "sh-exit-code"],
  },
  {
    id: "sh-function",
    track: "shell",
    title: "Fonksiyonlar — ok/bad/skip üçlüsü",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_functions.php",
    pattern: /^\s*\w+\(\)\s*\{|^\s*function \w+/m,
    files: SHFILES,
    what:
      "Kabuk fonksiyonu `ad() { ... }` biçimindedir; argümanlara `$1`, `$2` ile erişilir ve `return` yalnız 0-255 arası bir SAYI döndürür (metin değil). Metin döndürmek için `echo` edip çağrı yerinde `$( )` ile yakalamak gerekir.",
    whyHere:
      "Her kapıda `ok()`, `bad()`, `skip()` üçlüsü vardır ve sayaçları kendileri artırır. Bu sayede kontrol satırları tek satırlık ifadelere iner ve rapor biçimi tek yerde tanımlıdır — 25 kontrolün hepsi aynı görünür.",
    exercise:
      "`ok()` fonksiyonunu sayaç artırmayacak şekilde değiştir. Özet satırındaki PASS neden 0 kalır?",
    recipe: {
      id: "sh-function",
      lang: "bash",
      code:
        "PASS=0\n"
        + "ok() { printf '  PASS  %s\\n' \"$1\"; PASS=$((PASS+1)); }\n"
        + "ok 'kaynak canli'\n"
        + "ok 'kopuk link yok'\n"
        + "printf 'toplam:%d\\n' \"$PASS\"",
      expect: "toplam:2",
      safety: "safe",
    },
    related: ["sh-arithmetic", "sh-printf"],
  },
  {
    id: "sh-printf",
    track: "shell",
    title: "printf ve ANSI renkleri",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_echo.php",
    pattern: /printf\s+['"]/,
    files: SHFILES,
    what:
      "`printf` biçim dizesiyle çalışır ve `echo`'nun aksine kabuklar arasında aynı davranır (`echo -e` her kabukta yoktur). `\\033[32m` yeşil başlatır, `\\033[0m` biçimi kapatır.",
    whyHere:
      "Kapı çıktısı gözle taranır: yeşil PASS, kırmızı FAIL, sarı SKIP. Renkler `printf` içine gömülüdür; `echo -e` kullanılsaydı `sh` altında ham kaçış dizileri basılırdı.",
    exercise:
      "Aynı satırı `echo -e` ve `printf` ile yaz, `sh -c` altında çalıştır. Hangisi renk verir?",
    recipe: {
      id: "sh-printf",
      lang: "bash",
      code: "printf '  %s  %s\\n' 'PASS' 'kaynak canli'",
      expect: "PASS  kaynak canli",
      safety: "safe",
    },
    related: ["sh-function"],
  },
  {
    id: "sh-param-default",
    track: "shell",
    title: "`${VAR:-varsayilan}` — güvenli parametre genişletmesi",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_variables.php",
    pattern: /\$\{\w+:-/,
    files: SHFILES,
    what:
      "`${VAR:-x}` değişken boş ya da tanımsızsa `x` verir; `${VAR-x}` ise yalnız TANIMSIZSA verir. `set -u` altında bu biçim, tanımsız değişkenin betiği öldürmesini engellemenin yoludur.",
    whyHere:
      "`V=\"${OBSIDIAN_VAULT:-$HOME/ollamas-vault}\"` satırı her araçta aynıdır: ortam değişkeni varsa ona, yoksa varsayılana. Testler bu sayede vault'a dokunmadan geçici bir dizinle koşabilir.",
    exercise:
      "`OBSIDIAN_VAULT=/tmp/x zsh _bin/cc-verify.sh` çalıştır. Kontroller neden FAIL verir ve bu neden doğru davranıştır?",
    recipe: {
      id: "sh-param-default",
      lang: "bash",
      code: "unset TESTVAR\nprintf '%s|%s\\n' \"${TESTVAR:-varsayilan}\" \"${HOME:+ev-var}\"",
      expect: "varsayilan|ev-var",
      safety: "safe",
    },
    related: ["js-nullish", "sh-home"],
  },
  {
    id: "sh-command-substitution",
    track: "shell",
    title: "`$( )` — komut çıktısını değere çevirmek",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_variables.php",
    pattern: /\$\([^)]+\)/,
    files: SHFILES,
    what:
      "`$(komut)` komutu çalıştırır ve STDOUT'unu değer olarak verir; sondaki satır sonları kırpılır. Tırnak içine alınmazsa sonuç kelime kelime bölünür — dosya adlarında boşluk varsa bu bir hatadır.",
    whyHere:
      "Kapılar HTTP durum kodunu böyle okur: `code=$(curl -s -o /dev/null -w '%{http_code}' \"$url\")`. Tırnak unutulursa boş yanıt kelimeye dönüşmez ve karşılaştırma sessizce yanlış tarafa düşer.",
    exercise:
      "Boşluk içeren bir dosya adını `$(ls)` ile değişkene al ve tırnaksız kullan. Kaç argümana bölünür?",
    recipe: {
      id: "sh-command-substitution",
      lang: "bash",
      code: "n=$(printf 'a\\nb\\nc\\n' | wc -l | tr -d ' ')\nprintf 'satir:%s\\n' \"$n\"",
      expect: "satir:3",
      safety: "safe",
    },
    related: ["sh-pipe", "sh-curl-status"],
  },
  {
    id: "sh-pipe",
    track: "shell",
    title: "Borular ve metin süzgeçleri (grep · wc · tr · sed)",
    level: "temel",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/pipelines",
    pattern: /\|\s*(grep|wc|head|tail|sed|awk|sort|uniq|tr|jq)\b/,
    files: SHFILES,
    what:
      "Boru, soldaki komutun çıktısını sağdakinin girdisine bağlar. `grep -c` sayar, `wc -l` satır sayar (başında boşluk bırakır — `tr -d ' '` ile temizlenir), `head -n N` ilk N satırı alır.",
    whyHere:
      "Kapı kontrollerinin çoğu 'kaç tane' sorusudur ve tek satırlık boru zinciriyle yanıtlanır. Sayının kendisi kanıttır; 'çalışıyor' demek yerine sayıyı basmak bu depodaki rapor sözleşmesidir.",
    exercise:
      "`wc -l` çıktısını `tr -d ' '` olmadan bir karşılaştırmada kullan. `[ \"$n\" = \"3\" ]` neden başarısız olur?",
    recipe: {
      id: "sh-pipe",
      lang: "bash",
      code: "printf 'PASS\\nFAIL\\nPASS\\n' | grep -c PASS",
      expect: "2",
      safety: "safe",
    },
    related: ["sh-command-substitution", "sh-exit-code"],
  },
  {
    id: "sh-test-if",
    track: "shell",
    title: "`[ ]` testleri ve koşullar",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_conditions.php",
    pattern: /\bif \[|\[ "\$|\[ -[fdzn] /,
    files: SHFILES,
    what:
      "`[ -f dosya ]` dosya var mı, `[ -z \"$s\" ]` metin boş mu diye sorar. Değişkenler HER ZAMAN tırnak içinde olmalı: boş bir değişken tırnaksız yazıldığında test ifadesi eksik argümanla sözdizimi hatası verir.",
    whyHere:
      "`[ \"${1:-}\" = \"--strict\" ]` biçimi hem argüman yokluğunu hem tırnaklamayı birlikte çözer. Bu satır `set -u` altında argümansız çağrıda betiği öldürmeden çalışır.",
    exercise:
      "`[ $BOS = \"x\" ]` (tırnaksız, boş değişkenle) çalıştır. Hata mesajı ne?",
    recipe: {
      id: "sh-test-if",
      lang: "bash",
      code:
        "BOS=\"\"\n"
        + "if [ -z \"$BOS\" ]; then printf 'bos\\n'; else printf 'dolu\\n'; fi\n"
        + "if [ -f \"$HOME/ollamas-vault/README.md\" ]; then printf 'vault-var\\n'; fi",
      expect: "bos",
      safety: "safe",
    },
    related: ["sh-param-default", "sh-case"],
  },
  {
    id: "sh-case",
    track: "shell",
    title: "case — desene göre dallanma",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_conditions.php",
    pattern: /^\s*case\s+.*\s+in\b/m,
    files: SHFILES,
    what:
      "`case` bir değeri kalıplarla eşler (`200|204)`, `4*)`) ve ilk eşleşen dalı çalıştırır. Çok sayıda `if/elif` zincirinden hem kısa hem hızlıdır.",
    whyHere:
      "HTTP yanıtı sınıflandırılırken kullanılır: `200` PASS, `429|503` SKIP, kalanı FAIL. Bu üçlü ayrım kapının dürüstlüğünün temeli — hız sınırı, kopuk çapa DEĞİLDİR.",
    exercise:
      "429'u FAIL sınıfına al ve kapıyı arka arkaya iki kez çalıştır. Neden yanlış kırmızı görürsün?",
    recipe: {
      id: "sh-case",
      lang: "bash",
      code:
        "siniflandir() {\n"
        + "  case \"$1\" in\n"
        + "    200|204) printf 'PASS' ;;\n"
        + "    429|503) printf 'SKIP' ;;\n"
        + "    *) printf 'FAIL' ;;\n"
        + "  esac\n"
        + "}\n"
        + "printf '%s %s %s\\n' \"$(siniflandir 200)\" \"$(siniflandir 429)\" \"$(siniflandir 404)\"",
      expect: "PASS SKIP FAIL",
      safety: "safe",
    },
    related: ["sh-curl-status", "http-rate-limit"],
  },
  {
    id: "sh-loop",
    track: "shell",
    title: "for / while döngüleri ve yeniden deneme",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_loops.php",
    pattern: /^\s*for \w+ in |^\s*while (read|\[)/m,
    files: SHFILES,
    what:
      "`for i in 1 2 3` sabit listede, `while read -r line` satır satır girdide gezinir. `read -r` ters eğik çizgiyi kaçış saymaz — dosya yollarında bu şarttır.",
    whyHere:
      "Servis yoklaması 3 kez 2 saniye arayla dener (`for i in 1 2 3`). Tek denemede karar vermek, MacBook takas baskısı altında dalgalanan brain'i kalıcı arızalı gösterirdi; bu döngü zarif-degrade'in kendisidir.",
    exercise:
      "Yoklamayı tek denemeye indir ve brain yükselirken kapıyı çalıştır. Kaç yanlış FAIL üretir?",
    recipe: {
      id: "sh-loop",
      lang: "bash",
      code:
        "deneme=0\n"
        + "for i in 1 2 3; do\n"
        + "  deneme=$((deneme+1))\n"
        + "  [ \"$i\" = \"2\" ] && break\n"
        + "done\n"
        + "printf 'deneme:%d\\n' \"$deneme\"",
      expect: "deneme:2",
      safety: "safe",
    },
    related: ["sh-function", "http-rate-limit"],
  },
  {
    id: "sh-arithmetic",
    track: "shell",
    title: "`$(( ))` — sayaç aritmetiği",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_operators.php",
    pattern: /\$\(\(/,
    files: SHFILES,
    what:
      "`$((a+1))` tamsayı aritmetiği yapar; içinde `$` işareti gerekmez. Kabuk ondalık sayı bilmez — oran hesaplanacaksa `awk` ya da `python3` çağrılır.",
    whyHere:
      "PASS/FAIL/SKIP sayaçları böyle artırılır. Kapının son satırı bu üç sayıyı basar ve çıkış kodunu FAIL'e göre belirler; rapor ile çıkış kodu aynı sayıdan türediği için ikisi asla çelişemez.",
    exercise:
      "Kapının çıkış kodunu FAIL yerine sabit 0 yap. `launchd` bozuk bir durumu nasıl görürdü?",
    recipe: {
      id: "sh-arithmetic",
      lang: "bash",
      code: "FAIL=0\nFAIL=$((FAIL+1))\nFAIL=$((FAIL+1))\nprintf 'fail:%d cikis:%d\\n' \"$FAIL\" \"$([ \"$FAIL\" -eq 0 ] && printf 0 || printf 1)\"",
      expect: "fail:2 cikis:1",
      safety: "safe",
    },
    related: ["sh-exit-code", "sh-function"],
  },
  {
    id: "sh-exit-code",
    track: "shell",
    title: "Çıkış kodu — otomasyonun tek gerçeği",
    level: "orta",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/exit-status",
    pattern: /\bexit [0-9]|\$\?/,
    files: SHFILES,
    what:
      "0 başarı, sıfırdan farklı her şey başarısızlıktır. `launchd`, `git hook` ve CI yalnızca bu sayıya bakar — ekrana yazdığın metni okumazlar. 126 özel bir durumdur: dosya bulundu ama çalıştırılamadı.",
    whyHere:
      "Bu depoda 126, izin listesinde olmayan bir komutun imzasıdır ve bir dönem 'komut çalıştı' diye kaydedildi (L37). Ders: çıkış kodunu kaydetmeyen bir çalıştırıcı, çalışmayan bir sistemi çalışıyor gösterir.",
    exercise:
      "İzin listesinde olmayan bir komutu ollamas terminalinden çağır ve çıkış kodunu oku. 126 mı, 0 mı?",
    recipe: {
      id: "sh-exit-code",
      lang: "bash",
      code:
        "(exit 0); printf 'basari:%d ' \"$?\"\n"
        + "(exit 126); printf 'calistirilamadi:%d\\n' \"$?\"",
      expect: "basari:0 calistirilamadi:126",
      safety: "safe",
    },
    related: ["sh-arithmetic", "agents-allowlist", "node-process"],
  },
  {
    id: "sh-curl-status",
    track: "shell",
    title: "curl ile sağlık yoklaması",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_curl.php",
    pattern: /curl -s.*http|curl .*-w ['"]%\{http_code\}/,
    files: SHFILES,
    what:
      "`curl -s -o /dev/null -w '%{http_code}' --max-time 3 URL` gövdeyi atar, yalnız durum kodunu basar ve zaman aşımıyla asılı kalmaz. Zaman aşımı vermemek, bir kapının sonsuza kadar beklemesi demektir.",
    whyHere:
      "Tüm servis kontrolleri bu tek satır üzerine kurulu. `--max-time` olmadan gece koşan sağlık turu, yanıt vermeyen bir servis yüzünden sabaha kadar açık kalır ve bir sonraki turu bloke ederdi.",
    exercise:
      "`--max-time` olmadan kapalı bir porta curl at. Kaç saniye bekler?",
    recipe: {
      id: "sh-curl-status",
      lang: "bash",
      code: "curl -sL -o /dev/null -w 'kod:%{http_code}\\n' --max-time 12 https://developer.mozilla.org/",
      expect: "kod:200",
      safety: "safe",
    },
    related: ["sh-case", "http-status", "sh-command-substitution"],
  },
  {
    id: "sh-heredoc",
    track: "shell",
    title: "Heredoc — çok satırlı gövdeyi komuta vermek",
    level: "orta",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/redirections",
    pattern: /<<-?\s*['"]?[A-Z]{2,}/,
    files: SHFILES,
    what:
      "`komut <<'EOF' ... EOF` araya çok satırlı metin gömer. Sınırlayıcı tırnak içindeyse (`<<'EOF'`) değişken genişletmesi YAPILMAZ — JSON gövdesi gönderirken istenen budur.",
    whyHere:
      "JSON yükü gönderen kontroller heredoc kullanır; tırnaksız sınırlayıcı seçilseydi gövdedeki `$` işaretleri kabuk tarafından yenirdi ve API tarafında bozuk JSON görünürdü.",
    exercise:
      "`<<EOF` ile `<<'EOF'` arasında `$HOME` içeren bir gövde gönder. Hangisi ham metni korur?",
    recipe: {
      id: "sh-heredoc",
      lang: "bash",
      code: "cat <<'EOF'\n{\"query\": \"$HOME kalir\"}\nEOF",
      expect: "{\"query\": \"$HOME kalir\"}",
      safety: "safe",
    },
    related: ["sh-command-substitution", "data-json-index"],
  },
  {
    id: "sh-home",
    track: "shell",
    title: "$HOME ve taşınabilir yollar",
    level: "temel",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_variables.php",
    pattern: /\$HOME|~\/(ollamas-vault|\.local)/,
    files: SHFILES,
    what:
      "`~` yalnız kabuk genişletmesinde çalışır ve tırnak içinde ÇALIŞMAZ (`\"~/x\"` düz metindir). `$HOME` tırnak içinde de doğru genişler; betiklerde bu yüzden `$HOME` tercih edilir.",
    whyHere:
      "Vault yolları `\"$HOME/ollamas-vault\"` biçimindedir. Tek bir `\"~/ollamas-vault\"` yazımı, boşluklu bir kullanıcı adıyla değil, tırnak yüzünden hemen kırılır ve dosya bulunamaz.",
    exercise:
      "`ls \"~/ollamas-vault\"` ve `ls \"$HOME/ollamas-vault\"` çalıştır. Hangisi çalışır?",
    recipe: {
      id: "sh-home",
      lang: "bash",
      code: "[ -d \"$HOME/ollamas-vault\" ] && printf 'vault-bulundu\\n' || printf 'yok\\n'",
      expect: "vault-bulundu",
      safety: "safe",
    },
    related: ["py-os-path", "sh-param-default"],
  },
  {
    id: "sh-launchd",
    track: "shell",
    title: "launchd — macOS'ta zamanlanmış görev",
    level: "ileri",
    source: ODIN,
    url: "https://www.w3schools.com/bash/bash_cron.php",
    pattern: /<key>(Label|ProgramArguments|StartCalendarInterval|Nice)<\/key>/,
    files: PLIST,
    what:
      "launchd, macOS'un cron'udur ve görevleri XML plist dosyalarıyla tanımlar: `Label` kimlik, `ProgramArguments` çalıştırılacak komut, `StartCalendarInterval` zaman, `Nice` öncelik. `launchctl bootstrap/bootout` ile yüklenir ve kaldırılır.",
    whyHere:
      "Günlük sağlık turu launchd ile koşar ve `Nice` 10 verilir: MacBook'u yormamak açık bir tasarım kısıtıdır. Ağır e2e (yerel model çıkarımı) bilerek launchd'e KONMAZ — otomasyon hafif, ağır iş elle.",
    exercise:
      "`launchctl list | grep ollamas` çalıştır. Kaç görev yüklü ve son çıkış kodları ne?",
    recipe: {
      id: "sh-launchd",
      lang: "bash",
      code:
        "P=\"$HOME/Library/LaunchAgents/com.ollamas.cc-health.plist\"\n"
        + "[ -f \"$P\" ] && grep -c '<key>Label</key>' \"$P\" || printf '0\\n'",
      expect: "1",
      safety: "safe",
    },
    related: ["sh-exit-code", "agents-health-loop"],
  },
  {
    id: "sh-lock",
    track: "shell",
    title: "Kilit dosyası — aynı görevin iki kopyasını engellemek",
    level: "ileri",
    source: DEVDOCS,
    url: "https://devdocs.io/bash/",
    pattern: /\.lock\b|mkdir .*lock|flock/,
    files: SHFILES,
    what:
      "Kilit, aynı betiğin ikinci kopyasının başlamasını engeller. `mkdir` atomiktir ve iyi bir kilit primitifidir; ama süreç çökerse kilit ASILI kalır, bu yüzden yaş kontrolü gerekir.",
    whyHere:
      "`git .git/index.lock` bu depoda 93 dakika bayat kaldı (çöken bir autopilot turu) ve tüm commit'leri engelledi. Ders: kilit koymak yarım çözümdür; bayat kilidi tanıyıp temizleyen yol olmadan sistem kendini kilitler.",
    exercise:
      "Kilit dosyasının yaşını dakika cinsinden hesapla. Kaç dakikadan sonra 'bayat' saymak doğru olur?",
    recipe: {
      id: "sh-lock",
      lang: "bash",
      code:
        "L=\"${TMPDIR:-/tmp}/learn-demo.lock\"\n"
        + "if mkdir \"$L\" 2>/dev/null; then printf 'kilit-alindi\\n'; else printf 'zaten-calisiyor\\n'; fi\n"
        + "rmdir \"$L\" 2>/dev/null",
      expect: "kilit-alindi",
      safety: "safe",
    },
    related: ["sh-exit-code", "sh-launchd"],
  },
  {
    id: "sh-arg-parse",
    track: "shell",
    title: "Bayrak ayrıştırma — `--strict`, `--json`",
    level: "orta",
    source: W3,
    url: "https://www.w3schools.com/bash/bash_script.php",
    pattern: /"\$\{1:-\}"|"\$@"|shift\b/,
    files: SHFILES,
    what:
      "`\"$@\"` tüm argümanları TIRNAKLARI koruyarak aktarır (`$*` aktarmaz). `shift` ilkini atar. `\"${1:-}\"` argüman yokken `set -u` altında güvenlidir.",
    whyHere:
      "`cc-verify.sh --strict` tek bayrakla iki davranış arasında geçer: zarif-degrade (varsayılan, launchd için) ve tam-denetim (elle). Bayrak ayrıştırmanın basitliği, kapının iki modunun da tek dosyada kalmasını sağlar.",
    exercise:
      "`\"$@\"` yerine `$*` kullan ve boşluklu bir argüman gönder. Kaç argümana bölünür?",
    recipe: {
      id: "sh-arg-parse",
      lang: "bash",
      code:
        "set -- --strict\n"
        + "STRICT=0\n"
        + "[ \"${1:-}\" = \"--strict\" ] && STRICT=1\n"
        + "printf 'strict:%d\\n' \"$STRICT\"",
      expect: "strict:1",
      safety: "safe",
    },
    related: ["py-argv", "node-process"],
  },
];
