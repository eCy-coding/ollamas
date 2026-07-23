# Orkestra — ollamas · eCym · obsidian

> Tek kapı: `npm run orchestra:e2e`

## Neden bu belge var

Orkestra bir orkestra değildi, bir **paneldi**. Dört model aynı soruya, aynı bağlamla, aynı prompt'la cevap yazıyordu; hiçbirinin ayrı rolü ya da ayrı aracı yoktu. Obsidian ise üye bile değildi — sahneydi.

Ölçülen kusurlar (2026-07-22, canlı):

| Kusur | Kanıt |
|---|---|
| Ölçülen kalite seçimde atılıyordu | `scores` eCym **0.881** · ollamas **0.694** → kazanan **ollamas**. Ledger'daki 5 koşunun 5'i aynı uzman |
| Bozuk uzman "görüş" sayılıyordu | odysseus `{"ok":false,"output":{"error":"fetch failed"}}` → `degraded: []`, hata JSON'u cevap notunda uzman fikri olarak |
| eCym GPU'da sessizce yok oluyordu | `ecym: llmActive() ? undefined : gen(...)` — makine meşgulken, yani görevler koşarken, tam olarak yok |
| Obsidian üye değildi | 16 canlı aracı vardı; hub'da adı geçmiyordu |
| Görev yoktu | `sprint.md` bir kez yazılıp **hiçbir kod tarafından okunmuyordu** |

## Roller — klon değil, uzman

Her üye, **diğerlerinin yapamadığını** yapar. Rol sözleşmesi `server/orchestra-roles.ts` (`ROLE_CARDS`) içinde tek yerde tanımlıdır ve vault hub'ı bunu render eder.

| Üye | Yetenek | Yalnız onda olan |
|---|---|---|
| 🔵 **ollamas** | sqlite-vec anlamsal recall + fact-graf | Sistemin hatırladığını **doğrulanabilir `[mem:ID]` atıflı** veren tek üye |
| 🟢 **eCym** | 220 komutluk terminal kataloğu (188 safe / 32 gated) | **Makineye nasıl sorulacağını** bilen tek üye — düzyazı değil, **komut** üretir |
| 🟠 **obsidian** | 16 canlı MCP aracı (:27124) | **Çözümlenmiş backlink**'leri gören ve vault'a **yazabilen** tek üye |

eCym'in eşlemesi **deterministik**: katalog tetikleyicileri string olarak eşlenir, modelden örneklenmez. Böylece katkısı tekrarlanabilir ve testlenebilir olur.

## Kazanan seçimi — gate + kalite vetosu

```
retrieval → 4 uzman (paralel) → scoreAll (dışsal kalite) → gate argmax → qualityVeto → p_final
```

- Gate ve **offline eğitimi değişmedi**. Veto üstte bir korumadır.
- Başka bir **kullanılabilir** uzman gate'in seçimini `BRAIN_VETO_DELTA` (varsayılan **0.15**) kadar geçerse kalite kazanır.
- **Beraberlik asla veto etmez** — eşikten bağımsız olarak `delta > 0` şart. Veto bir iyileştirme olmalı, yazı-tura değil.
- Düşmüş uzman veto kazanamaz → hata zarfı asla terfi edemez.
- Keşif turlarına (`epsilon > 0`) dokunulmaz.
- **Kill-switch:** `BRAIN_VETO_DELTA=999` → eski davranış bit-aynı.
- Her veto ledger'a yazılır (`~/.llm-mission-control/ask-shared-runs.jsonl`) → gate'in hata oranı **ölçülebilir**, eşik ileride kanıtla kalibre edilir.

## Dürüstlük sözleşmesi

- **Başarısız koltuk görüş değildir.** `isFailurePayload` kendi başarısızlığını bildiren zarfı (`ok:false`, çıplak `fetch failed`) tanır. Tespit dar tutulmuştur: hatayı **anlatan** düzyazı gerçek bir cevaptır.
- Katılmayan her uzman **sebebiyle** listelenir (erişilemez / bulamadı / hata / upstream). Sessizlik ile arıza artık farklı görünür.
- Obsidian kapalıysa `ok:false` + sebep döner — "bulunamadı" gibi süslenmiş boş liste değil.

## eCym erişilebilirliği (merdiven)

```
GPU boş            → ECY_MODEL (varsayılan `ecy`)
GPU dolu           → sınırlı bekleme (ECYM_WAIT_MS, varsayılan 8000ms)
hâlâ dolu          → ECYM_FALLBACK_MODEL (varsayılan qwen3-4b-ca)
fallback tanımsız  → null + SEBEP (degradedReasons'a düşer)
```

