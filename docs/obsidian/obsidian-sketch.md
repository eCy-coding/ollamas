# Obsidian Çizim Kılavuzu (Canvas + Excalidraw) v1.0 — ollamas · eCym · odysseus

> **Tek komutla doğrula:** `zsh ~/Desktop/obsidian-sketch-verify.sh`
> **Yeniden üret:** `python3 ~/Desktop/obsidian-sketch-gen.py`
> Bu dosya elle düzenlenmez. Her sayı canlı bir komuttan türetilir; kapı düşerse kılavuz yanlıştır.
> Operasyon yüzeyi (171 yardım sayfası, 114 CLI komutu) kardeş dosyada: `~/Desktop/obsidian.md` v3.0.

## Kapsam kanıtı

| Yüzey | Kapsam | Nasıl |
|---|---|---|
| Çizim yardım sayfası | **6 / 6** | sitemap'ten türetildi; kalan 165 sayfa v3.0'a devredildi |
| Çizim komutu | **77 / 77** | canlı `/commands/` kaydından (367 komut içinden 4 önek) |
| Excalidraw ayarı | **177 / 177** | 15 gruba ayrıldı; gruplanmayan anahtar üreticiyi öldürür |
| SYM ekosistem kalemi | **9 / 9** | her biri canlı HTTP koduyla |
| Karar (`şunu kullanırsan bu olur`) | **22** | SD1–SD22 |
| Adım | **54** | her biri çalıştırılabilir `Cmd` ya da açıklayıcı `Desc` |
| Kör nokta | **7** | 3 çözüldü, 4 kanıtlı açık |
| Kapı | **12** | S1–S12 |

## Taslakta bulunan ve düzeltilen uydurmalar

Bu dosyanın önceki hâli elle yazılmıştı ve doğrulanmamış iddialar içeriyordu:

1. **community.sketch-you-mind.com** → community.sketch-your-mind.com  
   `host community.sketch-you-mind.com -> NXDOMAIN (curl exit 6); host community.sketch-your-mind.com -> 141.144.200.7`
2. **Sketch-Your-Mind eklentisi** → obsidian-excalidraw-plugin 2.25.3  
   `jq -r .id /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json -> obsidian-excalidraw-plugin`
3. **Eklenti ayarları JSON paneline yapıştırılır / Validate Config butonu** → Ayarlar data.json içinde 177 anahtar; JSON yapıştırma yüzeyi yok  
   `jq 'keys|length' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/data.json -> 177`
4. **Apply sonrası 'Welcome to Excalidraw Essentials' banner'ı** → Böyle bir banner yok; kurs sayfası tarayıcıda açılır  
   `kayıtta böyle bir komut yok: GET /commands/ | grep -i essentials -> 0`
5. **<Excerpt ref="13" lines="L16-L22"/> alıntı referansları** → Hiçbir şeye çözülmeyen ölü referans; yerine çalıştırılabilir Probe/Cmd  
   `bu dosyada her iddia bir komuta bağlı`
6. **Ön koşul: Obsidian >= 1.5.0** → Ölçülen 1.12.7 (installer 1.12.7); Excalidraw minAppVersion 1.8.7  
   `obsidian version`
7. **git checkout -b … ~/Desktop içinde** → ~/Desktop bir git deposu değil; depo ollamas-obsidian-guide-wt  
   `git -C ~/Desktop rev-parse --git-dir -> fatal`

## Bu üretimde gerçekten koşan uçtan uca döngü

`_sandbox/` içinde **13/13** adım geçti:

- ✅ `canvas-put` — PUT /vault/_sandbox/sketch-probe.canvas -> 204
- ✅ `canvas-roundtrip` — GET -> 200, nodes=2 edges=1
- ✅ `excalidraw-put` — PUT gen-probe.excalidraw.md (3505 B) -> 204
- ✅ `excalidraw-open` — obsidian open -> 'Opened: _sandbox/gen-probe.excalidraw.md'
- ✅ `active-file` — GET /active/ -> _sandbox/gen-probe.excalidraw.md
- ✅ `toggle-view` — -> 'Executed: obsidian-excalidraw-plugin:toggle-excalidraw-view'
- ✅ `save` — -> 'Executed: obsidian-excalidraw-plugin:save'
- ✅ `plugin-parsed-machine-scene` — '## Text Elements' + 3 sistem adı dosyada, 3535 B
- ✅ `canvas-new-file` — obsidian command id=canvas:new-file -> yeni dosya ['Başlıksız.canvas']
- ✅ `canvas-purged` — purge() sonrası kalan: yok
- ✅ `no-stray-canvas` — vault genelinde artık tuval (attic dahil): yok
- ✅ `sandbox-clean` — _sandbox/ kaldı mı -> False
- ✅ `original-untouched` — Emre'nin çizimi sha256 0d7199b7298b… -> 0d7199b7298b…

Zincir: makine JSON yazar → REST PUT → `obsidian open` → `toggle-excalidraw-view` → `save` → eklenti bizim text elementlerimizi `## Text Elements` bölümüne çıkarır. Yani sahne gerçekten ayrıştırıldı, dosya sadece taşınmadı.

## Kanıt seviyeleri

`measured` koşuldu · `measured-sandbox` `_sandbox/` içinde koşuldu, vault geri döndü · `code` kaynaktan okundu · `doc` belgede yazıyor, koşulmadı (gerekçeli) · `unmeasurable` ölçülemez (gerekçeli)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!--

  OBSIDIAN SKETCH GUIDE v1.0 - Canvas + Excalidraw + Sketch Your Mind
  Uretim: 2026-07-22 16:37   Makine: MacBook (darwin)   Obsidian 1.12.7 (installer 1.12.7) / Excalidraw 2.25.3

  BU DOSYA ELLE DUZENLENMEZ. Uretici: ~/Desktop/obsidian-sketch-gen.py
  Kapi:                              ~/Desktop/obsidian-sketch-verify.sh   (S1..S12)
  Sema:                              ~/Desktop/obsidian-sketch.schema.json (S8 bunu kosar)
  Kardes:                            ~/Desktop/obsidian.md v3.0 (operasyon yuzeyi)

  OKUMA SIRASI
  1) Pipeline       - istenen hiyerarsi: search -> think -> ... -> merge/commit/push
  2) Corrections    - taslaktaki uydurmalar ve kaniti
  3) DecisionMatrix - 'sunu kullanirsan bu olur' (SD1..SD22, asil aradiginiz bolum)
  4) Phase 1..12    - adim adim; her Step calistirilabilir Cmd + gozlemlenebilir Expect
  5) BlindSpots     - kanitli acik isler

  KANIT SEVIYELERI: measured / measured-sandbox / code / doc / unmeasurable

