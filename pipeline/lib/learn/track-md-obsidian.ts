// track: md-obsidian — Markdown ve Obsidian yüzeyleri (wikilink, Dataview, Canvas, .base).
//
// Bu izleğin ayırt edici dersi şu: **Obsidian bazı dosyalarda diskten değil, kendi belleğinden
// otoriterdir.** `graph.json`, `*.base`, `types.json` ve workspace dosyalarına diskten yazmak
// yetmez; uygulama açıkken yazdığın değeri geri alır. Bu, bir dosya biçimi dersi değil, bir
// EŞZAMANLILIK dersidir ve buraya pahalı öğrenildiği için konuldu.
import type { Construct } from "./types";

const OBS = "obsidian-help";
const MDN = "mdn";

const MDFILES = /\.md$/;
const CANVAS = /\.canvas$/;
const BASE = /\.base$/;

export const MD_OBSIDIAN: Construct[] = [
  {
    id: "md-frontmatter",
    track: "md-obsidian",
    title: "YAML frontmatter — ve brain'in onu silmesi",
    level: "orta",
    source: OBS,
    url: "https://help.obsidian.md/Editing+and+formatting/Properties",
    pattern: /^---\n[a-z_]+:/m,
    files: MDFILES,
    what:
      "Dosyanın en başındaki `---` blokları YAML özellikleridir; Obsidian bunları 'Properties' olarak gösterir ve Dataview sorgulayabilir. Bloğun İLK satırda başlaması şarttır — bir boş satır bile onu normal metne çevirir.",
    whyHere:
      "Bu vault'ta frontmatter KALICI DEĞİLDİR: brain notu yeniden ürettiğinde yalnız kendi sabit şemasını (id/ns/tier/tags…) tutar, `source_url` gibi özel alanlar silinir. Bu yüzden kalıcı çapa gövde içine prose olarak yazılır. Biçimi bilmek yetmiyor; onu kimin yeniden yazdığını bilmek gerekiyor.",
    exercise:
      "Bir nota `source_url:` alanı ekle, 5 dakika bekle (auto-sync) ve alanı ara. Duruyor mu?",
    recipe: {
      id: "md-frontmatter",
      lang: "python",
      code:
        "note = '---\\nid: learn-x\\ntier: reference\\n---\\n\\nGovde metni'\n"
        + "korunan = {'id', 'tier', 'ns', 'tags'}\n"
        + "alanlar = [l.split(':')[0] for l in note.split('---')[1].strip().split('\\n')]\n"
        + "silinecek = [a for a in alanlar if a not in korunan]\n"
        + "print('alan:%s silinecek:%d' % (','.join(alanlar), len(silinecek)))",
      expect: "alan:id,tier silinecek:0",
      safety: "safe",
    },
    related: ["md-body-footer", "agents-upsert-remember"],
  },
  {
    id: "md-heading",
    track: "md-obsidian",
    title: "Başlıklar ve belge taslağı",
    level: "temel",
    source: MDN,
    url: "https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax",
    pattern: /^#{1,3} \S/m,
    files: MDFILES,
    what:
      "`#` H1, `##` H2… Seviye atlamak (H1'den H3'e) belge taslağını bozar; ekran okuyucu ve otomatik TOC bu hiyerarşiyi kullanır. Bir notta tek H1 olmalıdır.",
    whyHere:
      "Yardım sitesinin sağ TOC'u H2/H3'lerden üretilir. Ayrıca brain, notun H1'ini gövdenin ilk satırından TÜRETİR — saklanan gövde zaten H1 ile başlıyorsa başlık ÇİFTLENİR. Bu yüzden UPSERT'ten önce baştaki ardışık H1+callout blokları döngüyle sökülür (tek geçiş yetmiyor).",
    exercise:
      "Gövdesi `# Başlık` ile başlayan bir notu brain'e UPSERT et. Kaç H1 görüyorsun?",
    recipe: {
      id: "md-heading",
      lang: "python",
      code:
        "import re\n"
        + "govde = '# Baslik\\n> [!info] not\\n# Baslik\\nasil metin'\n"
        + "while re.match(r'^(# .*|> \\[!.*)\\n', govde):\n"
        + "    govde = re.sub(r'^(# .*|> \\[!.*)\\n', '', govde, count=1)\n"
        + "print('kalan:' + govde.split('\\n')[0])",
      expect: "kalan:asil metin",
      safety: "safe",
    },
    related: ["web-anchor-link", "md-callout"],
  },
  {
    id: "md-table",
    track: "md-obsidian",
    title: "Markdown tablosu ve boru kaçırma",
    level: "temel",
    source: OBS,
    url: "https://help.obsidian.md/Editing+and+formatting/Advanced+formatting+syntax",
    pattern: /^\|.+\|\s*$/m,
    files: MDFILES,
    what:
      "Tablo satırları `|` ile ayrılır ve ikinci satır hizalama satırıdır (`|---|`). Hücre içeriğinde `|` geçiyorsa `\\|` diye kaçırılmalı, yoksa sütun sayısı kayar ve tablo çöker.",
    whyHere:
      "Envanter ve kaynak tabloları koddan üretilir; hücrelerde düzenli ifadeler ve komutlar var — yani boru işareti sık. Üreticideki `cell()` yardımcısı bu yüzden var: tablo bozulması, veriyi görünmez yapan sessiz bir hatadır.",
    exercise:
      "Bir hücreye kaçırmadan `a|b` yaz ve Obsidian'da aç. Satırda kaç sütun görünüyor?",
    recipe: {
      id: "md-table",
      lang: "python",
      code:
        "cell = lambda c: str(c).replace('|', '\\\\|').replace('\\n', ' ').strip()\n"
        + "satir = '| %s | %s |' % (cell('re: a|b'), cell('ok'))\n"
        + "print('sutun:%d' % (satir.count('|') - satir.count('\\\\|') - 1))",
      expect: "sutun:2",
      safety: "safe",
    },
    related: ["js-string-methods", "md-heading"],
  },
  {
    id: "md-fence",
    track: "md-obsidian",
    title: "Kod blokları ve dil etiketi",
    level: "temel",
    source: OBS,
    url: "https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax",
    pattern: /^```[a-z]*$/m,
    files: MDFILES,
    what:
      "Üç ters tırnak kod bloğu açar; hemen ardındaki dil etiketi (` ```bash `) sözdizimi renklendirmesini ve kopyala düğmesinin dilini belirler. İç içe blok gerekiyorsa dıştaki dört ters tırnakla açılır.",
    whyHere:
      "Her dersin tarifi bir kod bloğudur ve dil etiketi tarifin ÇALIŞTIRICISINI seçer: `bash`, `node`, `python`. Etiket kozmetik değil, `learnkb apply` bu etikete bakarak hangi yorumlayıcıyı çağıracağına karar verir.",
    exercise:
      "Bir tarifin dil etiketini `node`'dan `python`'a değiştir ve `learnkb apply` çalıştır. Hata nerede yakalanıyor?",
    recipe: {
      id: "md-fence",
      lang: "python",
      code:
        "import re\n"
        + "md = '```bash\\nls\\n```\\n```python\\nprint(1)\\n```'\n"
        + "diller = re.findall(r'^```([a-z]+)$', md, flags=re.M)\n"
        + "print(','.join(diller))",
      expect: "bash,python",
      safety: "safe",
    },
    related: ["agents-recipe-contract", "md-callout"],
  },
  {
    id: "md-callout",
    track: "md-obsidian",
    title: "Callout kutuları",
    level: "temel",
    source: OBS,
    url: "https://help.obsidian.md/Editing+and+formatting/Callouts",
    pattern: /^> \[![a-z]+\]/m,
    files: MDFILES,
    what:
      "`> [!note]`, `> [!warning]` gibi bloklar renkli kutu üretir; `> [!note]-` biçimi katlanabilir yapar. Alıntı sözdiziminin üstüne kurulu olduğu için her satır `>` ile başlamalıdır.",
    whyHere:
      "Uyarılar (telif kuralı, silme kuralı) callout olarak yazılır ki taramada gözden kaçmasın. Ama brain notu yeniden ürettiğinde kendi callout'unu EKLER — bu yüzden gövdeyi saklarken baştaki callout blokları sökülür, yoksa her turda bir kutu daha birikir.",
    exercise:
      "Aynı notu iki kez UPSERT et. Baştaki callout sayısı artıyor mu?",
    recipe: {
      id: "md-callout",
      lang: "python",
      code:
        "md = '> [!warning] Telif\\n> W3Schools metni kopyalanmaz.\\n\\nGovde'\n"
        + "tur = md.split(']')[0].split('[!')[1]\n"
        + "print('callout:%s satir:%d' % (tur, len([l for l in md.split('\\n') if l.startswith('>')])))",
      expect: "callout:warning satir:2",
      safety: "safe",
    },
    related: ["md-heading", "md-body-footer"],
  },
  {
    id: "obs-wikilink",
    track: "md-obsidian",
    title: "Wikilink — grafiği kuran kenar",
    level: "temel",
    source: OBS,
    url: "https://help.obsidian.md/Linking+notes+and+files/Internal+links",
    pattern: /\[\[[^\]|#]+(\|[^\]]+)?\]\]/,
    files: MDFILES,
    what:
      "`[[hedef]]` bir kenar kurar; `[[hedef|görünen ad]]` metni değiştirir, `[[hedef#başlık]]` bölüme gider. Hedef yoksa bağlantı 'dangling' olur: grafikte görünür ama tıklanınca boş not açar.",
    whyHere:
      "Bir yardım/öğrenme sistemi navigasyonla tanımlanır; kopuk bağlantı, o sistemi 'not yığınına' çeviren tam kusurdur. Doğrulayıcı bu yüzden kopuk bağlantıyı uyarı değil HATA sayar ve site yazılmadan durur.",
    exercise:
      "Bir derse var olmayan bir `[[hedef]]` ekle ve `learn-build` çalıştır. Site yazılıyor mu?",
    recipe: {
      id: "obs-wikilink",
      lang: "python",
      code:
        "import re\n"
        + "govde = 'bkz [[learn-js-ts]] ve [[learn|Hub]] ve [[yok-boyle-not]]'\n"
        + "hedefler = [m.group(1).strip() for m in re.finditer(r'\\[\\[([^\\]|#]+)(?:[|#][^\\]]*)?\\]\\]', govde)]\n"
        + "var = {'learn-js-ts', 'learn'}\n"
        + "print('hedef:%d kopuk:%d' % (len(hedefler), len([h for h in hedefler if h not in var])))",
      expect: "hedef:3 kopuk:1",
      safety: "safe",
    },
    related: ["md-body-footer", "obs-dataview"],
  },
  {
    id: "md-body-footer",
    track: "md-obsidian",
    title: "Gövde-içi çapa footer'ı — kalıcı grafik bağlantısı",
    level: "ileri",
    source: OBS,
    url: "https://help.obsidian.md/Linking+notes+and+files/Internal+links",
    pattern: /\*\*(Hub|Kategori|İzlek|Track):\*\*/,
    files: MDFILES,
    what:
      "Not gövdesinin sonuna yazılan `**Hub:** [[...]] · **🔗 Kaynak:** <url>` satırı, hem insan için bir künye hem grafik için kalıcı bir kenardır.",
    whyHere:
      "Bu satır bir çözüm değil, bir YARA İZİ: brain `## Related` bölümünü kendi ilişkileriyle yeniden yazıyor ve elle konan bağlantıları uçuruyordu; kategori MOC'ları boşalıyordu. Bağlantıyı gövdenin içine gömmek, yeniden üretimden sağ çıkan tek yer olduğu için seçildi. Kategori MOC'ları da bu nedenle `#tag` yerine `LIST FROM [[...]]` (backlink) kullanır.",
    exercise:
      "Bir notun footer'ını sil, auto-sync'i bekle ve kategori MOC'unda notu ara. Görünüyor mu?",
    recipe: {
      id: "md-body-footer",
      lang: "python",
      code:
        "govde = 'ders metni'\n"
        + "footer = '\\n\\n---\\n**İzlek:** [[learn-js-ts]] · **Hub:** [[learn]] · **🔗 Kaynak:** https://developer.mozilla.org/'\n"
        + "tam = govde + footer\n"
        + "print('kenar:%d kaynak-var:%s' % (tam.count('[['), 'https://' in tam))",
      expect: "kenar:2 kaynak-var:True",
      safety: "safe",
    },
    related: ["obs-wikilink", "md-frontmatter", "agents-upsert-remember"],
  },
  {
    id: "obs-dataview",
    track: "md-obsidian",
    title: "Dataview — LIST FROM ve neden tag değil backlink",
    level: "orta",
    source: OBS,
    url: "https://help.obsidian.md/Plugins/Dataview",
    pattern: /```dataview|LIST FROM|TABLE .* FROM/,
    files: MDFILES,
    what:
      "Dataview, notları bir sorgu sonucu olarak listeler. `FROM #etiket` etikete, `FROM [[not]]` ise o nota BAĞLANANLARA bakar (backlink).",
    whyHere:
      "Etiket tabanlı MOC'lar boş kalıyordu çünkü brain özel etiketleri düşürüyor (etiketler yalnız tier/ns/system'den türetiliyor). Backlink tabanlı sorgu, gövdedeki footer bağlantısına dayandığı için hayatta kalıyor. Aynı görünen iki sorgudan biri bu sistemde çalışmıyor — fark, verinin kim tarafından yeniden yazıldığında.",
    exercise:
      "Bir kategori MOC'unu `FROM #learn/js-ts` yap ve auto-sync sonrası tekrar bak. Kaç sonuç var?",
    recipe: {
      id: "obs-dataview",
      lang: "python",
      code:
        "sorgular = {'tag': 'LIST FROM #learn/js-ts', 'backlink': 'LIST FROM [[learn-js-ts]]'}\n"
        + "brain_siliyor = {'tag'}\n"
        + "saglam = [k for k in sorgular if k not in brain_siliyor]\n"
        + "print('dayanikli:' + ','.join(saglam))",
      expect: "dayanikli:backlink",
      safety: "safe",
    },
    related: ["md-body-footer", "obs-base"],
  },
  {
    id: "obs-base",
    track: "md-obsidian",
    title: ".base dosyaları — sorgu görünümleri (ve bellek tuzağı)",
    level: "ileri",
    source: OBS,
    url: "https://help.obsidian.md/Bases",
    pattern: /^(filters|formulas|properties|views):/m,
    files: BASE,
    what:
      "`.base` dosyaları YAML ile bir tablo görünümü tanımlar: `filters` süzer, `formulas` hesaplanmış sütun ekler, `properties` görünen adları verir.",
    whyHere:
      "Bir `.base` skaler `groupBy` ile yazılmıştı ve ÜRETİMDE hiç sorgulanamıyordu; `groupBy` bir NESNE olmak zorundaydı. Üstelik Obsidian bu dosyaları bellekte tutar — açıkken diske yazdığın sürüm geri alınır. Doğrulama diskte değil, uygulamada yapılmalı.",
    exercise:
      "Obsidian açıkken bir `.base` dosyasını düzenle ve kaydet. Uygulamayı kapatıp dosyayı tekrar oku — değişiklik durdu mu?",
    recipe: {
      id: "obs-base",
      lang: "bash",
      code: "grep -cE '^(filters|formulas|properties):' \"$HOME/ollamas-vault/_index/claude-code.base\"",
      expect: "3",
      safety: "safe",
    },
    related: ["obs-dataview", "obs-graph-layers"],
  },
  {
    id: "obs-canvas",
    track: "md-obsidian",
    title: "Canvas — düğüm/kenar JSON'u",
    level: "orta",
    source: OBS,
    url: "https://help.obsidian.md/Plugins/Canvas",
    pattern: /"type":\s*"(file|text|group)"|"edges":/,
    files: CANVAS,
    what:
      "`.canvas` düz JSON'dur: `nodes` (id, type, file/text, x, y, width, height, color) ve `edges` (fromNode, toNode). Yani kod tarafından ÜRETİLEBİLİR — elle sürüklemek tek yol değildir.",
    whyHere:
      "Sistem haritaları koddan üretilir ki mimari değiştiğinde diyagram da değişsin. Elle çizilmiş bir diyagram, ilk değişiklikte yalan söylemeye başlar; üretilen diyagram kaynağıyla birlikte bayatlar.",
    exercise:
      "`claude-code.canvas` içindeki düğüm sayısını say ve MOC sayısıyla karşılaştır. Eksik olan var mı?",
    recipe: {
      id: "obs-canvas",
      lang: "python",
      code:
        "import json, os\n"
        + "p = os.path.expanduser('~/ollamas-vault/claude-code.canvas')\n"
        + "d = json.load(open(p, encoding='utf-8'))\n"
        + "print('anahtar:%s dugum-var:%s' % (','.join(sorted(d)), len(d['nodes']) > 0))",
      expect: "anahtar:edges,nodes dugum-var:True",
      safety: "safe",
    },
    related: ["obs-graph-layers", "data-json-index"],
  },
  {
    id: "obs-graph-layers",
    track: "md-obsidian",
    title: "graph.json renk katmanları — uygulama otoriter",
    level: "ileri",
    source: OBS,
    url: "https://help.obsidian.md/Plugins/Graph+view",
    pattern: /colorGroup|"query":\s*"tag:|graph\.json/,
    files: /(\.json$|\.py$)/,
    what:
      "Grafik görünümünün renk grupları `.obsidian/graph.json` içinde bir sorgu listesidir ve SIRA önemlidir: Obsidian ilk eşleşen kuralı uygular, o yüzden özelden genele yazılır.",
    whyHere:
      "Yazılan 7 katman, Obsidian tarafından 2'ye geri alındı — `.base` ve workspace ile aynı bellek tuzağı. Çözüm: kanonik katmanları bir betikte tutup her sağlık turunda yeniden uygulamak ve uygulama açıkken kapıyı FAIL değil SKIP saymak. Kalıcı yanlış-kırmızı, kapının güvenilirliğini bozar.",
    exercise:
      "Obsidian açıkken katmanları uygula, uygulamayı kapat, sağlık turunu çalıştır. Kaçıncı turda oturuyor?",
    recipe: {
      id: "obs-graph-layers",
      lang: "python",
      code:
        "kurallar = [{'query': 'tag:#system/learn'}, {'query': 'path:_learn'}, {'query': ''}]\n"
        + "ozelden_genele = [k for k in kurallar if k['query']]\n"
        + "print('kural:%d ilk:%s' % (len(ozelden_genele), ozelden_genele[0]['query']))",
      expect: "kural:2 ilk:tag:#system/learn",
      safety: "safe",
    },
    related: ["obs-base", "obs-canvas"],
  },
];