Ağır model asla meşgul cihaza karşı koşmaz; bekleme sınırlıdır, takılan bir üretim turu durduramaz. Fallback kullanıldıysa **hangi model cevapladığı** nota yazılır.

## Görevler — sprint.md gerçekten koşar

`orchestra/sprint.md` Backlog → Doing → Done.

1. **Plan** (`planTask`) — deterministik. Her görev vault + recall adımı alır; komut adımı **yalnız katalog eşleşirse** eklenir (uydurma komut yok).
2. **Güvenlik karar tablosu:**

   | Koşul | Sonuç |
   |---|---|
   | katalog `safe` **ve** denylist temiz **ve** terminal allowlist'inde | ✅ otomatik |
   | katalogda `gated` | ⏸ `- [ ] ONAY:` |
   | denylist eşleşti (sudo/rm/dd/curl\|sh/launchctl/…) | ⏸ `- [ ] ONAY:` |
   | `{{placeholder}}` doldurulmamış | ⏸ `- [ ] ONAY:` |
   | katalog dışı (serbest komut) | ⏸ hiçbir zaman otomatik değil |

3. **Yürütme** — bağımsız adımlar `Promise.all` ile **paralel**. Kanıt notu hem adım hem toplam süreyi yazar → "eş zamanlı" iddiası ölçülen bir sayıdır.
4. **Kanıt** — her adım: rol · tam çağrı · **HAM çıktı** · süre · ok/fail. Özet kanıt değildir.
5. **Durum** — yalnız tamamen başarılı görev Done'a gider. Onay bekleyen ya da başarısız olan Doing'de kalır. **Doing'den yalnız onay işaretlenmiş görev yeniden denenir** — aksi hâlde başarısız bir görev her turda gerçek komutları yeniden koşardı.

Yürütme loopback-only `POST /api/orchestra/tasks` içindedir (komut rolü sunucunun `TerminalManager` bağlamına ihtiyaç duyar) ve **çağırana güvenmez**: verdict katalogdan yeniden türetilir.

## Terminal allowlist

eCym'in kataloğu (220) sunucunun kabuk allowlist'inden (~40 binary) çok daha geniştir. `df -h` katalogda safe olduğu hâlde exit 126 ile reddediliyordu — ve bu, "komut koştu, çıktı bu" gibi okunuyordu.

- Uyuşmazlık **çalıştırmadan önce** söylenir.
- Allowlist'e yalnız **salt-okunur teşhis** komutları eklendi (`df du ps top uptime lsof netstat vm_stat sw_vers id hostname stat file sysctl`) — hiçbiri yazmaz, silmez, kurmaz, ağ açmaz. Denylist üstte kalır.
- **Sıfır olmayan exit artık başarısızlıktır.** Önce `exitCode 126` alan görev ✅ tamam işaretleniyordu.

## GOTCHA

- `server/brain-obsidian*.ts` non-UTF8 bayt içerir → `grep -a` şart.
- **Sunucu uzun ömürlüdür:** `server/*` düzenlemesi canlıya yansımaz → `launchctl kickstart -k gui/501/com.ollamas.server`.
- Autopilot daemon staged dosyaları kendi mesajıyla commit'ler → dosyaları **açıkça** `git add`.
- `terminal-dataset.json` = `{_meta, commands[220]}` (liste değil); `safe` alanı karışık tip → `isSafe()` normalize şart.
- Gate satır sayısı `EXPERTS` uzunluğuna bağlıdır. **obsidian ask-shared koltuğu DEĞİL, rol sahibidir** — koltuk eklemek gate'i yeniden boyutlandırırdı.
- Türkçe katlama: `"İ".toLowerCase()` = `i` + U+0307. Harfler **küçültmeden önce** eşlenmeli, yoksa "İşlem" → "i slem" olur ve hiçbir şeyle eşleşmez.
- Testlerde `KHOJ_URL` kapalı porta pinlenmeli (Khoj gerçekten UP).

## Doğrulama

```bash
npm run orchestra:e2e     # 19 kontrol: üyeler · roller · güvenlik · veto · görev round-trip
npm run doctor            # yığın sağlığı
npx vitest run            # tam suite
```

---

## Görev artık CEVAP üretir ve sistem ÖĞRENİR (L39–L43)

L38'e kadar görev koşuyordu ama **iş bitmiyordu**. Kanıt notu üç ham çıktı taşıyıp duruyordu; görev "disk doluluk durumu nedir" idi ve not hiçbir yerde doluluğu söylemiyordu. Üstelik hiçbir şey hatırlanmıyordu: aynı soru tekrar sorulunca brain gerçek ölçümü değil, `disk-survey.ts` commit'ini getiriyordu.

