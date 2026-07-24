# Kaynaklar — Help sitesinin referans aldığı sayfalar

> Bu liste **kalıcıdır**. Site bu sayfaların *bilgi mimarisi* (IA) üzerine kurulur; **metni asla kopyalanmaz** (telif + bayatlama). Her özellik, onu gerektiren kaynağa geri işaret eder.

## Referanslar

| # | Kaynak | Arketip | Rol |
|---|--------|---------|-----|
| 1 | [Obsidian Help](https://obsidian.md/help/) | docs | Görsel + yapısal ana referans — bir Obsidian Publish vault'u; hedeflenen bilgi mimarisi (hub → bölüm → sayfa → graph) birebir budur. |
| 2 | [Claude Code Docs — Quickstart](https://code.claude.com/docs/en/quickstart) | docs | En güçlü docs-site şablonu — kenar-çubuğu+TOC+arama+numaralı quickstart; sayfa tipleri (tablo, callout, sekmeli kod) buradan alınır. |
| 3 | [Claude Support Center](https://support.claude.com/en/) | bilgi-tabanı | Arama-öncelikli bilgi tabanı — açılış kart-ızgarası deseni (koleksiyon → makale) buradan alınır. |
| 4 | [Claude Code — Ürün Sayfası](https://claude.com/product/claude-code) | pazarlama | Pazarlama/açılış kabuğu — hero + dikey anlatı + FAQ + footer; docs'un üstünde duran karşılama katmanı. |
| 5 | [Anthropic](https://www.anthropic.com/) | pazarlama | Üst-huni pazarlama kabuğu — sticky üst-nav + hero + büyük gruplu footer; docs/support bunun altına asılır. |

## Her kaynaktan öğrenilen bilgi mimarisi

### Obsidian Help
<https://obsidian.md/help/> · **arketip:** docs

- **Gözlenen bölümler:** Get started · Extend Obsidian · Add-on services · Contribute
- sol kenar-çubuğu: klasör/dosya navigasyon ağacı
- sağ pane: sayfanın başlık taslağı (on-this-page TOC)
- kenar-çubuğu üstünde arama kutusu
- graph görünümü + dark/light tema anahtarı
- başlangıç→ileri sıralama (kur → çekirdek → eklenti → geliştirici)

### Claude Code Docs — Quickstart
<https://code.claude.com/docs/en/quickstart> · **arketip:** docs

- **Gözlenen bölümler:** Getting Started · Guides · Reference · Troubleshooting
- kalıcı sol kenar-çubuğu: bölüm grupları
- sağ 'On this page' TOC
- arama + /docs/llms.txt makine indeksi
- numaralı Step 1…N quickstart akışı
- kopya-butonlu, dile-göre-renkli kod blokları
- callout bileşenleri: Note / Tip / Info
- Komut / Ne yapar / Örnek tablosu
- sayfa altı 'What's next' kart-ızgarası (prev/next)

### Claude Support Center
<https://support.claude.com/en/> · **arketip:** bilgi-tabanı

- **Gözlenen bölümler:** Claude Code · Claude API · Pro and Max plans · Privacy and legal
- üst çubukta ortalanmış büyük arama
- ikon + makale-sayılı koleksiyon kart-ızgarası
- koleksiyon → makale navigasyon modeli
- sıralı okuma değil, arama-öncelikli erişim

### Claude Code — Ürün Sayfası
<https://claude.com/product/claude-code> · **arketip:** pazarlama

- **Gözlenen bölümler:** Hero · Integrations · Pricing · FAQ · Resources
- hero başlık + CTA
- dikey anlatı bölümleri (özellik → kanıt → fiyat)
- tek gösterim amaçlı renkli kod parçacığı
- sayfa sonunda FAQ
- çok-sütunlu footer

### Anthropic
<https://www.anthropic.com/> · **arketip:** pazarlama

- **Gözlenen bölümler:** Research · Products · Company · Help & Security
- sticky üst navigasyon + 'skip to content' çapası
- hero + sürüm/girişim kartları
- 8-gruplu büyük footer (~80 link)
- responsive (mobil/masaüstü nav ikizi)

## Hedef özellik sözleşmesi (kodlanmış site bunu karşılamalı)

| # | Özellik | Kaynak |
|---|---------|--------|
| 1 | Kalıcı sol kenar-çubuğu navigasyonu (aktif sayfa vurgulu) | <https://obsidian.md/help/> <https://code.claude.com/docs/en/quickstart> |
| 2 | Sağ 'bu sayfada' TOC (H2/H3'ten, scroll-spy) | <https://obsidian.md/help/> <https://code.claude.com/docs/en/quickstart> |
| 3 | İstemci-taraflı arama ('/' ile odak, sunucusuz) | <https://code.claude.com/docs/en/quickstart> <https://support.claude.com/en/> |
| 4 | Başlangıç→ileri IA (Başlangıç→Rehber→Referans→Sorun-Giderme) | <https://obsidian.md/help/> <https://code.claude.com/docs/en/quickstart> |
| 5 | Dark/light tema anahtarı (localStorage + prefers-color-scheme) | <https://obsidian.md/help/> <https://www.anthropic.com/> |
| 6 | Kopya-butonlu / sekmeli kod blokları | <https://code.claude.com/docs/en/quickstart> |
| 7 | Callout kutuları (Not / İpucu / Uyarı) | <https://code.claude.com/docs/en/quickstart> |
| 8 | Başlık çapa-linkleri + açılış hero'su | <https://code.claude.com/docs/en/quickstart> <https://claude.com/product/claude-code> |
| 9 | Prev/next (veya 'What's next' kart-ızgarası) | <https://code.claude.com/docs/en/quickstart> |
| 10 | Responsive düzen (kenar-çubuğu mobilde çekmece) | <https://www.anthropic.com/> <https://claude.com/product/claude-code> |
| 11 | Açılış kart-ızgarası + çok-sütunlu footer | <https://support.claude.com/en/> <https://www.anthropic.com/> |
| 12 | llms.txt tarzı makine indeksi (tüm sayfaları listeler) | <https://code.claude.com/docs/en/quickstart> |