-->
<ObsidianSketchGuide version="1.0" generatedAt="2026-07-22 16:37" host="macbook">
  <Environment>
    <Item key="obsidian.version" value="1.12.7 (installer 1.12.7)"><Probe cmd="obsidian version"/></Item>
    <Item key="excalidraw.version" value="2.25.3"><Probe cmd="jq -r .version /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json"/></Item>
    <Item key="excalidraw.minAppVersion" value="1.8.7"><Probe cmd="jq -r .minAppVersion /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json"/></Item>
    <Item key="localrest.version" value="4.1.7"><Probe cmd="jq -r .version /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-local-rest-api/manifest.json"/></Item>
    <Item key="canvas.core" value="True"><Probe cmd="jq .canvas /Users/emrecnyngmail.com/ollamas-vault/.obsidian/core-plugins.json"/></Item>
    <Item key="graph.core" value="True"><Probe cmd="jq .graph /Users/emrecnyngmail.com/ollamas-vault/.obsidian/core-plugins.json"/></Item>
    <Item key="slides.core" value="True"><Probe cmd="jq .slides /Users/emrecnyngmail.com/ollamas-vault/.obsidian/core-plugins.json"/></Item>
    <Item key="commands.total" value="367"><Probe cmd="GET /commands/ | jq '.commands|length'"/></Item>
    <Item key="commands.sketch" value="77"><Probe cmd="GET /commands/ | çizim önekleri"/></Item>
    <Item key="settings.excalidraw" value="177"><Probe cmd="jq 'keys|length' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/data.json"/></Item>
    <Item key="vault.canvasFiles" value="2"><Probe cmd="ls /Users/emrecnyngmail.com/ollamas-vault/*.canvas | wc -l"/></Item>
    <Item key="vault.isGitRepo" value="False"><Probe cmd="test -d /Users/emrecnyngmail.com/ollamas-vault/.git"/></Item>
    <Item key="ollamas.3000" value="200"><Probe cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/"/></Item>
    <Item key="odysseus.7860" value="000"><Probe cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:7860/"/></Item>
    <Item key="odysseus.42110" value="200"><Probe cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:42110/"/></Item>
    <Item key="odypulse.4777" value="200"><Probe cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4777/"/></Item>
    <Item key="localrest.27124" value="200"><Probe cmd="GET https://127.0.0.1:27124/ (pinlenmiş sertifika)"/></Item>
  </Environment>

  <!-- Taslaktaki her uydurma, duzeltmesi ve duzeltmeyi kanitlayan komut. -->
  <Corrections>
    <Correction id="C1">
      <Claimed>community.sketch-you-mind.com</Claimed>
      <Actual>community.sketch-your-mind.com</Actual>
      <Proof>host community.sketch-you-mind.com -&gt; NXDOMAIN (curl exit 6); host community.sketch-your-mind.com -&gt; 141.144.200.7</Proof>
    </Correction>
    <Correction id="C2">
      <Claimed>Sketch-Your-Mind eklentisi</Claimed>
      <Actual>obsidian-excalidraw-plugin 2.25.3</Actual>
      <Proof>jq -r .id /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json -&gt; obsidian-excalidraw-plugin</Proof>
    </Correction>
    <Correction id="C3">
      <Claimed>Eklenti ayarları JSON paneline yapıştırılır / Validate Config butonu</Claimed>
      <Actual>Ayarlar data.json içinde 177 anahtar; JSON yapıştırma yüzeyi yok</Actual>
      <Proof>jq 'keys|length' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/data.json -&gt; 177</Proof>
    </Correction>
    <Correction id="C4">
      <Claimed>Apply sonrası 'Welcome to Excalidraw Essentials' banner'ı</Claimed>
      <Actual>Böyle bir banner yok; kurs sayfası tarayıcıda açılır</Actual>
      <Proof>kayıtta böyle bir komut yok: GET /commands/ | grep -i essentials -&gt; 0</Proof>
    </Correction>
    <Correction id="C5">
      <Claimed>&lt;Excerpt ref=&quot;13&quot; lines=&quot;L16-L22&quot;/&gt; alıntı referansları</Claimed>
      <Actual>Hiçbir şeye çözülmeyen ölü referans; yerine çalıştırılabilir Probe/Cmd</Actual>
      <Proof>bu dosyada her iddia bir komuta bağlı</Proof>
    </Correction>
    <Correction id="C6">
      <Claimed>Ön koşul: Obsidian &gt;= 1.5.0</Claimed>
      <Actual>Ölçülen 1.12.7 (installer 1.12.7); Excalidraw minAppVersion 1.8.7</Actual>
      <Proof>obsidian version</Proof>
    </Correction>
    <Correction id="C7">
      <Claimed>git checkout -b … ~/Desktop içinde</Claimed>
      <Actual>~/Desktop bir git deposu değil; depo ollamas-obsidian-guide-wt</Actual>
      <Proof>git -C ~/Desktop rev-parse --git-dir -&gt; fatal</Proof>
    </Correction>
  </Corrections>

  <!-- Istenen calisma hiyerarsisi. Her asama, bu belgede nerede karsilandigini gosterir. -->
  <Pipeline>
    <Stage id="1" name="search">
      <Did>Canli envanter toplandi: sitemap, /commands/ kaydi, manifest, data.json, SYM HTTP.</Did>
      <Where>Environment, Inventory</Where>
    </Stage>
    <Stage id="2" name="think">
      <Did>Taslak iddialarinin hangisi olculebilir sorgulandi.</Did>
      <Where>Corrections</Where>
    </Stage>
    <Stage id="3" name="analyz">
      <Did>Cizim yuzeyi tanimlandi: 4 komut oneki + 6 yardim sayfasi; gerisi v3.0'a devredildi.</Did>
      <Where>Inventory/HelpPages, Gate S10</Where>
    </Stage>
    <Stage id="4" name="think">
      <Did>Her komut ve ayar icin risk/kanit sinifi secildi; siniflanmayan olursa uretici olur.</Did>
      <Where>Inventory/SketchCommands, Inventory/ExcalidrawSettings</Where>
    </Stage>
    <Stage id="5" name="plan">
      <Did>Kararlar 'sunu kullanirsan bu olur' bicimine dokuldu.</Did>
      <Where>DecisionMatrix SD1..SD22</Where>
    </Stage>
    <Stage id="6" name="think">
      <Did>Kararlarin hangisinin olcum gerektirdigi ayristirildi.</Did>
      <Where>SD2, SD3, SD4, SD7, SD11, SD14</Where>
    </Stage>
    <Stage id="7" name="todo">
      <Did>Olculecek adimlar faz faz siralandi.</Did>
      <Where>Phase 1..12</Where>
    </Stage>
    <Stage id="8" name="phase">
      <Did>Fazlar yazildi; her Step calistirilabilir ya da aciklayici.</Did>
      <Where>Phase 1..12</Where>
    </Stage>
    <Stage id="9" name="jsonprompt">
      <Did>Makine sozlesmesi tanimlandi ve semaya baglandi.</Did>
      <Where>JsonPrompt, Gate S8</Where>
    </Stage>
    <Stage id="10" name="plan">
      <Did>Sandbox senaryosu tasarlandi: yaz, ac, gorunumu ac, kaydet, dogrula, sil.</Did>
      <Where>Phase 6, Phase 8</Where>
    </Stage>
    <Stage id="11" name="think">
      <Did>Emre'nin gercek cizimlerine dokunmama kurali once yazildi.</Did>
      <Where>Phase 6.1</Where>
    </Stage>
    <Stage id="12" name="sandboxtest">
      <Did>Senaryo _sandbox/ icinde gercekten kosuldu.</Did>
      <Where>SandboxRun</Where>
    </Stage>
    <Stage id="13" name="think">
      <Did>Iki sessiz basarisizlik bulundu: indeks yarisi ve gorunum on kosulu.</Did>
      <Where>BlindSpot SB1, SD3</Where>
    </Stage>
    <Stage id="14" name="analyz">
      <Did>Pozitif kontrol eklendi: canvas:new-file gercekten dosya yaratti.</Did>
      <Where>Phase 3.5</Where>
    </Stage>
    <Stage id="15" name="test">
      <Did>true/false karar: makine sahnesi eklenti tarafindan ayristirildi mi?</Did>
      <Where>Phase 8.7</Where>
    </Stage>
    <Stage id="16" name="analyz">
      <Did>Kalan acikar kanitiyla yazildi, gizlenmedi.</Did>
      <Where>BlindSpots SB2, SB3, SB4, SB7</Where>
    </Stage>
    <Stage id="17" name="think">
      <Did>Kapilarin dusebilir olmasi saglandi.</Did>
      <Where>Gate S3, Gate S12</Where>
    </Stage>
    <Stage id="18" name="code">
      <Did>Uretici, sema ve kapi yazildi.</Did>
      <Where>obsidian-sketch-gen.py, .schema.json, -verify.sh</Where>
    </Stage>
    <Stage id="19" name="test">
      <Did>Kapi kosuldu; bozuk kopya reddedildi.</Did>
      <Where>Gate S1..S12</Where>
    </Stage>
    <Stage id="20" name="merge_commit_push">
      <Did>Dosyalar depoya aynalanir ve conventional commit ile gonderilir.</Did>
      <Where>Delivery</Where>
    </Stage>
  </Pipeline>

  <Inventory>
    <HelpPages count="6" siteTotal="171" delegated="165" delegatedTo="obsidian.md v3.0">
      <Page path="plugins/canvas" class="depth" sharedWith="obsidian.md v3.0" lens="v3.0: tuvali brain'in ÜRETMESİ · burada: tuvalin ne için olduğu ve makinenin nasıl yazacağı"/>
      <Page path="plugins/graph" class="depth" sharedWith="obsidian.md v3.0" lens="v3.0: graph'ın vault sağlığı göstergesi olması · burada: graph'ın hangi görsel soruyu yanıtladığı (SD8)"/>
      <Page path="plugins/slides" class="depth"/>
      <Page path="attachments" class="depth"/>
      <Page path="embeds" class="depth"/>
      <Page path="embed-web-pages" class="depth"/>
      <Delegated to="obsidian.md v3.0" count="165" reason="operasyon yüzeyi kardeş kılavuzda 171/171 sınıflandırıldı; burada tekrarı çift kayıt olurdu"/>
    </HelpPages>
    <SketchCommands count="77" registryTotal="367" source="GET /commands/ (measured)">
      <Prefix name="obsidian-excalidraw-plugin" count="69"/>
      <Prefix name="canvas" count="4"/>
      <Prefix name="graph" count="3"/>
      <Prefix name="slides" count="1"/>
      <Cmd id="canvas:convert-to-file" name="Tuval: Dosyaya dönüştür..." risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="canvas:export-as-image" name="Tuval: Görüntü olarak dışa aktar" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="canvas:jump-to-group" name="Tuval: Gruba git" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="canvas:new-file" name="Tuval: Yeni tuval oluşturun" risk="mutating" evidence="measured-sandbox"/>
      <Cmd id="graph:animate" name="Grafik Görünümü: Hızlandırılmış animasyonunu başlat" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="graph:open" name="Grafik Görünümü: Grafik görünümünü aç" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="graph:open-local" name="Grafik Görünümü: Yerel grafiği aç" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:annotate-image" name="Excalidraw: Annotate image in Excalidraw" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:convert-card-to-file" name="Excalidraw: Move back-of-note card to File" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:convert-excalidraw" name="Excalidraw: Convert *.excalidraw to *.md files" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:convert-text2MD" name="Excalidraw: Convert to file..." risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:convert-to-excalidraw" name="Excalidraw: Convert markdown note to Excalidraw Drawing" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:copy-link-to-drawing" name="Excalidraw: Copy ![[embed link]] for this drawing" risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:crop-image" name="Excalidraw: Crop and mask image" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:delete-file" name="Excalidraw: Delete selected image or Markdown file from Obsidian Vault" risk="destructive" evidence="doc" note="dosya siler; Emre'nin çizimleri test verisi değildir, koşulmadı"/>
      <Cmd id="obsidian-excalidraw-plugin:disable-binding" name="Excalidraw: Toggle to invert default binding behavior" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:disable-frameclipping" name="Excalidraw: Toggle frame clipping" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:disable-framerendering" name="Excalidraw: Toggle frame rendering" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:duplicate-image" name="Excalidraw: Duplicate selected image with a different image ID" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate" name="Excalidraw: Create new drawing - IN AN ADJACENT WINDOW" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed" name="Excalidraw: Create new drawing - IN AN ADJACENT WINDOW - and embed into active document" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-new-tab" name="Excalidraw: Create new drawing - IN A NEW TAB - and embed into active document" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-on-current" name="Excalidraw: Create new drawing - IN THE CURRENT ACTIVE WINDOW - and embed into active document" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-popout" name="Excalidraw: Create new drawing - IN A POPOUT WINDOW - and embed into active document" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-newtab" name="Excalidraw: Create new drawing - IN A NEW TAB" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-on-current" name="Excalidraw: Create new drawing - IN THE CURRENT ACTIVE WINDOW" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-autocreate-popout" name="Excalidraw: Create new drawing - IN A POPOUT WINDOW" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-convert-image-from-url-to-local-file" name="Excalidraw: Save image from URL to local file" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-disable-autosave" name="Excalidraw: Disable autosave until next time Obsidian starts (only set this if you know what you are doing)" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-download-lib" name="Excalidraw: Export stencil library as an *.excalidrawlib file" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-embeddable-poroperties" name="Excalidraw: Embeddable Properties" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-embeddables-relative-scale" name="Excalidraw: Scale selected embeddable elements to 100% relative to the current canvas zoom" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-enable-autosave" name="Excalidraw: Enable autosave" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-insert-last-active-transclusion" name="Excalidraw: Embed the most recently edited drawing" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-insert-transclusion" name="Excalidraw: Embed a drawing" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-open" name="Excalidraw: Open existing drawing - IN A NEW PANE" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-open-on-current" name="Excalidraw: Open existing drawing - IN THE CURRENT ACTIVE PANE" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-open-sidepanel" name="Excalidraw: Open Excalidraw Sidepanel" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-publish-svg-check" name="Excalidraw: Obsidian Publish: Find SVG and PNG exports that are out of date" risk="dev" evidence="doc" note="bakım/geliştirici yüzeyi; davranışı sürüme bağlı, koşulmadı"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-toggle-session-view-mode" name="Excalidraw: Toggle view mode for all Excalidraw drawings until Obsidian restarts" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:excalidraw-unzip-file" name="Excalidraw: Decompress current Excalidraw file" risk="mutating" evidence="measured-sandbox"/>
      <Cmd id="obsidian-excalidraw-plugin:export-image" name="Excalidraw: Export Image" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:flip-image" name="Excalidraw: Open the back-of-the-note for the selected image in a popout window (flip the card)" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:frame-settings" name="Excalidraw: Frame Settings" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:fullscreen" name="Excalidraw: Toggle fullscreen mode" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:import-svg" name="Excalidraw: Import an SVG file as Excalidraw strokes (limited SVG support, TEXT currently not supported)" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-LaTeX-symbol" name="Excalidraw: Insert LaTeX formula (e.g. \binom{n}{k} = \frac{n!}{k!(n-k)!})." risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-active-pdfpage" name="Excalidraw: Insert active PDF page as image" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-command" name="Excalidraw: Insert Obsidian Command as a link" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-image" name="Excalidraw: Insert image or Excalidraw drawing from your vault" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link" name="Excalidraw: Insert link to file" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link-to-element" name="Excalidraw: Copy [[link]] for selected element to clipboard." risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link-to-element-area" name="Excalidraw: Copy 'area=' ![[link]] for selected element to clipboard." risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link-to-element-frame" name="Excalidraw: Copy 'frame=' ![[link]] for selected element to clipboard." risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link-to-element-frame-clipped" name="Excalidraw: Copy 'clippedframe=' ![[link]] for selected element to clipboard." risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-link-to-element-group" name="Excalidraw: Copy 'group=' ![[link]] for selected element to clipboard." risk="readonly" evidence="doc" note="panoya yazar; pano durumu bu üreticiden gözlemlenemez"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-md" name="Excalidraw: Insert markdown file from vault" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:insert-pdf" name="Excalidraw: Insert last active PDF page as image" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:open-image-excalidraw-source" name="Excalidraw: Open Excalidraw drawing" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:open-link-props" name="Excalidraw: Open the image-link or LaTeX-formula editor" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:release-notes" name="Excalidraw: Read latest release notes" risk="dev" evidence="doc" note="bakım/geliştirici yüzeyi; davranışı sürüme bağlı, koşulmadı"/>
      <Cmd id="obsidian-excalidraw-plugin:rerun-ocr" name="Excalidraw: OCR full drawing re-run: Grab text from freedraw + images to clipboard and doc.props" risk="paid" evidence="doc" note="Taskbone OCR ücretli üçüncü taraf servisi ister — ölçülemez"/>
      <Cmd id="obsidian-excalidraw-plugin:reset-image-ar" name="Excalidraw: Reset selected image element aspect ratio" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:reset-image-to-100" name="Excalidraw: Set selected image element size to 100% of original" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:run-ocr" name="Excalidraw: OCR full drawing: Grab text from freedraw + images to clipboard and doc.props" risk="paid" evidence="doc" note="Taskbone OCR ücretli üçüncü taraf servisi ister — ölçülemez"/>
      <Cmd id="obsidian-excalidraw-plugin:run-ocr-selectedelements" name="Excalidraw: OCR selected elements: Grab text from freedraw + images to clipboard" risk="paid" evidence="doc" note="Taskbone OCR ücretli üçüncü taraf servisi ister — ölçülemez"/>
      <Cmd id="obsidian-excalidraw-plugin:save" name="Excalidraw: Save (will also update transclusions)" risk="mutating" evidence="measured-sandbox"/>
      <Cmd id="obsidian-excalidraw-plugin:scriptengine-store" name="Excalidraw: Install or update Excalidraw Scripts" risk="dev" evidence="doc" note="bakım/geliştirici yüzeyi; davranışı sürüme bağlı, koşulmadı"/>
      <Cmd id="obsidian-excalidraw-plugin:search-text" name="Excalidraw: Search for text in drawing" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:toggle-enable-context-menu" name="Excalidraw: Toggle enable context menu (helpful on Mobile devices)" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:toggle-excalidraw-view" name="Excalidraw: Toggle between Excalidraw and Markdown mode" risk="ui" evidence="measured-sandbox"/>
      <Cmd id="obsidian-excalidraw-plugin:toggle-lefthanded-mode" name="Excalidraw: Toggle left-handed mode" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:toggle-lock" name="Excalidraw: Toggle Text Element between edit RAW and PREVIEW" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:tray-mode" name="Excalidraw: Toggle UI-mode" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
      <Cmd id="obsidian-excalidraw-plugin:universal-add-file" name="Excalidraw: Insert ANY file" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="obsidian-excalidraw-plugin:universal-card" name="Excalidraw: Add back-of-note card" risk="mutating" evidence="doc" note="vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu"/>
      <Cmd id="slides:start" name="Slaytlar: Sunuma başla" risk="ui" evidence="doc" note="aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)"/>
    </SketchCommands>
    <ExcalidrawSettings count="177" groups="15" plugin="2.25.3">
      <Group name="ai" count="11" meaning="üçüncü taraf AI/OCR">
        <Key name="aiDefaultImageGenerationModel" value="&quot;gpt-image-1&quot;"/>
        <Key name="aiDefaultMaxOutgoingTokens" value="0"/>
        <Key name="aiDefaultMaxResponseTokens" value="0"/>
        <Key name="aiDefaultTextModel" value="&quot;gpt-5-mini&quot;"/>
        <Key name="aiEnabled" value="true"/>
        <Key name="aiImageModelConfigs" value="{&quot;dall-e-2&quot;: {&quot;providerId&quot;: &quot;OpenAI&quot;, &quot;model&quot;: &quot;dall-e-2&quot;…"/>
        <Key name="aiProviderProfiles" value="{&quot;OpenAI&quot;: {&quot;provider&quot;: &quot;openai&quot;, &quot;apiKey&quot;: &quot;&quot;, &quot;baseURL&quot;…"/>
        <Key name="aiTextModelConfigs" value="{&quot;gpt-5-mini&quot;: {&quot;providerId&quot;: &quot;OpenAI&quot;, &quot;model&quot;: &quot;gpt-5-m…"/>
        <Key name="aiVerboseLogging" value="false"/>
        <Key name="taskboneAPIkey" value="&quot;&quot;"/>
        <Key name="taskboneEnabled" value="false"/>
      </Group>
      <Group name="embed" count="11" meaning="çizimin nota gömülme biçimi">
        <Key name="canvasImmersiveEmbed" value="true"/>
        <Key name="embedMarkdownCommentLinks" value="true"/>
        <Key name="embedPlaceholderImage" value="true"/>
        <Key name="embedType" value="&quot;excalidraw&quot;" critical="true"/>
        <Key name="embedWikiLink" value="true"/>
        <Key name="embeddableMarkdownDefaults" value="{&quot;useObsidianDefaults&quot;: false, &quot;backgroundMatchCanvas&quot;: f…"/>
        <Key name="iframeMatchExcalidrawTheme" value="true"/>
        <Key name="oEmbedAllowed" value="false"/>
        <Key name="pageTransclusionCharLimit" value="200"/>
        <Key name="previewMatchObsidianTheme" value="false"/>
        <Key name="removeTransclusionQuoteSigns" value="true"/>
      </Group>
      <Group name="export" count="12" meaning="SVG/PNG üretimi ve otomatik dışa aktarma">
        <Key name="autoExportLightAndDark" value="false"/>
        <Key name="autoexportExcalidraw" value="false"/>
        <Key name="autoexportPNG" value="false"/>
        <Key name="autoexportSVG" value="false"/>
        <Key name="displayExportedImageIfAvailable" value="false"/>
        <Key name="displaySVGInPreview" value="false"/>
        <Key name="exportEmbedScene" value="false"/>
        <Key name="exportPaddingSVG" value="10"/>
        <Key name="exportWithBackground" value="true"/>
        <Key name="exportWithTheme" value="true"/>
        <Key name="pngExportScale" value="1"/>
        <Key name="previewImageType" value="&quot;SVG&quot;" critical="true"/>
      </Group>
      <Group name="filename" count="12" meaning="dosya adı ve bağlantı biçimi">
        <Key name="annotatePrefix" value="&quot;annotated_&quot;"/>
        <Key name="annotatePreserveSize" value="false"/>
        <Key name="annotateSuffix" value="&quot;&quot;"/>
        <Key name="cropPrefix" value="&quot;cropped_&quot;"/>
        <Key name="cropSuffix" value="&quot;&quot;"/>
        <Key name="drawingEmbedPrefixWithFilename" value="true"/>
        <Key name="drawingFilenameDateTime" value="&quot;YYYY-MM-DD HH.mm.ss&quot;"/>
        <Key name="drawingFilenamePrefix" value="&quot;Drawing &quot;"/>
        <Key name="drawingFilnameEmbedPostfix" value="&quot; &quot;"/>
        <Key name="linkPrefix" value="&quot;&quot;"/>
        <Key name="showLinkBrackets" value="false"/>
        <Key name="urlPrefix" value="&quot;&quot;"/>
      </Group>
      <Group name="folders" count="9" meaning="yeni çizimin nereye düşeceği">
        <Key name="annotateFolder" value="&quot;&quot;"/>
        <Key name="cropFolder" value="&quot;&quot;"/>
        <Key name="embedUseExcalidrawFolder" value="false"/>
        <Key name="folder" value="&quot;Excalidraw&quot;" critical="true"/>
        <Key name="fontAssetsPath" value="&quot;Excalidraw/CJK Fonts&quot;"/>
        <Key name="latexPreambleLocation" value="&quot;preamble.sty&quot;"/>
        <Key name="scriptFolderPath" value="&quot;Excalidraw/Scripts&quot;"/>
        <Key name="startupScriptPath" value="&quot;&quot;"/>
        <Key name="templateFilePath" value="&quot;Excalidraw/Template.excalidraw&quot;"/>
      </Group>
      <Group name="fonts" count="6" meaning="yazı tipi yükleme">
        <Key name="experimantalFourthFont" value="&quot;Virgil&quot;"/>
        <Key name="experimentalEnableFourthFont" value="false"/>
        <Key name="loadChineseFonts" value="false"/>
        <Key name="loadJapaneseFonts" value="false"/>
        <Key name="loadKoreanFonts" value="false"/>
        <Key name="loadPropertySuggestions" value="false"/>
      </Group>
      <Group name="interaction" count="17" meaning="fare/klavye davranışı">
        <Key name="allowCtrlClick" value="true"/>
        <Key name="defaultMode" value="&quot;normal&quot;"/>
        <Key name="desktopUIMode" value="&quot;tray&quot;"/>
        <Key name="disableContextMenu" value="false"/>
        <Key name="disableDoubleClickTextEditing" value="false"/>
        <Key name="doubleClickLinkOpenViewMode" value="true"/>
        <Key name="focusOnFileTab" value="true"/>
        <Key name="hoverPreviewWithoutCTRL" value="false"/>
        <Key name="modifierKeyConfig" value="{&quot;Mac&quot;: {&quot;LocalFileDragAction&quot;: {&quot;defaultAction&quot;: &quot;image-…"/>
        <Key name="modifierKeyOverrides" value="[{&quot;modifiers&quot;: [&quot;Mod&quot;], &quot;key&quot;: &quot;Enter&quot;}, {&quot;modifiers&quot;: [&quot;…"/>
        <Key name="openInAdjacentPane" value="true"/>
        <Key name="openInMainWorkspace" value="true"/>
        <Key name="showSecondOrderLinks" value="true"/>
        <Key name="showTabTitlebarButtons" value="true"/>
        <Key name="sidepanelTabs" value="[]"/>
        <Key name="slidingPanesSupport" value="false"/>
        <Key name="zoteroCompatibility" value="false"/>
      </Group>
      <Group name="markdown" count="18" meaning="markdown görünümünde ne render edilir">
        <Key name="done" value="&quot;🗹&quot;"/>
        <Key name="fadeOutExcalidrawMarkup" value="false"/>
        <Key name="forceWrap" value="false"/>
        <Key name="latexBoilerplate" value="&quot;\\color{green}e=mc^2&quot;"/>
        <Key name="markdownNodeOneClickEditing" value="false"/>
        <Key name="mdBorderColor" value="&quot;Black&quot;"/>
        <Key name="mdCSS" value="&quot;&quot;"/>
        <Key name="mdFont" value="&quot;Cascadia&quot;"/>
        <Key name="mdFontColor" value="&quot;Black&quot;"/>
        <Key name="mdSVGmaxHeight" value="800"/>
        <Key name="mdSVGwidth" value="500"/>
        <Key name="overrideObsidianFontSize" value="false"/>
        <Key name="parseTODO" value="false"/>
        <Key name="renderImageInHoverPreviewForMDNotes" value="false"/>
        <Key name="renderImageInMarkdownReadingMode" value="false"/>
        <Key name="renderImageInMarkdownToPDF" value="false"/>
        <Key name="todo" value="&quot;☐&quot;"/>
        <Key name="wordWrappingDefault" value="0"/>
      </Group>
      <Group name="meta" count="7" meaning="sürüm ve bildirim durumu">
        <Key name="compareManifestToPluginVersion" value="true"/>
        <Key name="drawingOpenCount" value="0"/>
        <Key name="excalidrawMasteryPromoCollapsed" value="false"/>
        <Key name="rank" value="&quot;Bronze&quot;"/>
        <Key name="showNewVersionNotification" value="true"/>
        <Key name="showReleaseNotes" value="true"/>
        <Key name="showSplashscreen" value="true"/>
      </Group>
      <Group name="mobile" count="14" meaning="telefon/tablet ve kalem">
        <Key name="customPens" value="[{&quot;type&quot;: &quot;default&quot;, &quot;freedrawOnly&quot;: false, &quot;strokeColor&quot;…"/>
        <Key name="defaultPenMode" value="&quot;never&quot;"/>
        <Key name="isLeftHanded" value="false"/>
        <Key name="laserSettings" value="{&quot;DECAY_LENGTH&quot;: 50, &quot;DECAY_TIME&quot;: 1000, &quot;COLOR&quot;: &quot;#ff0000&quot;}"/>
        <Key name="longPressDesktop" value="500"/>
        <Key name="longPressMobile" value="500"/>
        <Key name="numberOfCustomPens" value="0"/>
        <Key name="penModeCrosshairVisible" value="true"/>
        <Key name="penModeDoubleTapEraser" value="true"/>
        <Key name="penModeSingleFingerPanning" value="true"/>
        <Key name="phoneFooterSafeAreaPadding" value="false"/>
        <Key name="phoneUIMode" value="&quot;mobile&quot;"/>
        <Key name="tabletFooterSafeAreaPadding" value="false"/>
        <Key name="tabletUIMode" value="&quot;compact&quot;"/>
      </Group>
      <Group name="pdf" count="11" meaning="PDF içe aktarma">
        <Key name="pdfBorderBox" value="true"/>
        <Key name="pdfDirection" value="&quot;right&quot;"/>
        <Key name="pdfFrame" value="false"/>
        <Key name="pdfGapSize" value="20"/>
        <Key name="pdfGroupPages" value="false"/>
        <Key name="pdfImportScale" value="0.3"/>
        <Key name="pdfLockAfterImport" value="true"/>
        <Key name="pdfNumColumns" value="1"/>
        <Key name="pdfNumRows" value="1"/>
        <Key name="pdfScale" value="4"/>
        <Key name="pdfSettings" value="{&quot;pageSize&quot;: &quot;A4&quot;, &quot;pageOrientation&quot;: &quot;portrait&quot;, &quot;fitToP…"/>
      </Group>
      <Group name="rendering" count="11" meaning="performans ve tema">
        <Key name="allowImageCache" value="true"/>
        <Key name="allowImageCacheInScene" value="true"/>
        <Key name="dynamicStyling" value="&quot;colorful&quot;"/>
        <Key name="imageCacheRetentionDays" value="30"/>
        <Key name="imageElementNotice" value="true"/>
        <Key name="linkOpacity" value="1"/>
        <Key name="matchTheme" value="false"/>
        <Key name="matchThemeAlways" value="false"/>
        <Key name="matchThemeTrigger" value="false"/>
        <Key name="previousRelease" value="&quot;2.25.3&quot;"/>
        <Key name="renderingConcurrency" value="3"/>
      </Group>
      <Group name="saving" count="11" meaning="makine üretimi dosyanın diske nasıl döndüğü — compress burada">
        <Key name="autosave" value="true" critical="true"/>
        <Key name="autosaveIntervalDesktop" value="60000"/>
        <Key name="autosaveIntervalMobile" value="30000"/>
        <Key name="compatibilityMode" value="false" critical="true"/>
        <Key name="compress" value="true" critical="true"/>
        <Key name="decompressForMDView" value="false" critical="true"/>
        <Key name="keepInSync" value="false"/>
        <Key name="onceOffCompressFlagReset" value="true"/>
        <Key name="onceOffGPTVersionReset" value="true"/>
        <Key name="syncExcalidraw" value="false"/>
        <Key name="useExcalidrawExtension" value="true" critical="true"/>
      </Group>
      <Group name="script" count="14" meaning="ExcalidrawAutomate script motoru">
        <Key name="addDummyTextElement" value="false"/>
        <Key name="copyFrameLinkByName" value="false"/>
        <Key name="copyLinkToElemenetAnchorTo100" value="false"/>
        <Key name="enableCommandLinks" value="false"/>
        <Key name="enableOnloadScripts" value="false"/>
        <Key name="experimentalFileTag" value="&quot;✏️&quot;"/>
        <Key name="experimentalFileType" value="false"/>
        <Key name="experimentalLivePreview" value="true"/>
        <Key name="fieldSuggester" value="true"/>
        <Key name="library" value="&quot;deprecated&quot;"/>
        <Key name="library2" value="{&quot;type&quot;: &quot;excalidrawlib&quot;, &quot;version&quot;: 2, &quot;source&quot;: &quot;https:…"/>
        <Key name="pinnedScripts" value="[]"/>
        <Key name="scriptEngineSettings" value="{}"/>
        <Key name="syncElementLinkWithText" value="false"/>
      </Group>
      <Group name="zoom" count="13" meaning="tuval navigasyonu">
        <Key name="allowPinchZoom" value="false"/>
        <Key name="allowWheelZoom" value="false"/>
        <Key name="areaZoomLimit" value="1"/>
        <Key name="gridSettings" value="{&quot;DYNAMIC_COLOR&quot;: true, &quot;COLOR&quot;: &quot;#000000&quot;, &quot;OPACITY&quot;: 50…"/>
        <Key name="height" value="&quot;&quot;"/>
        <Key name="panWithRightMouseButton" value="false"/>
        <Key name="width" value="&quot;400&quot;"/>
        <Key name="zoomMax" value="30"/>
        <Key name="zoomMin" value="0.1"/>
        <Key name="zoomStep" value="0.05"/>
        <Key name="zoomToFitMaxLevel" value="2"/>
        <Key name="zoomToFitOnOpen" value="true"/>
        <Key name="zoomToFitOnResize" value="false"/>
      </Group>
    </ExcalidrawSettings>
    <SymCatalogue count="9" host="https://community.sketch-your-mind.com" note="Discourse; uydurma konu id 404 verir, bu yüzden canlılık gerçek bir ölçümdür">
      <Product id="essentials" title="Excalidraw Essentials" url="https://community.sketch-your-mind.com/t/722" tier="free" http="301" evidence="measured">
        <Desc>Ücretsiz 10 derslik mini kurs: şablon, PDF, script, postcard yöntemi.</Desc>
      </Product>
      <Product id="mastery" title="Excalidraw Mastery" url="https://community.sketch-your-mind.com/t/18" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Derinlemesine Obsidian-Excalidraw eğitimi; canlı oturum ve iş akışları.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="mindmap" title="MindMap Builder" url="https://community.sketch-your-mind.com/t/378" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Klavyeyle sürülen görsel haritalama; Mastery üyeliğine dahil.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="workshop" title="Visual Thinking Workshop" url="https://community.sketch-your-mind.com/t/347" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Postcard yöntemi ve Book-on-a-Page; kendi hızında ya da canlı kohort.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="life" title="Sketch Your Life" url="https://community.sketch-your-mind.com/t/348" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Araçtan bağımsız düşünme araçları; henüz yayında değil.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="book" title="Sketch Your Mind (kitap)" url="https://community.sketch-your-mind.com/t/24" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Kelime + görsel + uzamı tek düşünme sistemine bağlayan temel kitap.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="conference" title="Sketch Your Mind Conference" url="https://community.sketch-your-mind.com/t/352" tier="paid" http="301" evidence="unmeasurable">
        <Desc>Yıllık çevrimiçi konferans.</Desc>
        <Note>içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)</Note>
      </Product>
      <Product id="welcome" title="Topluluk giriş sayfası (Start Here)" url="https://community.sketch-your-mind.com/t/353" tier="free" http="301" evidence="measured">
        <Desc>Hedefine göre yol seçtiren giriş listesi; ekosistem sayfasına buradan gidilir.</Desc>
      </Product>
      <Product id="ecosystem" title="SYM Ekosistem sayfası" url="https://community.sketch-your-mind.com/t/375" tier="free" http="301" evidence="measured">
        <Desc>Tüm ürünlerin tek listesi; bu katalog oradan türetildi.</Desc>
      </Product>
    </SymCatalogue>
    <Plugins core="31" community="11">
      <Core name="canvas" enabled="true"/>
      <Core name="graph" enabled="true"/>
      <Core name="slides" enabled="true"/>
      <Community id="obsidian-excalidraw-plugin" version="2.25.3" minApp="1.8.7" author="Zsolt Viczian"/>
      <Community id="obsidian-local-rest-api" version="4.1.7"/>
    </Plugins>
  </Inventory>

  <!-- 'sunu kullanirsan bu olur / bunu kullanirsan bu olur' - bu belgenin varlik sebebi. -->
  <DecisionMatrix>
    <Decision id="SD1" question="Uzamsal bir harita mı, serbest çizim mi?">
      <Option id="SD1.A" use="Canvas (çekirdek eklenti)" evidence="measured">
        <Then>JSON Canvas açık biçim; brain doğrudan üretiyor (server/brain-obsidian.ts:346 ve :577). Vault kökünde şu an 2 .canvas var.</Then>
        <Else>Serbest el çizimi, şekil kütüphanesi ve kalem yok.</Else>
        <Cost>Sıfır: çekirdek, eklenti gerekmez.</Cost>
      </Option>
      <Option id="SD1.B" use="Excalidraw eklentisi" evidence="measured">
        <Then>69 komut, 177 ayar, script motoru, OCR, PDF içe aktarma.</Then>
        <Else>Biçim eklentiye bağlı; varsayılan olarak sıkıştırılmış saklanır.</Else>
        <Cost>Eklenti bağımlılığı + eklenti sürümüne bağlı biçim.</Cost>
      </Option>
      <Recommend>Makine üretimi ve uzun ömür için Canvas; insan eliyle düşünme için Excalidraw. İkisi bir arada kullanılır — biri diğerinin yerine geçmez.</Recommend>
    </Decision>
    <Decision id="SD2" question="Excalidraw dosyası nasıl saklansın?">
      <Option id="SD2.A" use="compress=true (şu anki değer: True)" evidence="measured-sandbox">
        <Then>Çizim `compressed-json` blokuna sıkıştırılır; dosya küçük, git diff'i okunmaz. Ölçüm: makine yazımı 3505 B düz JSON, eklenti kaydettikten sonra sıkıştırılmış olarak geri yazıldı.</Then>
        <Else>grep/dataview çizim içeriğini göremez.</Else>
        <Cost>Okunabilirlik.</Cost>
      </Option>
      <Option id="SD2.B" use="compress=false" evidence="doc">
        <Then>Çizim düz ```json bloğunda kalır; git diff anlamlı, grep çalışır.</Then>
        <Else>Dosya büyür; çok elemanlı sahnelerde not listesi yavaşlar.</Else>
        <Cost>Disk + indeksleme.</Cost>
      </Option>
      <Recommend>Makine üreten taraf her zaman DÜZ json yazar (eklenti ikisini de okur). Sıkıştırma kararını eklentiye bırak: açtığında kendi ayarına göre yeniden yazar.</Recommend>
    </Decision>
    <Decision id="SD3" question="Makine ürettiği çizimi vault'a nasıl koyar?">
      <Option id="SD3.A" use="REST PUT /vault/&lt;path&gt;" evidence="measured-sandbox">
        <Then>204 döner ve Obsidian dosyayı ANINDA bilir; hemen `obsidian open` edilebilir.</Then>
        <Cost>Local REST API + pinlenmiş sertifika.</Cost>
      </Option>
      <Option id="SD3.B" use="Doğrudan diske yazmak (cp/write)" evidence="measured-sandbox">
        <Then>Dosya diskte oluşur.</Then>
        <Else>Obsidian indeksi bilmez: `obsidian open path=…` -&gt; `Error: File &quot;…&quot; not found.` (ölçüldü).</Else>
        <Cost>Sessiz zamanlama hatası.</Cost>
      </Option>
      <Recommend>Vault'a her zaman REST üzerinden yaz. Diske doğrudan yazmak indeks yarışı yaratır.</Recommend>
    </Decision>
    <Decision id="SD4" question="Excalidraw komutu başsız nasıl koşturulur?">
      <Option id="SD4.A" use="Sadece `obsidian command id=…`" evidence="measured-sandbox">
        <Then>`Executed: …` yazar.</Then>
        <Else>Aktif Excalidraw görünümü yoksa HİÇBİR ŞEY olmaz ve hata da vermez. Ölçüm: unzip komutu dosyayı 574 B'de bıraktı.</Else>
        <Cost>Sessiz başarısızlık.</Cost>
      </Option>
      <Option id="SD4.B" use="open -&gt; toggle-excalidraw-view -&gt; komut" evidence="measured-sandbox">
        <Then>Ölçüm: aynı unzip komutu 574 B -&gt; 510 B, `compressed-json` sayısı 1 -&gt; 0.</Then>
        <Cost>İki ek komut + ~4 s bekleme.</Cost>
      </Option>
      <Recommend>Her zaman SD4.B. `Executed:` çıktısı etki kanıtı değildir; kanıt gözlemlenebilir dosya değişimidir.</Recommend>
    </Decision>
    <Decision id="SD5" question="Çizim not içine nasıl bağlansın?">
      <Option id="SD5.A" use="![[drawing.excalidraw]] gömme" evidence="doc">
        <Then>Not okuma modunda çizim görüntü olarak görünür (embedType=excalidraw).</Then>
        <Else>Not dosyası büyümez ama render maliyeti her açılışta ödenir.</Else>
      </Option>
      <Option id="SD5.B" use="[[drawing.excalidraw]] bağlantı" evidence="doc">
        <Then>Not hafif kalır; çizim ayrı sekmede açılır.</Then>
        <Else>Görsel bağlam kaybolur.</Else>
      </Option>
      <Option id="SD5.C" use="Otomatik SVG/PNG dışa aktarım" evidence="doc">
        <Then>autoexportSVG=False / autoexportPNG=False; Obsidian dışında da açılabilen dosya üretir.</Then>
        <Else>İki kaynak doğru olur — dışa aktarım bayatlayabilir.</Else>
      </Option>
      <Recommend>Vault içi kullanım için gömme; vault dışına paylaşım gerekiyorsa SVG dışa aktarımını AÇ ve bayatlığı `excalidraw-publish-svg-check` ile denetle.</Recommend>
    </Decision>
    <Decision id="SD6" question="Yeni çizim hangi komutla açılsın?">
      <Option id="SD6.A" use="excalidraw-autocreate" evidence="doc">
        <Then>Yeni çizimi `Excalidraw` klasöründe açar.</Then>
      </Option>
      <Option id="SD6.B" use="excalidraw-autocreate-and-embed" evidence="doc">
        <Then>Yeni çizimi oluşturur VE aktif nota gömme bağlantısını yazar.</Then>
        <Else>Aktif not yoksa çalışmaz.</Else>
      </Option>
      <Option id="SD6.C" use="excalidraw-autocreate-popout" evidence="doc">
        <Then>Ayrı pencerede açar; ikinci ekran akışı.</Then>
        <Else>Pencere yönetimi işletim sistemine kalır.</Else>
      </Option>
      <Recommend>Not alırken SD6.B (bağlam kaybolmaz); tek başına çizerken SD6.A.</Recommend>
    </Decision>
    <Decision id="SD7" question="Canvas dosyasını kim üretsin?">
      <Option id="SD7.A" use="brain (server/brain-obsidian.ts)" evidence="measured">
        <Then>writeEntityMapCanvas() :346 ve writeOrchestra() :577 iki .canvas dosyasını yeniden yazar; launchd com.ollamas.brain-obsidian-sync 300 s'de bir koşar. Tamamen yeniden üretilebilir olduğu ölçüldü: orchestra.canvas kazara silindi, `curl -X POST :3000/api/brain/obsidian/sync -d '{&quot;direction&quot;:&quot;push&quot;}'` tek çağrıda 9 node / 11 kenar ile birebir geri getirdi.</Then>
        <Else>Elle yapılan düzenleme bir sonraki senkronda EZİLİR.</Else>
        <Cost>Üretilen dosya elle düzenlenemez.</Cost>
      </Option>
      <Option id="SD7.B" use="Elle / canvas:new-file" evidence="measured-sandbox">
        <Then>İnsanın sahibi olduğu kalıcı tuval. Ölçüm: komut vault kökünde yeni bir .canvas yarattı.</Then>
        <Else>Dosya adı ARAYÜZ DİLİNDEDİR — bu makinede `Başlıksız.canvas`, `Untitled.canvas` değil. Adı sabit varsayan script kırılır.</Else>
      </Option>
      <Recommend>Türetilmiş harita brain'in; düşünme tuvali insanın. brain'in yazdığı iki dosyayı elle düzenleme.</Recommend>
    </Decision>
    <Decision id="SD8" question="Görsel yüzeylerden hangisi hangi soruyu yanıtlar?">
      <Option id="SD8.A" use="Graph view (graph:open)" evidence="measured">
        <Then>Bağlantı topolojisi: neyin neye bağlı olduğu. Otomatik, bakım istemez.</Then>
        <Else>Yerleşim anlam taşımaz; düzenlenemez.</Else>
      </Option>
      <Option id="SD8.B" use="Canvas" evidence="measured">
        <Then>Uzamsal anlam: konum senin verdiğin bilgidir.</Then>
        <Else>Elle bakım ister (ya da SD7.A gibi üretilir).</Else>
      </Option>
      <Option id="SD8.C" use="Excalidraw" evidence="measured">
        <Then>Serbest düşünme: eskiz, kutu, ok, el yazısı.</Then>
        <Else>Yapılandırılmış sorgulanamaz.</Else>
      </Option>
      <Option id="SD8.D" use="Slides (slides:start)" evidence="measured">
        <Then>Var olan notu sunuma çevirir.</Then>
        <Else>Ayrı bir görsel model değil; sadece görünüm.</Else>
      </Option>
      <Recommend>Soru 'ne neye bağlı' ise graph; 'bunlar nasıl konumlanıyor' ise canvas; 'henüz düşünmedim' ise Excalidraw.</Recommend>
    </Decision>
    <Decision id="SD9" question="Excalidraw komutu CLI'dan mı REST'ten mi koşulsun?">
      <Option id="SD9.A" use="obsidian command id=…" evidence="measured-sandbox">
        <Then>Terminalden tek satır; script'e uygun.</Then>
        <Else>Ön koşul sağlanmazsa sessizce etkisiz (SD4).</Else>
      </Option>
      <Option id="SD9.B" use="POST /commands/&lt;id&gt;/" evidence="doc">
        <Then>Aynı kayıt, HTTP üzerinden; uzak/otomasyon akışına uygun.</Then>
        <Else>Yine aynı ön koşul sorunu; HTTP 200 etki kanıtı değil.</Else>
        <Cost>Bearer anahtar yönetimi.</Cost>
      </Option>
      <Recommend>Yerelde CLI, otomasyonda REST — ama ikisinde de ETKİYİ ayrıca ölç.</Recommend>
    </Decision>
    <Decision id="SD10" question="Çizimlerin klasörü nerede olsun?">
      <Option id="SD10.A" use="Tek klasör (şu an: `Excalidraw`)" evidence="measured">
        <Then>Bulunması kolay; yedekleme ve dışa aktarım tek yerden.</Then>
        <Else>Çizim notundan uzaklaşır.</Else>
      </Option>
      <Option id="SD10.B" use="Notun yanında (embedUseExcalidrawFolder=false)" evidence="doc">
        <Then>Çizim gömüldüğü notun yanında durur (şu an False).</Then>
        <Else>Vault dağınıklaşır; toplu işlem zorlaşır.</Else>
      </Option>
      <Recommend>brain vault'u yeniden yazdığı için çizimler ayrı klasörde kalmalı — SD10.A.</Recommend>
    </Decision>
    <Decision id="SD11" question="Metin çizimin içinde mi dışında mı yaşasın?">
      <Option id="SD11.A" use="Excalidraw text elementi" evidence="measured-sandbox">
        <Then>Eklenti kaydettiğinde metni `## Text Elements` bölümüne `^tN` blok referanslarıyla çıkarır — ölçüldü: 3 referans. Böylece metin aranabilir olur.</Then>
        <Else>Blok referansları kaydetme sırasında yeniden üretilir; kalıcı kimlik sayma.</Else>
      </Option>
      <Option id="SD11.B" use="Markdown nota yaz, çizimi göm" evidence="doc">
        <Then>Metin tam olarak Obsidian'ın metnidir: arama, dataview, backlink.</Then>
        <Else>Görsel ve metin iki dosyaya bölünür.</Else>
      </Option>
      <Recommend>Etiket ve başlıklar çizimde; anlam ve karar markdown'da. Aranabilirlik ikisinde de korunur.</Recommend>
    </Decision>
    <Decision id="SD12" question="Öğrenme yolu: hangi SYM parçası?">
      <Option id="SD12.A" use="Excalidraw Essentials (ücretsiz)" evidence="measured">
        <Then>10 derslik mini kurs; https://community.sketch-your-mind.com/t/722 -&gt; HTTP 301.</Then>
        <Else>Derin iş akışları ve canlı oturum yok.</Else>
        <Cost>Ücretsiz.</Cost>
      </Option>
      <Option id="SD12.B" use="Excalidraw Mastery (üyelik)" evidence="unmeasurable">
        <Then>Derin eğitim + MindMap Builder; https://community.sketch-your-mind.com/t/18 -&gt; HTTP 301.</Then>
        <Cost>Ücretli — içeriği bu makineden doğrulanamaz.</Cost>
      </Option>
      <Option id="SD12.C" use="Visual Thinking Workshop" evidence="unmeasurable">
        <Then>Postcard yöntemi / Book-on-a-Page; https://community.sketch-your-mind.com/t/347 -&gt; HTTP 301.</Then>
        <Cost>Ücretli ek paket.</Cost>
      </Option>
      <Option id="SD12.D" use="Sketch Your Life" evidence="unmeasurable">
        <Then>Araçtan bağımsız düşünme araçları; https://community.sketch-your-mind.com/t/348 -&gt; HTTP 301.</Then>
        <Else>Henüz yayında değil.</Else>
        <Cost>Ücretli, tarih belirsiz.</Cost>
      </Option>
      <Recommend>Önce ücretsiz Essentials'ı bitir. Bu kılavuzdaki makine tarafı zaten kurulu olduğu için Mastery kararını Essentials sonrasına bırak.</Recommend>
    </Decision>
    <Decision id="SD13" question="Çizimler nasıl yedeklenir?">
      <Option id="SD13.A" use="Vault dosya sistemi yedeği" evidence="measured">
        <Then>Çizim ve tuval düz dosyadır; dosya yedeği yeterlidir.</Then>
      </Option>
      <Option id="SD13.B" use="obsidian-git" evidence="measured">
        <Then>Eklenti kurulu.</Then>
        <Else>Vault bir git deposu DEĞİL (test -d /Users/emrecnyngmail.com/ollamas-vault/.git -&gt; False); yani şu an hiçbir şey yapmıyor.</Else>
        <Cost>Kurulum gerektirir.</Cost>
      </Option>
      <Recommend>Şu anki gerçek: git koruması YOK. Çizimler yalnızca dosya sistemi yedeğiyle korunuyor (BlindSpot SB3).</Recommend>
    </Decision>
    <Decision id="SD14" question="Aynı anda hem sıkıştırılmış hem okunabilir istiyorum?">
      <Option id="SD14.A" use="decompressForMDView=False" evidence="doc">
        <Then>Markdown görünümünde açıldığında çizim açılır, kaydedilince tekrar sıkışır.</Then>
        <Else>Her markdown açılışında CPU maliyeti.</Else>
      </Option>
      <Option id="SD14.B" use="excalidraw-unzip-file komutu" evidence="measured-sandbox">
        <Then>Tek dosyayı kalıcı olarak açar; ölçüldü 574 B -&gt; 510 B.</Then>
        <Else>Eklenti bir sonraki kaydında compress ayarına göre geri sıkıştırabilir.</Else>
      </Option>
      <Recommend>Denetim/diff gerekiyorsa SD14.B ile o dosyayı aç; genel ayarı değiştirme.</Recommend>
    </Decision>
    <Decision id="SD15" question="OCR ile çizimdeki el yazısını aratmak">
      <Option id="SD15.A" use="Taskbone OCR" evidence="unmeasurable">
        <Then>run-ocr komutları kayıtta mevcut (taskboneEnabled=False).</Then>
        <Else>Ücretli üçüncü taraf servis; anahtar gerektirir.</Else>
        <Cost>Ücretli + veri dışarı çıkar — sovereign ilkesine aykırı.</Cost>
      </Option>
      <Option id="SD15.B" use="Metni text elementi olarak yaz" evidence="measured-sandbox">
        <Then>SD11.A ile metin zaten `## Text Elements` altında aranabilir hale gelir. $0, veri yerelde kalır.</Then>
        <Else>El yazısı aranabilir olmaz.</Else>
        <Cost>Sıfır.</Cost>
      </Option>
      <Recommend>SD15.B. Veri makineden çıkmaz; OCR sovereign kurala aykırı.</Recommend>
    </Decision>
    <Decision id="SD16" question="Çizimi ollamas brain'e nasıl tanıtırım?">
      <Option id="SD16.A" use="Çizimin yanına markdown not" evidence="code">
        <Then>brain vault'tan markdown çeker (pullVaultToBrain, server/brain-obsidian.ts:694); not indekslenir, çizim ona bağlanır.</Then>
      </Option>
      <Option id="SD16.B" use="Çizim dosyasını doğrudan beklemek" evidence="code">
        <Then>Şu an hiçbir kod .excalidraw.md okumuyor (grep -rn excalidraw server/ scripts/ -&gt; yalnızca eklenti sürüm kilidi).</Then>
        <Else>Çizim brain için görünmezdir.</Else>
      </Option>
      <Recommend>SD16.A — çizimin anlamını markdown'a yaz. SD16.B bugün çalışmıyor (BlindSpot SB2).</Recommend>
    </Decision>
    <Decision id="SD17" question="Tuvalde renk kodları nasıl seçilir?">
      <Option id="SD17.A" use="Sayısal hazır renkler (&quot;1&quot;…&quot;6&quot;)" evidence="measured">
        <Then>brain'in ürettiği tuvaller bunu kullanıyor; temayla uyumlu, ışık/karanlık modda okunur.</Then>
      </Option>
      <Option id="SD17.B" use="Hex renk" evidence="doc">
        <Then>Marka rengi tam tutturulur.</Then>
        <Else>Karanlık temada kontrast garanti değil.</Else>
      </Option>
      <Recommend>Üretilen tuvalde SD17.A; sistem kimliği gereken yerde SD17.B (brain SYSTEM_RGB bunu :483'te yapıyor).</Recommend>
    </Decision>
    <Decision id="SD18" question="Büyük sahne yavaşlarsa?">
      <Option id="SD18.A" use="renderingConcurrency (3)" evidence="doc">
        <Then>Eşzamanlı render sayısını sınırlar.</Then>
      </Option>
      <Option id="SD18.B" use="allowImageCache (True) + imageCacheRetentionDays (30)" evidence="doc">
        <Then>Görüntüler önbelleğe alınır; tekrar açılış hızlanır.</Then>
        <Else>Disk kullanımı artar.</Else>
      </Option>
      <Option id="SD18.C" use="Sahneyi böl" evidence="doc">
        <Then>Tek büyük çizim yerine bağlantılı birkaç çizim.</Then>
        <Else>Gezinme adımı artar.</Else>
      </Option>
      <Recommend>Önce SD18.C. Ayar kurcalamak semptomu erteler; kök neden tek sahnede çok eleman.</Recommend>
    </Decision>
    <Decision id="SD19" question="Çizimi Obsidian dışına çıkarmak">
      <Option id="SD19.A" use="SVG dışa aktarım" evidence="doc">
        <Then>Vektör; ölçeklenir. exportPaddingSVG=10, exportEmbedScene=False ise sahne SVG içine gömülür ve geri okunabilir.</Then>
      </Option>
      <Option id="SD19.B" use="PNG dışa aktarım" evidence="doc">
        <Then>Her yerde açılır (pngExportScale=1).</Then>
        <Else>Ölçeklenince bozulur; sahne geri alınamaz.</Else>
      </Option>
      <Recommend>Arşiv ve geri dönüş için exportEmbedScene açık SVG; sohbete yapıştırmak için PNG.</Recommend>
    </Decision>
    <Decision id="SD20" question="Kılavuz ne zaman yeniden üretilir?">
      <Option id="SD20.A" use="Her Obsidian/eklenti sürümünde" evidence="measured">
        <Then>Komut kaydı ve ayar anahtarları sürümle değişir; üretici sayıları yeniden türetir.</Then>
      </Option>
      <Option id="SD20.B" use="Elle düzenleme" evidence="doc">
        <Then>Hızlı görünür.</Then>
        <Else>Bir sonraki üretim ezer; kapı da sayıları yeniden hesapladığı için FAIL verir.</Else>
      </Option>
      <Recommend>SD20.A. Bu dosya elle düzenlenmez.</Recommend>
    </Decision>
    <Decision id="SD21" question="eCym çizim üretsin mi?">
      <Option id="SD21.A" use="eCym'e doğal dille komut" evidence="measured">
        <Then>eCym yerel modeldir ve doğal dil bekler; `ecym --help` bile GÖREV sanılır (ölçüldü: `tail -f path=/usr/local/bin/node` çalıştırmaya kalktı).</Then>
        <Else>Bayrak geçmek hatalı yürütme üretir.</Else>
        <Cost>$0 yerel.</Cost>
      </Option>
      <Option id="SD21.B" use="Deterministik üretici (bu dosyadaki Python)" evidence="measured-sandbox">
        <Then>Aynı girdi aynı sahneyi üretir; kapıdan geçer.</Then>
        <Else>Yaratıcı çeşitlilik yok.</Else>
        <Cost>Sıfır.</Cost>
      </Option>
      <Recommend>Şema üretimi SD21.B ile deterministik olsun; eCym'i içerik/etiket önerisi için doğal dille kullan, asla bayrakla.</Recommend>
    </Decision>
    <Decision id="SD22" question="odysseus çizim yüzeyine nasıl bağlanır?">
      <Option id="SD22.A" use="Khoj arayüzü :7860" evidence="measured">
        <Then>HTTP 000. Arka uç ayrı porttadır: :42110 -&gt; 200.</Then>
        <Else>Boot ~210 s sürer; tek ölçümle 'kapalı' demek yanlış (bu oturumda 000 -&gt; 200 geçişi gözlendi). İki portu ayrı ayrı ölç.</Else>
      </Option>
      <Option id="SD22.B" use="ODY-PULSE :4777" evidence="measured">
        <Then>HTTP 200; servis sağlığı buradan okunur.</Then>
        <Else>Çizim üretmez, yalnızca durum gösterir.</Else>
      </Option>
      <Recommend>Durumu SD22.B'den izle, iki Khoj portunu ayrı ölç. Ama servis ayakta olsa bile odysseus'un okuyacağı çizim üreticisi yok — asıl engel SB2, servis değil.</Recommend>
    </Decision>
  </DecisionMatrix>

  <Phase id="1" name="Ortam — çizim yüzeyi gerçekten var mı">
    <Step id="1.1" action="probe" evidence="measured">
      <Cmd>obsidian version</Cmd>
      <Expect>1.12.7 (installer 1.12.7) (Excalidraw minAppVersion 1.8.7 bunun altında)</Expect>
    </Step>
    <Step id="1.2" action="probe" evidence="measured">
      <Cmd>jq -r '.version' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json</Cmd>
      <Expect>2.25.3</Expect>
    </Step>
    <Step id="1.3" action="probe" evidence="measured">
      <Cmd>jq '.canvas, .graph, .slides' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/core-plugins.json</Cmd>
      <Expect>True True True — üçü de açık olmalı</Expect>
    </Step>
    <Step id="1.4" action="probe" evidence="measured">
      <Desc>Komut envanterinin TEK doğru kaynağı budur. main.js grep'i minified kodda yanıltır.</Desc>
      <Cmd>curl -s --cacert $CACHE/obs-ca.pem -H &quot;Authorization: Bearer $KEY&quot; https://127.0.0.1:27124/commands/ | jq '.commands|length'</Cmd>
      <Expect>367 komut; bunların 77 tanesi çizim yüzeyi</Expect>
    </Step>
    <Step id="1.5" action="probe" evidence="measured">
      <Cmd>jq 'keys|length' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/data.json</Cmd>
      <Expect>177 ayar anahtarı</Expect>
    </Step>
  </Phase>
  <Phase id="2" name="Yardım yüzeyi — resmi çizim dokümanı">
    <Step id="2.1" action="read" evidence="doc">
      <Desc>JSON Canvas biçimi ve tuval kullanımı.</Desc>
      <Expect>Canvas sayfası; node/edge modeli</Expect>
      <Source url="https://obsidian.md/help/plugins/canvas"/>
    </Step>
    <Step id="2.2" action="read" evidence="doc">
      <Desc>Graph view: bağlantı topolojisi.</Desc>
      <Source url="https://obsidian.md/help/plugins/graph"/>
    </Step>
    <Step id="2.3" action="read" evidence="doc">
      <Desc>Slides: notu sunuma çevirme.</Desc>
      <Source url="https://obsidian.md/help/plugins/slides"/>
    </Step>
    <Step id="2.4" action="read" evidence="doc">
      <Desc>Ek dosya (görsel) yönetimi ve klasörü.</Desc>
      <Source url="https://obsidian.md/help/attachments"/>
    </Step>
    <Step id="2.5" action="read" evidence="doc">
      <Desc>Gömme sözdizimi — çizimi nota ![[ ]] ile almak.</Desc>
      <Source url="https://obsidian.md/help/embeds"/>
    </Step>
    <Step id="2.6" action="read" evidence="doc">
      <Desc>Web sayfası gömme; Excalidraw embeddable öğesiyle karışır.</Desc>
      <Source url="https://obsidian.md/help/embed-web-pages"/>
    </Step>
    <Step id="2.7" action="note" evidence="code">
      <Desc>Excalidraw resmi Obsidian yardımında YOKTUR — topluluk eklentisidir. Doğru kaynak: https://github.com/zsviczian/obsidian-excalidraw-plugin#readme ve https://community.sketch-your-mind.com .</Desc>
      <Expect>Yardım sitemap'inde excalidraw geçmez (S2 bunu doğrular)</Expect>
    </Step>
  </Phase>
  <Phase id="3" name="Canvas — makinenin ürettiği uzamsal harita">
    <Step id="3.1" action="read" evidence="code">
      <Desc>entity-map.canvas üreticisi: writeEntityMapCanvas(), server/brain-obsidian.ts:320-346.</Desc>
      <Cmd>grep -n 'entity-map.canvas' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts</Cmd>
      <Expect>346: writeFileSync(join(vault, &quot;entity-map.canvas&quot;), …)</Expect>
    </Step>
    <Step id="3.2" action="read" evidence="code">
      <Desc>orchestra.canvas üreticisi: writeOrchestra(), aynı dosya :488-577.</Desc>
      <Cmd>grep -n 'orchestra.canvas' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts</Cmd>
      <Expect>577: writeFileSync(join(vault, &quot;orchestra.canvas&quot;), …)</Expect>
    </Step>
    <Step id="3.3" action="verify" evidence="measured">
      <Cmd>python3 -c &quot;import json;[print(f,len(json.load(open(f))['nodes'])) for f in ['/Users/emrecnyngmail.com/ollamas-vault/entity-map.canvas','/Users/emrecnyngmail.com/ollamas-vault/orchestra.canvas']]&quot;</Cmd>
      <Expect>iki dosya da geçerli JSON, node listesi dolu</Expect>
      <Affects>Bozuk JSON tuvali sessizce boş açar — S5 bunu kapıya bağlar.</Affects>
    </Step>
    <Step id="3.4" action="warn" evidence="code">
      <Desc>Bu iki dosya 300 s'de bir yeniden yazılır (com.ollamas.brain-obsidian-sync). Elle düzenleme kaybolur.</Desc>
      <Cmd>launchctl list | grep com.ollamas.brain-obsidian-sync</Cmd>
      <Expect>yüklü ve çalışıyor</Expect>
    </Step>
    <Step id="3.5" action="recover" evidence="measured">
      <Desc>Türetilmiş tuval silinirse beklemeye gerek yok; senkron elle tetiklenir.</Desc>
      <Cmd>curl -s -X POST http://127.0.0.1:3000/api/brain/obsidian/sync -H 'content-type: application/json' -d '{&quot;direction&quot;:&quot;push&quot;}'</Cmd>
      <Expect>orchestra.canvas 9 node / 11 kenar ile geri gelir (ölçüldü: silindi, geri getirildi)</Expect>
      <Affects>Bu yalnızca brain'in ÜRETTİĞİ dosyalar için geçerli. İnsan tuvalinin yedeği yok (BlindSpot SB3).</Affects>
    </Step>
    <Step id="3.6" action="do" evidence="measured-sandbox">
      <Cmd>obsidian command id=canvas:new-file</Cmd>
      <Expect>vault kökünde yeni tuval: obsidian command id=canvas:new-file -&gt; yeni dosya ['Başlıksız.canvas']</Expect>
      <Affects>Dosya adı ARAYÜZ DİLİNDE üretilir — 'Untitled.canvas' varsayan script kırılır.</Affects>
    </Step>
  </Phase>
  <Phase id="4" name="Excalidraw — kurulum durumu ve davranışı belirleyen ayarlar">
    <Step id="4.1" action="probe" evidence="measured">
      <Cmd>jq -r '.{compress,decompressForMDView,autosave,folder}' /Users/emrecnyngmail.com/ollamas-vault/.obsidian/plugins/obsidian-excalidraw-plugin/data.json</Cmd>
      <Expect>compress=True; decompressForMDView=False; autosave=True; folder=Excalidraw</Expect>
    </Step>
    <Step id="4.2" action="note" evidence="measured">
      <Desc>177 ayarın tamamı bu kılavuzda gruplandı; grupların anlamı Inventory/ExcalidrawSettings altında. Gruplanmamış anahtar üreticiyi öldürür.</Desc>
      <Expect>S9 sayıyı yeniden hesaplar</Expect>
    </Step>
    <Step id="4.3" action="warn" evidence="doc">
      <Desc>Ayar dosyası çalışan Obsidian tarafından tutulur. data.json'u elle düzenlersen uygulama üzerine yazar; ayarı arayüzden ya da eklenti API'sinden değiştir.</Desc>
      <Affects>Elle düzenlenen ayar sessizce geri alınır.</Affects>
    </Step>
  </Phase>
  <Phase id="5" name="Salt-okuma komut yüzeyi">
    <Step id="5.1" action="list" evidence="measured">
      <Cmd>curl -s … /commands/ | jq -r '.commands[].id' | grep -E '^(obsidian-excalidraw-plugin|canvas|graph|slides):'</Cmd>
      <Expect>77 komut: obsidian-excalidraw-plugin=69, canvas=4, graph=3, slides=1</Expect>
    </Step>
    <Step id="5.2" action="note" evidence="code">
      <Desc>Risk sınıfları: readonly=6, ui=25, mutating=39, destructive=1, dev=3, paid=3</Desc>
      <Expect>toplam 77</Expect>
    </Step>
    <Step id="5.3" action="do" evidence="measured">
      <Cmd>obsidian command id=graph:open</Cmd>
      <Expect>Grafik görünümü açılır — yan etkisiz görsel yüzey</Expect>
    </Step>
  </Phase>
  <Phase id="6" name="Yazan komut yüzeyi — _sandbox/ içinde ÖLÇÜLDÜ">
    <Step id="6.1" action="guard" evidence="measured">
      <Cmd>shasum -a 256 '/Users/emrecnyngmail.com/ollamas-vault/Excalidraw/Drawing 2026-07-22 15.43.21.excalidraw.md'</Cmd>
      <Expect>Emre'nin çizimi sha256 0d7199b7298b… -&gt; 0d7199b7298b…</Expect>
      <Affects>Emre'nin çizimleri test verisi DEĞİLDİR. Ölçüm öncesi/sonrası hash tutmalı.</Affects>
    </Step>
    <Step id="6.2" action="do" evidence="measured-sandbox">
      <Cmd>curl -X PUT --data-binary @probe.canvas https://127.0.0.1:27124/vault/_sandbox/sketch-probe.canvas</Cmd>
      <Expect>PUT /vault/_sandbox/sketch-probe.canvas -&gt; 204</Expect>
    </Step>
    <Step id="6.3" action="verify" evidence="measured-sandbox">
      <Cmd>curl https://127.0.0.1:27124/vault/_sandbox/sketch-probe.canvas | jq '.nodes|length, .edges|length'</Cmd>
      <Expect>GET -&gt; 200, nodes=2 edges=1</Expect>
    </Step>
    <Step id="6.4" action="cleanup" evidence="measured-sandbox">
      <Cmd>obsidian open path=&lt;yol&gt; &amp;&amp; obsidian command id=workspace:close &amp;&amp; curl -X DELETE https://127.0.0.1:27124/vault/&lt;yol&gt;  # sonra iki kez doğrula</Cmd>
      <Expect>purge() sonrası kalan: yok · _sandbox/ kaldı mı -&gt; False</Expect>
      <Affects>Üç şart birden gerekli: (a) silme API üzerinden — diskten unlink edilen açık dosya geri yazılır, (b) kapatılan sekme SİLİNECEK dosyanınki olmalı — kör workspace:close aktif olanı kapatır, (c) yokluk iki ayrı pencerede doğrulanmalı — geri yazma gecikmeli gelir. Üçünden biri eksikse temizlik yalan söyler (SB5).</Affects>
    </Step>
  </Phase>
  <Phase id="7" name="Makine üretimi JSON Canvas">
    <Step id="7.1" action="code" evidence="measured-sandbox">
      <Desc>Tuval şeması: nodes[] (id,type,text|file,x,y,width,height,color) + edges[] (id,fromNode,fromSide,toNode,toSide). Eklenti gerekmez, çekirdek okur.</Desc>
      <Source url="https://obsidian.md/help/plugins/canvas"/>
    </Step>
    <Step id="7.2" action="do" evidence="measured-sandbox">
      <Cmd>REST PUT ile yaz -&gt; GET ile geri oku -&gt; node/edge say</Cmd>
      <Expect>GET -&gt; 200, nodes=2 edges=1</Expect>
    </Step>
    <Step id="7.3" action="warn" evidence="measured-sandbox">
      <Desc>Diske doğrudan yazma indeks yarışı yaratır.</Desc>
      <Cmd>cp x.canvas $VAULT/ &amp;&amp; obsidian open path=x.canvas</Cmd>
      <Expect>Error: File &quot;x.canvas&quot; not found. — Obsidian henüz indekslemedi</Expect>
    </Step>
  </Phase>
  <Phase id="8" name="Makine üretimi Excalidraw sahnesi — tam döngü">
    <Step id="8.1" action="code" evidence="measured-sandbox">
      <Desc>Dosya = frontmatter (excalidraw-plugin: parsed) + '## Drawing' + ```json bloğu. Eklenti hem düz json hem compressed-json okur; makine DÜZ yazar (SD2).</Desc>
    </Step>
    <Step id="8.2" action="do" evidence="measured-sandbox">
      <Cmd>curl -X PUT --data-binary @gen.excalidraw.md .../vault/_sandbox/gen-probe.excalidraw.md</Cmd>
      <Expect>PUT gen-probe.excalidraw.md (3505 B) -&gt; 204</Expect>
    </Step>
    <Step id="8.3" action="do" evidence="measured-sandbox">
      <Cmd>obsidian open path=_sandbox/gen-probe.excalidraw.md</Cmd>
      <Expect>obsidian open -&gt; 'Opened: _sandbox/gen-probe.excalidraw.md'</Expect>
    </Step>
    <Step id="8.4" action="verify" evidence="measured-sandbox">
      <Cmd>curl -H 'Accept: application/vnd.olrapi.note+json' https://127.0.0.1:27124/active/ | jq -r .path</Cmd>
      <Expect>GET /active/ -&gt; _sandbox/gen-probe.excalidraw.md</Expect>
      <Affects>Aktif dosya doğrulanmadan komut göndermek sessiz no-op üretir.</Affects>
    </Step>
    <Step id="8.5" action="do" evidence="measured-sandbox">
      <Cmd>obsidian command id=obsidian-excalidraw-plugin:toggle-excalidraw-view</Cmd>
      <Expect>-&gt; 'Executed: obsidian-excalidraw-plugin:toggle-excalidraw-view'</Expect>
      <Affects>ZORUNLU köprü. Bu adım olmadan sonraki komut hiçbir şey yapmaz.</Affects>
    </Step>
    <Step id="8.6" action="do" evidence="measured-sandbox">
      <Cmd>obsidian command id=obsidian-excalidraw-plugin:save</Cmd>
      <Expect>-&gt; 'Executed: obsidian-excalidraw-plugin:save'</Expect>
    </Step>
    <Step id="8.7" action="verify" evidence="measured-sandbox">
      <Cmd>grep -c '## Text Elements' _sandbox/gen-probe.excalidraw.md</Cmd>
      <Expect>'## Text Elements' + 3 sistem adı dosyada, 3535 B</Expect>
      <Affects>ASIL KANIT: eklenti bizim yazdığımız text elementlerini kendi bölümüne çıkardı — yani makine sahnesini gerçekten ayrıştırdı, sadece dosyayı taşımadık.</Affects>
    </Step>
    <Step id="8.8" action="cleanup" evidence="measured-sandbox">
      <Cmd>REST DELETE + rmdir _sandbox</Cmd>
      <Expect>_sandbox/ kaldı mı -&gt; False</Expect>
    </Step>
  </Phase>
  <Phase id="9" name="Dışa aktarım ve gömme">
    <Step id="9.1" action="note" evidence="doc">
      <Desc>autoexportSVG=False, autoexportPNG=False, autoExportLightAndDark=False. Kapalıysa dışa aktarım eldedir.</Desc>
    </Step>
    <Step id="9.2" action="do" evidence="doc">
      <Cmd>obsidian command id=obsidian-excalidraw-plugin:export-image</Cmd>
      <Expect>dışa aktarım diyaloğu — insan etkileşimi ister, başsız koşmaz</Expect>
    </Step>
    <Step id="9.3" action="do" evidence="doc">
      <Cmd>obsidian command id=obsidian-excalidraw-plugin:excalidraw-publish-svg-check</Cmd>
      <Expect>bayatlamış SVG/PNG dışa aktarımlarını listeler</Expect>
      <Affects>İki-kaynak-doğru sorununun tek denetim aracı.</Affects>
    </Step>
    <Step id="9.4" action="note" evidence="doc">
      <Desc>Tuvali görüntü olarak dışa aktar.</Desc>
      <Cmd>obsidian command id=canvas:export-as-image</Cmd>
    </Step>
  </Phase>
  <Phase id="10" name="ollamas E2E — brain ile çizim yüzeyi">
    <Step id="10.1" action="probe" evidence="measured">
      <Cmd>curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/</Cmd>
      <Expect>200</Expect>
    </Step>
    <Step id="10.2" action="read" evidence="code">
      <Desc>brain vault'a iki tuval + Home.md görsel harita bağlantıları yazar (server/brain-obsidian.ts:272, :529).</Desc>
      <Cmd>grep -n 'Görsel haritalar' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts</Cmd>
    </Step>
    <Step id="10.3" action="verify" evidence="measured">
      <Cmd>grep -c 'canvas' /Users/emrecnyngmail.com/ollamas-vault/Home.md</Cmd>
      <Expect>Home.md tuvallere bağlanıyor</Expect>
    </Step>
    <Step id="10.4" action="gap" evidence="code">
      <Desc>brain HİÇBİR .excalidraw.md üretmiyor ya da okumuyor.</Desc>
      <Cmd>grep -rn excalidraw ~/Desktop/ollamas-obsidian-guide-wt/server ~/Desktop/ollamas-obsidian-guide-wt/scripts</Cmd>
      <Expect>yalnızca obsidian-plugins.ts:73 sürüm kilidi — üretici/tüketici yok (BlindSpot SB2)</Expect>
    </Step>
  </Phase>
  <Phase id="11" name="eCym E2E">
    <Step id="11.1" action="probe" evidence="measured">
      <Cmd>command -v ecym</Cmd>
      <Expect>/Users/emrecnyngmail.com/.local/bin/ecym</Expect>
    </Step>
    <Step id="11.2" action="warn" evidence="measured">
      <Cmd>ecym --help</Cmd>
      <Expect>bayrak GÖREV sanılır; `tail -f path=…` çalıştırmaya kalkar</Expect>
      <Affects>eCym doğal dil bekler. Ona bayrak geçme.</Affects>
    </Step>
    <Step id="11.3" action="do" evidence="doc">
      <Cmd>ecym &quot;ollamas orkestra tuvali için üç kutu etiketi öner&quot;</Cmd>
      <Expect>$0 yerel model, metin önerisi; dosyayı SEN yazarsın (SD21)</Expect>
    </Step>
  </Phase>
  <Phase id="12" name="odysseus E2E">
    <Step id="12.1" action="probe" evidence="measured">
      <Cmd>curl -o /dev/null -w '%{http_code}' http://127.0.0.1:7860/</Cmd>
      <Expect>000 (Khoj arayüzü)</Expect>
      <Affects>Boot ~210 s. Bu üretim oturumunun başında 000, sonunda 200 verdi — tek ölçüm servisi kapalı ilan etmeye yetmez.</Affects>
    </Step>
    <Step id="12.2" action="probe" evidence="measured">
      <Cmd>curl -o /dev/null -w '%{http_code}' http://127.0.0.1:42110/</Cmd>
      <Expect>200 (Khoj arka ucu — arayüzden BAĞIMSIZ port)</Expect>
    </Step>
    <Step id="12.3" action="probe" evidence="measured">
      <Cmd>curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4777/</Cmd>
      <Expect>200 — ODY-PULSE</Expect>
    </Step>
    <Step id="12.4" action="gap" evidence="measured">
      <Desc>Servis ayakta olsa bile odysseus çizim yüzeyine katılmıyor: okuyacağı bir çizim üreticisi yok (SB2 ile aynı kök). Asıl engel port değil, üretici.</Desc>
      <Affects>BlindSpot SB4</Affects>
    </Step>
  </Phase>

  <!-- Bu bolum uretim sirasinda gercekten kosuldu. Kosmadiysa ran=false olur. -->
  <SandboxRun ran="true" passed="13" total="13" path="_sandbox/">
    <Check name="canvas-put" ok="true" detail="PUT /vault/_sandbox/sketch-probe.canvas -&gt; 204"/>
    <Check name="canvas-roundtrip" ok="true" detail="GET -&gt; 200, nodes=2 edges=1"/>
    <Check name="excalidraw-put" ok="true" detail="PUT gen-probe.excalidraw.md (3505 B) -&gt; 204"/>
    <Check name="excalidraw-open" ok="true" detail="obsidian open -&gt; 'Opened: _sandbox/gen-probe.excalidraw.md'"/>
    <Check name="active-file" ok="true" detail="GET /active/ -&gt; _sandbox/gen-probe.excalidraw.md"/>
    <Check name="toggle-view" ok="true" detail="-&gt; 'Executed: obsidian-excalidraw-plugin:toggle-excalidraw-view'"/>
    <Check name="save" ok="true" detail="-&gt; 'Executed: obsidian-excalidraw-plugin:save'"/>
    <Check name="plugin-parsed-machine-scene" ok="true" detail="'## Text Elements' + 3 sistem adı dosyada, 3535 B"/>
    <Check name="canvas-new-file" ok="true" detail="obsidian command id=canvas:new-file -&gt; yeni dosya ['Başlıksız.canvas']"/>
    <Check name="canvas-purged" ok="true" detail="purge() sonrası kalan: yok"/>
    <Check name="no-stray-canvas" ok="true" detail="vault genelinde artık tuval (attic dahil): yok"/>
    <Check name="sandbox-clean" ok="true" detail="_sandbox/ kaldı mı -&gt; False"/>
    <Check name="original-untouched" ok="true" detail="Emre'nin çizimi sha256 0d7199b7298b… -&gt; 0d7199b7298b…"/>
  </SandboxRun>

  <!-- Makine sozlesmesi. Dekoratif degil: S8 bunu semaya karsi dogrular. -->
  <JsonPrompt>
    <Contract><![CDATA[
      {
        "task": "generate-sketch",
        "surface": {
          "canvas": "core",
          "excalidraw": "2.25.3"
        },
        "write": {
          "via": "rest",
          "endpoint": "PUT https://127.0.0.1:27124/vault/<path>",
          "neverWriteToDiskDirectly": true
        },
        "excalidraw": {
          "format": "plain-json",
          "frontmatter": "excalidraw-plugin: parsed",
          "section": "## Drawing",
          "letPluginCompress": true
        },
        "activate": [
          "obsidian open path=<path>",
          "obsidian command id=obsidian-excalidraw-plugin:toggle-excalidraw-view",
          "obsidian command id=obsidian-excalidraw-plugin:save"
        ],
        "proof": {
          "notAcceptable": "Executed: <command-id>",
          "acceptable": "## Text Elements bölümü + bayt farkı"
        },
        "cleanup": {
          "via": "DELETE /vault/<path>",
          "reason": "unlink edilen açık dosya geri yazılır"
        }
      }
    ]]></Contract>
  </JsonPrompt>

  <BlindSpots>
    <Spot id="SB1" severity="high" status="çözüldü">
      <Title>CLI 'Executed:' yazar ama komut hiç koşmamış olabilir</Title>
      <Evidence>obsidian command id=…:excalidraw-unzip-file -&gt; 'Executed: …' yazdı, dosya 574 B'de kaldı ve compressed-json sayısı 1 olarak sürdü. Aynı komut toggle-excalidraw-view'dan sonra 510 B / 0 verdi. Pozitif kontrol: canvas:new-file görünüm gerektirmediği için tek başına dosya yarattı.</Evidence>
      <Impact>Otomasyon başarılı sanıp ilerler; sessiz veri kaybı.</Impact>
      <Fix>Her komuttan sonra gözlemlenebilir bir değişim ölç (bayt, satır, dosya sayısı). Excalidraw komutlarından önce toggle-excalidraw-view çağır.</Fix>
      <Verify>Faz 8.5-8.7</Verify>
    </Spot>
    <Spot id="SB2" severity="medium" status="açık">
      <Title>Üç sistemin hiçbiri .excalidraw.md üretmiyor ya da okumuyor</Title>
      <Evidence>grep -rn excalidraw server/ scripts/ src/ -&gt; tek eşleşme scripts/obsidian-plugins.ts:73 (sürüm kilidi 2.25.3). brain yalnızca .canvas yazıyor (brain-obsidian.ts:346, :577).</Evidence>
      <Impact>Çizimler brain için görünmez; arama ve federasyon dışında kalır.</Impact>
      <Fix>Ya çizimin yanına markdown not yaz (SD16.A), ya da bu kılavuzdaki Faz 8 döngüsünü bir üreticiye bağla.</Fix>
      <Next>Faz 8 kanıtlanmış üretim yolu; kod yazma kararı Emre'de.</Next>
    </Spot>
    <Spot id="SB3" severity="medium" status="açık">
      <Title>Vault git koruması altında değil — çizim kaybı geri alınamaz</Title>
      <Evidence>test -d /Users/emrecnyngmail.com/ollamas-vault/.git -&gt; False; obsidian-git eklentisi community-plugins.json içinde kurulu ama plugins/obsidian-git/data.json yok, yani hiç yapılandırılmamış.</Evidence>
      <Impact>Yanlış bir 'Convert to file' ya da senkron ezmesi geri alınamaz.</Impact>
      <Fix>git init + obsidian-git yapılandırması, ya da dosya sistemi yedeğini doğrula.</Fix>
      <Next>Emre kararı — kurulum vault'u değiştirir, bu kılavuz değiştirmez.</Next>
    </Spot>
    <Spot id="SB4" severity="medium" status="açık">
      <Title>odysseus çizim yüzeyine katılmıyor — servis durumu ölçüme bağlı</Title>
      <Evidence>Khoj arayüzü :7860 -&gt; 000, Khoj arka ucu :42110 -&gt; 200, ODY-PULSE :4777 -&gt; 200. Bu üretim oturumunun başında :7860 000 verirken sonunda 200 verdi — boot süresi ~210 s, yani tek ölçüm servisi 'kapalı' ilan etmeye yetmez.</Evidence>
      <Impact>Servis ayakta olsa bile odysseus'un okuyacağı bir çizim üreticisi yok (SB2 ile aynı kök); federasyonun çizim ayağı boş.</Impact>
      <Fix>Önce SB2 kapanmalı. Servis durumu tek başına yeterli değil.</Fix>
      <Verify>Faz 12.1 ve 12.2</Verify>
    </Spot>
    <Spot id="SB5" severity="medium" status="çözüldü">
      <Title>Açık sekmedeki dosyayı silmek kopya ÜRETİR, silmez</Title>
      <Evidence>Üç ölçüm gerekti. (1) `rm` ile silinen tuval 3 s sonra geri geldi. (2) Sekme kapatılmadan REST DELETE: kökte `Başlıksız 1..5.canvas` — açık görünüm dosya her kaybolduğunda kendini numaralı yeni adla kaydediyor. (3) Kör `workspace:close` -&gt; DELETE de yetmedi: close AKTİF sekmeyi kapatır, silinecek dosyanınkini değil; silme hemen sonra 'temiz' ölçüldü ama dosya saniyeler sonra geri geldi. Çalışan sıra: `obsidian open &lt;yol&gt;` -&gt; `workspace:close` -&gt; DELETE -&gt; iki ayrı bekleme penceresinde yokluğu doğrula. İki ardışık üretim koşusu 0 artık verdi (25 s ve 15 s izlendi).</Evidence>
      <Impact>Temizlik yaptığını sanan script vault'u çoğaltarak kirletir. Üstelik artık KÖKTE GÖRÜNMEZ: brain'in sweepEmptyShells() fonksiyonu boş kabukları `_index/attic/` altına süpürüyor, yani kökü sayan bir kontrol temiz raporlar. Altı artık dosya tam olarak orada bulundu.</Impact>
      <Fix>Dosyayı ÖNCE aktif yap (`obsidian open`), O sekmeyi kapat, sonra DELETE /vault/&lt;path&gt;, sonra iki ayrı pencerede yokluğunu doğrula — tek kontrol yanıltır. Artık taraması kökü değil TÜM vault'u gezmeli (attic dahil).</Fix>
      <Verify>Faz 6.4, SandboxRun/canvas-purged ve /no-stray-canvas</Verify>
    </Spot>
    <Spot id="SB6" severity="low" status="çözüldü">
      <Title>Yeni tuval dosya adı arayüz dilinde üretiliyor</Title>
      <Evidence>canvas:new-file -&gt; Başlıksız.canvas ('Untitled.canvas' değil).</Evidence>
      <Impact>Sabit ada bakan otomasyon sessizce hiçbir şey bulamaz.</Impact>
      <Fix>Komut öncesi/sonrası dizin farkı al; ada güvenme.</Fix>
      <Verify>Faz 3.6</Verify>
    </Spot>
    <Spot id="SB7" severity="informational" status="açık">
      <Title>Ücretli SYM içeriği bu makineden doğrulanamaz</Title>
      <Evidence>Konu sayfaları canlı (S3 HTTP kodlarını ölçer) ama içerik üyelik arkasında. Ders sayısı ve müfredat iddiası ölçülmedi.</Evidence>
      <Impact>Kılavuz ücretli içerik hakkında yalnızca sayfa varlığını iddia eder.</Impact>
      <Fix>İddia edilmiyor — evidence='unmeasurable' olarak işaretli.</Fix>
    </Spot>
  </BlindSpots>

  <Gates>
    <Gate id="S1" name="xmllint" cmd="xmllint --noout &lt;bu dosyadaki xml bloğu&gt;" why="Ayrıştırılamayan XML kılavuz değil, metindir."/>
    <Gate id="S2" name="sitemap üyeliği" cmd="her obsidian.md/help Source url'i sitemap'in canlı listesinde aranır" why="help.obsidian.md bir SPA: uydurma yola da 200 döner, HTTP durumu kanıt değildir."/>
    <Gate id="S3" name="SYM canlılığı" cmd="her https://community.sketch-your-mind.com/t/&lt;id&gt; için HTTP kodu; 200/301 geçer, 404 düşer" why="Bu host SPA DEĞİL: uydurulmuş konu id'si 404 verir, yani kapı gerçekten düşebilir."/>
    <Gate id="S4" name="envanter yeniden türetme" cmd="komut sayısı canlı /commands/ kaydından, ayar sayısı data.json'dan yeniden hesaplanır" why="Belgedeki sayı ile gerçeğin sapması FAIL'dir, bayat belge değil."/>
    <Gate id="S5" name="canvas JSON geçerliliği" cmd="her *.canvas parse edilir; node/edge id'leri benzersiz olmalı" why="Bozuk tuval sessizce boş açılır."/>
    <Gate id="S6" name="excalidraw dosya bütünlüğü" cmd="her *.excalidraw.md için frontmatter 'excalidraw-plugin' + Drawing bloğu aranır"/>
    <Gate id="S7" name="REST smoke" cmd="GET /vault/ pinlenmiş sertifika ile, -k YOK"/>
    <Gate id="S8" name="JSON şema + id benzersizliği" cmd="XML -&gt; JSON indirgenir, obsidian-sketch.schema.json ile doğrulanır; ayrıca grup/komut toplamları ve tüm id'lerin benzersizliği yeniden hesaplanır" why="JsonPrompt düğümü dekoratif değil; koşuluyor. Yinelenen id şemaya görünmez ama 'verify: Faz 3.5' gibi her çapraz atıfı zehirler — gerçek bir çakışma S1 ve şemadan geçti."/>
    <Gate id="S9" name="kapsam" cmd="77 komutun ve 177 ayarın TAMAMI sınıflı olmalı"/>
    <Gate id="S10" name="devir" cmd="çizim sayfaları + obsidian.md v3.0 sayfaları = sitemap toplamı, örtüşme 0" why="İki kılavuz arasında ne boşluk ne çift kayıt kalır."/>
    <Gate id="S11" name="sandbox artığı" cmd="/Users/emrecnyngmail.com/ollamas-vault/_sandbox yok; Emre'nin çizimi sha256 değişmemiş"/>
    <Gate id="S12" name="kapının kendi dişi" cmd="bozuk bir KOPYA üretilir; S1/S3/S5/S8 onu reddetmek ZORUNDA" why="Başarısız olamayan kapı hiçbir şey kanıtlamaz."/>
  </Gates>

  <Delivery>
    <Repo path="~/Desktop/ollamas-obsidian-guide-wt" branch="feat/obsidian-guide-v2"/>
    <Note>~/Desktop bir git deposu degildir; dosyalar depoya aynalanip oradan gonderilir.</Note>
    <Commit message="docs(obsidian): add sketch surface guide (canvas + excalidraw + SYM), gates S1-S12"/>
  </Delivery>
</ObsidianSketchGuide>
```