### Sentez — yeni motor değil, mevcut panel
`askShared`'ın `recall`'ı enjekte edilebilir. Adım çıktıları kaynak olarak beslenir → **tüm panel** (4 uzman + kalite vetosu + dürüst degraded + dışsal skorlama) görevin kendi kanıtı üzerinde çalışır. L33/L34'te düzeltilen her şey burada bedava geçerli. Atıflar rol-atfetmesine dönüşür: `[mem:step:command]` = "bunu makine söyledi".

- Yalnız **gerçekten çıktı üretmiş** adımlar kaynak olur — gated adım hiçbir şey çalıştırmadı, başarısız adımda hata var, kanıt değil.
- Sonuç **ham blokların ÜSTÜNE** yazılır, bloklar **kalır**. Kanıtı silen bir özet, aynı hatanın ters yönüdür.
- Çekimserlik (`BİLGİ_YOK`) çekimserlik olarak raporlanır, cevap gibi süslenmez.

### Öğrenme döngüsü
Yalnız **bitmiş ve sonuca ulaşmış** görev bir memory yazar (`episodic`, `source: orchestra/task`). Çekimserlik bilgi değildir; gated/başarısız görev bitmemiştir. id görevden türetilir → tekrar koşma **upsert** eder, her tick'te yeni kayıt üretmez. Meşgul bir brain bitmiş görevi başarısız yapamaz.

**Kanıt:** `recall("disk doluluk")` artık `task-b4edfdfe` döndürüyor. Önce yalnız `disk-survey.ts` commit'i vardı — yani konu HAKKINDA bir commit, dakikalar önce yapılan ölçüm değil.

### obsidian YAZAR + sorgu temizliği
- `queryFor` görev cümlesinden içerik kelimelerini ayıklar. Ölçüldü: "e2e kanıt görevi disk doluluk durumu nedir" ham gidiyordu → **sıfır isabet**, 135ms boşa. Artık `"disk doluluk"`.
- `vaultWrite` (auth + CA-pinli) ile obsidian `orchestra/reports/<gün>-<slug>.md` raporunu **kendisi** yazar; kanıt notuna bağlar, kopyalamaz. `isSafeVaultPath` kaçışları istek atılmadan reddeder — yol BİZİM ürettiğimiz, o hâlde burada patlamalı.
- Vault kapalıysa rapor atlanır: bitmiş işi düşürmek için sebep değil.

### Zincir — katalog-only, 2 tur tavan
Sentez **tek bir katalog id'si** önerebilir (serbest komut değil). Öneri aynı güvenlik tablosundan geçer. `MAX_ROUNDS = 2` ve tavan, ikinci turda **takip teklif edilmeyerek** uygulanır — modelin durmasını ummakla değil. Katalog dışı id sessizce düşer.

Adaylar kabuğun gerçekten koşacaklarına indirgenir: gated olan tasarımı gereği onayda takılan bir zincir kurar, `{{placeholder}}` doldurulamaz, allowlist'in reddedeceğini teklif etmek bir turu peşinen kaybetmektir. Canlı: 220 komuttan **19 aday**.

**Zincir nasıl tetikleniyor (L44).** İlk tasarım direktifi sentez cevabının içine istiyordu ve **hiç tetiklenmedi**. Kanıt: her görev notunda yalnız odysseus düşüyordu (bağlı değil); ollamas/eCym/claudecode üçü de normal cevap veriyor, hiçbiri çekimser kalmıyor, hiçbiri direktifi yazmıyordu. Sebep yapısal: direktif **user** mesajında isteniyordu, oysa `askShared`'ın **sistem** mesajı terse çıktı dayatıyor ("SADECE… kısa ve net", "süsleme yapma") ve model sistemi dinler.

Karar bu yüzden **ayrı** sorulur, kendi sistem prompt'uyla. Ve tek çağrı yetmedi: "hem tamlığı yargıla hem 19 id'den seç" ölçüldüğünde fazla geldi — prompt ayarı hataları yer değiştirdi ama yok etmedi (tam bir disk cevabı önce `df`, sonra `ps_tree` çekti; gerçekten eksik olan bir kez düpedüz `"A"` döndürdü). **Yargılamayı seçimden ayırmak** kesinleştirdi: dört vaka × üç koşu = **12/12 doğru**. Yaygın durum da ucuzladı — tam cevap **tek** küçük çağrı, seçici yalnız seçilecek bir şey varken ödenir.

