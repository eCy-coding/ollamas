---
description: $0 güncel kütüphane dökümanı — Context7 MCP ile bir paketin GÜNCEL API docs'unu çek (eğitim-kesintisi sonrası bilgiye karşı)
---

Verilen kütüphane/paket için GÜNCEL resmi dökümanı Context7 MCP'den çek (argüman = paket adı + opsiyonel konu, ör. "next.js app router" veya "zod v4").

Adımlar:
1. `mcp__context7__resolve-library-id` (veya gateway eşdeğeri `mcp__MCP_DOCKER__resolve-library-id`) ile paketi Context7 ID'sine çöz.
2. `mcp__context7__get-library-docs` ile dökümanı çek (varsa `topic` parametresiyle daralt).
3. MCP yoksa/erişilemezse: WebFetch ile resmi docs URL'sine düş (fallback), kaynağı belirt.

Çıktı:
- Kısa özet + İLGİLİ güncel API imzaları/örnekleri (kod blokları).
- Eğitim-bilgimle ÇELİŞEN nokta varsa açıkça işaretle ("güncel docs X diyor, eski davranış Y'ydi").
- Kaynak (Context7 ID veya URL) belirt — uydurma yok.

Not: Context7 restart sonrası canlı (enabledMcpjsonServers'da). Tool görünmüyorsa sekme yeniden başlatılmalı.
