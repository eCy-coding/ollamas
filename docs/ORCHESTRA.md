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