İki ek düzeltme canlı koşuların dayattığı:
- **Kanıtı üreten komut seçiciden gizlenir.** Onu yeniden önermek en sık yanlış takipti; listeden çıkarmak, modelden çıkarmamasını istemekten güvenilir.
- **`isShellRunnable`** — allowlist kapının yarısıydı. `execute()` her kabuk operatörünü de reddeder, yani `ps -A -o pid,%cpu,comm -r | head -n 11` binary kontrolünü geçip pipe yüzünden 126 alıyordu; orkestranın ilk gerçek takibi tam da onu seçti.

**Tek kabuk istisnası: sondaki `| head -n N`.** Katalogdaki beş yararlı komut (`ps_cpu ps_mem ps_tree vm_stat routes`) tam bu son ekle bitiyor ve pipe reddi onları çalışmaz kılıyordu. `execute()` son eki **söker**, taban komutu yine `execFile` ile (kabuk YOK, diğer tüm kontroller yerinde) çalıştırır, satır sınırını stdout'a **kendisi** uygular. Kalıp sona sabitlenmiş ve sayaç yalnız rakam: `foo | head -n 5; rm -rf /` eşleşmez, taban ayrıca pipe için yeniden denetlenir → yalnız TEK sondaki head kabul edilir. `|` genel olarak yasak kalır.

**Canlı kanıt:** `✅ tamam · 2 tur · 4 adım · Takip: ps_cpu — denetçi kararı`; ikinci tur gerçek veriyi getirdi (`node 184.7%`, `next-server 98.1%`), görev done + remembered + reported.

**AÇIK KALAN (dürüst):** ikinci tur veriyi getiriyor ama sentez bunu tam kullanmıyor — `node 184.7%` kanıtta dururken cevap hâlâ "sorumlu olduğu varsayılabilir" diyebiliyor, ve yerel model yük ortalamalarını "10/5/1 dakika" diye yanlış etiketleyebiliyor. Sentez prompt'una tur-farkındalığı eklendi; kalan kısım model kalitesi, mekanizma değil.

### Sonuç defteri
`~/.llm-mission-control/orchestra-tasks.jsonl` — görev başına bir satır: tur sayısı, katkı veren üyeler, süre, cevaplandı mı, kazanan, veto, gated/failed. "Orkestra gerçekten işe yarıyor mu?" sorusu artık kanıtla cevaplanır.

### Yeni GOTCHA
- Takip direktifi **yalnız kazanandan** okunuyordu → bir uzman eksiği görüp komut adlandırsa bile üslupta kaybedince sinyal çöpe gidiyordu. Artık **her uzmandan**, kazanan önce. Risk artmaz: id yine katalogla doğrulanır, adım yine güvenlik tablosundan geçer.
- Opsiyonel direktif az kullanılır. Kural "kanıt soruyu tam cevaplamıyorsa MUTLAKA" diye kaçamağa bağlandı — kaçamağın kendisi kanıtın yetmediğinin işaretidir.

---

## Sentez güvenilir, dayanıklılık kanıtlı, yaşam döngüsü tam (L45–L47)

### L45 — grounding guardrail
Ölçüldü: bir takip turu `ps -A -o %cpu`'yu getirdi (`node 184.7% · next-server 98.1%`) ama sentez hâlâ *"sorumlu olduğu varsayılabilir"* dedi ve yük ortalamalarını yanlış etiketledi. Modern RAG değerlendirmesi buna *groundedness* diyor.

`orchestra-grounding.ts` **deterministik** bir guardrail (başka bir model "iyi mi" diye sorulmaz): (1) kaçamak dil var mı (`varsayılabilir/genellikle/muhtemelen/çeşitli`, folded ASCII regex), (2) kanıttaki somut token'ları (sayı, süreç adı) kullanıyor mu — token'lar kaynaklardan çıkarılır, tablo iskeleti (PID/%CPU/COMM) elenir. Zayıfsa kendi sistem prompt'uyla **tek** yeniden-sorar; yalnız **kesinlikle daha iyi** skorlu cevap kabul edilir. Hâlâ zayıfsa `⚠️ zayıf-grounding` işaretlenir.

**En kritik sonuç:** zayıf-grounding cevap **brain'e YAZILMAZ**. L40 döngüsü görev sonuçlarını recall'a besliyor; kanıtını kullanmayan bir cevabı hafızaya almak, recall'ı güvenilmez bir "gerçek"le zehirlerdi.

GOTCHA: JS `` sadece ASCII → `çeşitli` hiç eşleşmiyordu (`ç` non-`\w`). Kaçamak tespiti artık folded cevapta çalışır.

