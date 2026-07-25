// track: agents — Claude Code, eCym ve ollamas'ın ajan katmanı.
//
// Diğer izlekler dil öğretir; bu izlek **bir modelin bu makinede nasıl güvenli ve ucuz iş
// yapacağını** öğretir. Üç mekanizma tekrar tekrar geçer: izin listesi (ne çalışabilir),
// kapsül-önce erişim (ne kadar bağlam), ve UPSERT (ne kalıcı olur). Üçü de bu depoda pahalı
// öğrenilmiş derslerdir, o yüzden her biri kendi hatasıyla birlikte anlatılır.
import type { Construct } from "./types";

const CC = "claude-code-docs";
const DEVDOCS = "devdocs";

/** Ajan yüzeyi: Claude Code yapılandırması, kapsül okuyucular ve izin listesi. */
const AGENTFILES = /((^|\/)(commands|hooks|agents|skills)\/|SKILL\.md$|settings\.json$|(^|\/)(cckb|learnkb|ecy-[a-z-]+)$|(^|\/)server\/terminal\.ts$|\.py$|\.md$)/;

export const AGENTS: Construct[] = [
  {
    id: "agents-skill-frontmatter",
    track: "agents",
    title: "Skill dosyası — name + description sözleşmesi",
    level: "temel",
    source: CC,
    url: "https://code.claude.com/docs/en/skills",
    pattern: /^name:\s*[\w-]+$/m,
    files: /SKILL\.md$/,
    what:
      "Bir skill, frontmatter'ında `name` ve `description` taşıyan bir Markdown dosyasıdır. Modelin skill'i seçip seçmeyeceğine karar verdiği tek metin `description`'dır — gövde ancak seçildikten SONRA okunur.",
    whyHere:
      "`cc-kb` skill'inin açıklaması tetikleyici kelimeleri (hooks/MCP/skills/settings/permission) ve kazancı (≤1100 B, 20-30× ucuz) birlikte söyler. Açıklama 'Claude Code yardımı' gibi genel yazılsaydı model onu ya hiç seçmez ya her soruda seçerdi; ikisi de yanlış.",
    exercise:
      "Bir skill'in `description`'ından tetikleyici kelimeleri çıkar ve ilgili bir soru sor. Skill seçiliyor mu?",
    recipe: {
      id: "agents-skill-frontmatter",
      lang: "bash",
      code: "grep -c '^name:' \"$HOME/.claude/skills/cc-kb/SKILL.md\"",
      expect: "1",
      safety: "safe",
    },
    related: ["agents-slash-command", "md-frontmatter"],
  },
  {
    id: "agents-slash-command",
    track: "agents",
    title: "Slash komutu ve `allowed-tools` daraltması",
    level: "orta",
    source: CC,
    url: "https://code.claude.com/docs/en/slash-commands",
    pattern: /^allowed-tools:/m,
    files: /(^|\/)commands\/.*\.md$/,
    what:
      "`~/.claude/commands/<ad>.md` bir `/ad` komutu üretir. Frontmatter'daki `allowed-tools`, o komut çalışırken izin verilen araçları DARALTIR; `$ARGUMENTS` kullanıcının yazdığı metinle değiştirilir.",
    whyHere:
      "`/cc` komutu yalnız `Bash(cckb ask:*)` ve kardeşlerine izin verir. Daraltma olmasaydı komut, yanlışlıkla dosya yazan ya da ağ açan bir araca sapabilirdi; izin listesi burada niyeti değil, YETKİYİ sınırlar.",
    exercise:
      "`allowed-tools` satırını sil ve komutu çalıştır. Model hangi araçları kullanabilir hâle gelir?",
    recipe: {
      id: "agents-slash-command",
      lang: "bash",
      code: "grep -c '^allowed-tools:' \"$HOME/.claude/commands/cc.md\"",
      expect: "1",
      safety: "safe",
    },
    related: ["agents-skill-frontmatter", "agents-allowlist"],
  },
  {
    id: "agents-hook",
    track: "agents",
    title: "Hook — araç çağrısından önce çalışan bariyer",
    level: "ileri",
    source: CC,
    url: "https://code.claude.com/docs/en/hooks",
    pattern: /PreToolUse|SessionStart|PostToolUse|"hooks":/,
    files: AGENTFILES,
    what:
      "Hook'lar model DEĞİL, harness tarafından çalıştırılır: `PreToolUse` araç çağrısını inceleyip engelleyebilir, `SessionStart` oturum başında bağlam enjekte eder. Sıfırdan farklı çıkış kodu çağrıyı bloklar.",
    whyHere:
      "Vault silme bariyeri bir `PreToolUse` hook'udur — modele 'silme' demek yeterli değildi, çünkü talimat unutulabilir ama hook unutulmaz. Bu ayrım kritik: davranış kuralı ile MEKANİZMA farklı şeylerdir; geri dönüşsüz işler mekanizmaya bağlanır.",
    exercise:
      "Hook betiğini geçici olarak 0 döndürecek şekilde değiştir ve engellenen bir komut dene. Kim engelliyor — model mi harness mi?",
    recipe: {
      id: "agents-hook",
      lang: "python",
      code:
        "import json, os\n"
        + "p = os.path.expanduser('~/.claude/settings.json')\n"
        + "h = json.load(open(p, encoding='utf-8')).get('hooks', {})\n"
        + "print('olay:%s' % ','.join(sorted(h)))",
      expect: "olay:",
      safety: "safe",
    },
    related: ["agents-allowlist", "sh-exit-code"],
  },
  {
    id: "agents-allowlist",
    track: "agents",
    title: "İzin listesi ve exit 126 — 'çalıştı' sanılan komut",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/iam",
    pattern: /ALLOWED_BINARIES|isAllowedBinary|Security block/,
    files: AGENTFILES,
    what:
      "İzin listesi, çalıştırılabilecek programları sayar. Listede olmayan bir komut reddedilir ve kabuk 126 çıkış kodu verir: 'dosya bulundu ama çalıştırılamadı'.",
    whyHere:
      "eCym'in 220 komutluk kataloğu, ollamas'ın ~40 binary'lik izin listesinden çok geniştir. `df -h` haftalarca reddediliyor ama kayıtlara 'komut çalıştı' diye geçiyordu; makine rolü kâğıt üstünde vardı. Kök neden çalıştırıcının çıkış kodunu SINIFLANDIRMAMASIYDI. Bu yüzden `learnkb` izin listesine açıkça eklendi ve kapı çıktısını gerçekten kontrol ediyor.",
    exercise:
      "İzin listesinde olmayan bir komutu ollamas terminalinden çalıştır ve çıkış kodunu oku. Kayıt 'başarılı' mı diyor?",
    recipe: {
      id: "agents-allowlist",
      lang: "bash",
      code:
        "ALLOWED='git node python3 cckb learnkb'\n"
        + "izinli() { case \" $ALLOWED \" in *\" $1 \"*) return 0 ;; *) return 1 ;; esac; }\n"
        + "izinli learnkb && printf 'learnkb:izinli '\n"
        + "izinli rm || printf 'rm:reddedildi(126)\\n'",
      expect: "learnkb:izinli rm:reddedildi(126)",
      safety: "safe",
    },
    related: ["sh-exit-code", "node-child-process", "agents-slash-command"],
  },
  {
    id: "agents-capsule-first",
    track: "agents",
    title: "Kapsül-önce erişim (progressive disclosure)",
    level: "ileri",
    source: CC,
    url: "https://code.claude.com/docs/en/costs",
    pattern: /kapsül|capsule|progressive disclosure|ask.*get.*deep/i,
    files: AGENTFILES,
    what:
      "Bilgiye üç kademede erişilir: önce küçük bir özet (kapsül), gerekirse tam not, en son pahalı semantik arama. Her kademe bir öncekinin yetmediği kanıtlandığında açılır.",
    whyHere:
      "Ham `recall k=4` 26,6 kB (~7.600 token) döndürüyordu ve tüketiciler ya yutuyor ya kör kırpıyordu. Üç kademeli erişim aynı doğrulukla 1,0 kB'a indirdi (24-25×) ve ilk kademe AĞSIZ çalışıyor — brain kapalıyken bile cevap veriyor. Bu, model değiştirmeden elde edilen bir kazanç.",
    exercise:
      "Aynı soruyu `learnkb ask` ve `--deep` ile sor, ikisinin baytını ölç. Cevap değişti mi, oran kaç?",
    recipe: {
      id: "agents-capsule-first",
      lang: "python",
      code:
        "kademeler = [('ask', 1040), ('get', 5300), ('deep', 26596)]\n"
        + "kazanc = kademeler[2][1] / kademeler[0][1]\n"
        + "print('kademe:%d kazanc:%.1fx' % (len(kademeler), kazanc))",
      expect: "kademe:3 kazanc:25.6x",
      safety: "safe",
    },
    related: ["agents-token-budget", "data-bm25", "data-embedding"],
  },
  {
    id: "agents-token-budget",
    track: "agents",
    title: "Sert token bütçesi — ve ucuzluğun yalanı",
    level: "ileri",
    source: CC,
    url: "https://code.claude.com/docs/en/costs",
    pattern: /--budget|budget|token/i,
    files: AGENTFILES,
    what:
      "Bütçe, çıktının üst sınırıdır. Aşıldığında kırpma yapılır ama HER ŞEY kırpılamaz: kimlik (slug) ve kaynak URL'si asla kesilmez, yoksa cevap izlenemez hâle gelir.",
    whyHere:
      "Bir gün `cckb`'nin 300 satırlık sürümü 32 satırlık naif bir sürümle EZİLDİ. Çıktı DAHA KÜÇÜK oldu (418 B) ve 'kazanç 60×' diye raporlandı — bayt kapısı geçti. Yakalayan tek şey etiketli doğruluk setiydi: P@1 1.0 → 0.0. Ders: ucuzluk ve doğruluk AYRI ölçülmelidir; tek başına bayt kapısı yalancıdır.",
    exercise:
      "Bütçeyi 200 B'a indir ve doğruluk setini çalıştır. Bayt kapısı geçiyor mu, P@1 ne oldu?",
    recipe: {
      id: "agents-token-budget",
      lang: "python",
      code:
        "surumler = [{'ad': 'tam', 'bayt': 1040, 'p1': 1.0}, {'ad': 'naif', 'bayt': 418, 'p1': 0.0}]\n"
        + "gecer = [s['ad'] for s in surumler if s['bayt'] <= 1100]\n"
        + "dogru = [s['ad'] for s in surumler if s['bayt'] <= 1100 and s['p1'] >= 0.9]\n"
        + "print('bayt-kapisi:%s cift-kapi:%s' % (','.join(gecer), ','.join(dogru)))",
      expect: "bayt-kapisi:tam,naif cift-kapi:tam",
      safety: "safe",
    },
    related: ["agents-capsule-first", "agents-quality-set"],
  },
  {
    id: "agents-quality-set",
    track: "agents",
    title: "Etiketli doğruluk seti — P@1 ve H@3",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/costs",
    pattern: /P@1|H@3|precision|recall|quality/i,
    files: AGENTFILES,
    what:
      "P@1: ilk sonucun doğru olma oranı. H@3: doğru sonucun ilk üçte bulunma oranı. Yirmi elle etiketlenmiş soru, bir arama sisteminin bozulup bozulmadığını söyleyen en ucuz araçtır.",
    whyHere:
      "Kapsül katmanının doğruluğu bu setle korunuyor. Sezgi ('bana doğru geldi') bir regresyonu yakalayamaz; 20 satırlık bir etiket dosyası yakalar. Bu tier de aynı yöntemi devralıyor: `learn-quality.py`.",
    exercise:
      "Doğruluk setine kendi sorunu ekle ve beklenen slug'ı yaz. Set hâlâ 1.0 mı?",
    recipe: {
      id: "agents-quality-set",
      lang: "python",
      code:
        "sorular = [('bm25 nedir', 'data-bm25'), ('turkce buyuk I', 'py-str-translate')]\n"
        + "donen = {'bm25 nedir': ['data-bm25', 'py-math-log'], 'turkce buyuk I': ['py-str-translate']}\n"
        + "p1 = sum(1 for q, e in sorular if donen[q][0] == e) / len(sorular)\n"
        + "print('P@1=%.2f' % p1)",
      expect: "P@1=1.00",
      safety: "safe",
    },
    related: ["agents-token-budget", "data-bm25"],
  },
  {
    id: "agents-upsert-remember",
    track: "agents",
    title: "remember ile kalıcı yazma — ns tuzağı",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/memory",
    pattern: /api\/brain\/remember|remember\{|"tier":/,
    files: AGENTFILES,
    what:
      "Belleğe kalıcı yazmanın yolu `remember{id, content, ns, tier}` çağrısıdır: id verildiğinde UPSERT eder, yeni kayıt üretmez. `content` alan adıdır (`text`/`memory` değil) ve `tier` zorunludur.",
    whyHere:
      "İki tuzak birden var: (1) diske yazmak yetmez — senkronizasyon brain'in sakladığı gövdeyi geri yazar; (2) `ns` varsayılan dışında bir değere ayarlanırsa not `recall`'da GÖRÜNMEZ (recall ns=default'a süzülüdür). Doğru yazılmış bir not, yanlış namespace yüzünden hiç okunmayabilir.",
    exercise:
      "Bir notu `ns:\"learn\"` ile yaz ve varsayılan `recall` ile ara. Dönüyor mu?",
    recipe: {
      id: "agents-upsert-remember",
      lang: "python",
      code:
        "cagri = {'id': 'learn-js-regex', 'content': 'govde', 'ns': 'default', 'tier': 'reference'}\n"
        + "zorunlu = {'id', 'content', 'ns', 'tier'}\n"
        + "eksik = zorunlu - set(cagri)\n"
        + "print('eksik:%d recall-gorur:%s' % (len(eksik), cagri['ns'] == 'default'))",
      expect: "eksik:0 recall-gorur:True",
      safety: "safe",
    },
    related: ["sql-upsert", "md-body-footer"],
  },
  {
    id: "agents-recipe-contract",
    track: "agents",
    title: "Tarif sözleşmesi — dersin çalıştırılabilir yarısı",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/sdk",
    pattern: /learn-recipes|"expect":|"safety":\s*"(safe|gated)"/,
    files: /(\.json$|\.py$|(^|\/)(learnkb)$)/,
    what:
      "Bir tarif dört alandan oluşur: çalıştırılacak kod, hangi yorumlayıcı, BEKLENEN çıktı ve güvenlik sınıfı. Beklenen çıktı olmadan 'çalıştı' iddiası doğrulanamaz — çıkış kodu 0 olan yanlış bir program da 'çalışmış' görünür.",
    whyHere:
      "'ollamas ve eCym önerilen kodu kendisi uygulayabilir' cümlesinin kâğıtta kalmaması için tarifler indekslenir ve kapı bunların bir örneğini GERÇEKTEN koşup çıktıyı karşılaştırır. Notun içindeki bir kod parçası, çalıştırılabilir bir sözleşme değildir.",
    exercise:
      "Bir tarifin `expect` alanını yanlış yap ve kapıyı çalıştır. FAIL veriyor mu?",
    recipe: {
      id: "agents-recipe-contract",
      lang: "python",
      code:
        "tarif = {'id': 'x', 'lang': 'python', 'code': \"print('ok')\", 'expect': 'ok', 'safety': 'safe'}\n"
        + "zorunlu = ['id', 'lang', 'code', 'expect', 'safety']\n"
        + "print('alan-tam:%s guvenli:%s' % (all(k in tarif for k in zorunlu), tarif['safety'] == 'safe'))",
      expect: "alan-tam:True guvenli:True",
      safety: "safe",
    },
    related: ["md-fence", "agents-allowlist", "sh-exit-code"],
  },
  {
    id: "agents-health-loop",
    track: "agents",
    title: "Sağlık turu ve zarif degrade",
    level: "ileri",
    source: DEVDOCS,
    url: "https://code.claude.com/docs/en/troubleshooting",
    pattern: /health|saglik|sağlık|degrade|SKIP/i,
    files: AGENTFILES,
    what:
      "Otomatik sağlık turu hafif olmalı: ağır iş (yerel model çıkarımı) günlük göreve konmaz. Dalgalı bir servis FAIL değil SKIP üretmeli ve tur, kendini onarabildiği yerde onarmalıdır.",
    whyHere:
      "MacBook takas baskısı altında brain :3000 dalgalanıyor (200 ↔ 000). Katı bir kapı her sabah yanlış kırmızı üretirdi; sonuç, kimsenin kapıya bakmaması olurdu. Zarif degrade dürüstlükten taviz değil — SKIP sayısı raporlanır ve adı yazılır.",
    exercise:
      "brain'i kapat ve sağlık turunu çalıştır. Kaç SKIP var, hepsinin adı yazılı mı?",
    recipe: {
      id: "agents-health-loop",
      lang: "python",
      code:
        "sonuclar = [('kaynak', 'PASS'), ('recall', 'SKIP'), ('kapsul', 'PASS')]\n"
        + "fail = [a for a, s in sonuclar if s == 'FAIL']\n"
        + "skip = [a for a, s in sonuclar if s == 'SKIP']\n"
        + "print('cikis:%d skip-adlari:%s' % (1 if fail else 0, ','.join(skip)))",
      expect: "cikis:0 skip-adlari:recall",
      safety: "safe",
    },
    related: ["sh-launchd", "http-rate-limit", "sh-exit-code"],
  },
];
