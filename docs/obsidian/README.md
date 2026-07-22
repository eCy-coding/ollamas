# Obsidian çizim yüzeyi kılavuzu

`obsidian-sketch.md` — Canvas, Excalidraw, graph/slides ve Sketch Your Mind kataloğunun
ollamas / eCym / odysseus için uçtan uca kılavuzu. Kardeşi `obsidian.md` v3.0 operasyon
yüzeyini (171 yardım sayfası, 114 CLI komutu) taşır; ikisi birbirini tekrar etmez, örtüşen
iki sayfa `sharedWith` + `lens` ile beyan edilir ve kapı bunu doğrular.

## Bu dizin bir arşivdir

Çalışan kopya `~/Desktop` altındadır; üretici ve kapı oradaki mutlak yolları kullanır
(vault, eklenti `data.json`, pinlenmiş REST sertifikası). Buradaki dosyalar sürüm geçmişi
ve gözden geçirme içindir.

```
~/Desktop/obsidian-sketch-gen.py       üretici — envanterin hiçbiri elle yazılmaz
~/Desktop/obsidian-sketch-verify.sh    kapı S1..S12
~/Desktop/obsidian-sketch.schema.json  S8'in koştuğu şema
~/Desktop/obsidian-sketch-reduce.py    XML -> JSON indirgeyici + sayım kontrolleri
~/Desktop/obsidian-sketch.md           çıktı — ELLE DÜZENLENMEZ
```

## Koşturma

```bash
python3 ~/Desktop/obsidian-sketch-gen.py      # üret (yazma ölçümleri _sandbox/ içinde koşar)
zsh ~/Desktop/obsidian-sketch-verify.sh       # S1..S12, exit 0 şart
SKETCH_NO_SANDBOX=1 python3 ~/Desktop/obsidian-sketch-gen.py   # yazmadan üret
```

Üretici canlı Obsidian ister: komut envanteri `GET /commands/` kaydından gelir, ayarlar
eklentinin `data.json`'ından, yardım sayfaları yayımlanan sitemap'ten. Sınıflandırılmamış tek
bir komut ya da ayar üreticiyi `sys.exit` ile öldürür — sessiz boşluk yerine gürültülü hata.

## Kapının neden dişi var

`S12` her koşuda üç bozuk kopya üretir ve `S1/S3/S8`'in onları reddettiğini gösterir.
Başarısız olamayan kapı hiçbir şey kanıtlamaz — bu kılavuzun yerini aldığı elle yazılmış
taslak tam da bu yüzden yanlıştı.

İki doğruluk kaynağı farklı davranır, kapı da onlara farklı davranır:

- `help.obsidian.md` bir SPA'dır, uydurma yola da 200 döner → doğruluk sitemap üyeliğidir
- `community.sketch-your-mind.com` Discourse'tur, uydurma konu 404 verir → doğruluk HTTP'dir

## Vault'a dokunma sözleşmesi

Yazan her ölçüm `_sandbox/` içinde koşar ve geri alınır. Emre'nin gerçek çizimleri test verisi
değildir: kapı `Excalidraw/` altındaki dosyanın sha256'sını üretim öncesi ve sonrası
karşılaştırır. Vault'tan silme her zaman API üzerinden yapılır ve yokluk iki ayrı pencerede
doğrulanır — nedeni `obsidian-sketch.md` içindeki kör nokta SB5'te yazılıdır.