### L46 — senaryo matrisi
Sonuç defterinde yalnız **2 benzersiz görev** (ikisi de test) vardı. `orchestra-scenarios.ts` 8 senaryo türü tanımlar (tek-komut, çok-parçalı-zincir, gated, katalog-yok, recall-only); her `expect` **aynı planlayıcıdan** (planTask/ecymPropose) türetilir → spec davranıştan sapamaz. e2e canlı koşar.

**İki davranış hatası buldu:** `felsefede özgür irade var mı` ve `orkestra nasıl çalışıyor` komut planlamıyor (vault/recall görevi), ama denetçi kaçamak-dolu cevap görünce yine de komut seçiyordu — felsefe sorusuna `df` çalıştırıyordu. Fix: ilk turda komut çalışmadıysa 2. turda takip önerilmez.

### L47 — yaşam döngüsü
- **Stale-freeze:** Doing'de `ORCHESTRA_STALE_DAYS` (vars. 7) günden eski gated görev → ❄️ işaret + not satırı. Silinmez; onay işaretlenince çözülür. Idempotent.
- **Canlı panel:** `status.md` sync-anı snapshot'ın altına cevap oranı, üye-başı katkı/kazanma, ort. tur, veto, bekleyen onay ekler — defterden türetilir. Canlı: *"Son 30 görev · cevap %100 · ort. tur 1.57 · veto 1"*.

### Ölçülen önce/sonra
| | Önce | Sonra |
|---|---|---|
| Sentez `node 184.7%` var, cevap | "varsayılabilir", brain'e yazılır | ⚠️ zayıf işaretli, brain'e YAZILMAZ |
| Yük ortalaması etiketi | "10/5/1 dakika" (yanlış) | "1/5/15 dakika" (doğru) |
| Denenen görev türü | 2 (ikisi test) | 8 senaryo, e2e'de kanıtlı |
| Gated görev Doing'de | süresiz takılı | 7 gün → ❄️ dondu |
| status.md | 4-sistem snapshot | + canlı görev metrikleri |
| orchestra:e2e | 26 kontrol | **42 kontrol** |

---

## Grounding guardrail DÜZELTİLDİ — yanlış pozitif (L49–L51)

L45 guardrail'ı **fazla agresifti**: 11 canlı görevden 3'ü weak damgalıydı ama **sadece 1'i gerçekti**.

| Görev | Eski | Kök | Yeni |
|---|---|---|---|
| sistem yükü (ps kullanmıyor) | weak | ✅ gerçek | weak ✓ (korundu) |
| hangi dizindeyim (`/Users/.../ollamas` doğru) | weak | ❌ `citesEvidence` vault sprint tarihlerini arıyordu | **grounded** ✓ |
| felsefe/recall (sayısal değil) | weak | ❌ sayısal ölçüt zorlanıyordu | atıf ölçütü → grounded (kaçamaksızsa) |

**~%67 yanlış pozitif** = doğru cevaplar da brain'e yazılmıyordu → L40 öğrenme döngüsü kırık. Web (chunk-attribution): *"yalnız ilgili chunk cevabı destekler, hepsi değil"*.

### L49 — ilgili-kaynak
Komut adımı varsa grounding YALNIZ komut çıktısının token'larıyla ölçülür (görevin asıl cevabı orada). Vault/recall token'ları score'a **eklenebilir** (destekleyici bonus) ama asla düşürmez. `hangi dizindeyim` → pwd yolunu içeriyor → grounded.

### L50 — atıf-tabanlı (komut-yok görevler)
Felsefe/recall görevinin somut sayısı yok. Komut kaynağı yoksa ölçüt sayıdan **atıfa** döner: `[mem:...]` atfı var + kaçamak yok → grounded. `citationIds` (brain-answer-score) yeniden kullanılır. `mode: numeric|citation` alanı nota+e2e'ye taşınır. **Kaçamak her iki modda yakalanır** — canlı felsefe cevabı "genellikle" dediği için hâlâ (doğru) weak.

### L51 — doğruluk ölçüldü
`tests/orchestra-grounding-accuracy.test.ts`: 12 etiketli canlı vaka, **precision/recall ≥0.9** assert. Guardrail bir daha sessizce yanlış olamaz. e2e `grounding.no-false-positive` kontrolü.

**Canlı sonuç:** `hangi dizindeyim` → grounded (brain'e yazıldı), `sistem yükü` → weak (ps kullanmıyor, doğru), `felsefe` → weak (kaçamak, doğru). orchestra:e2e 42→**43 kontrol**.
