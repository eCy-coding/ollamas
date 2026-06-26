---
description: Ölü-kod/kullanılmayan export avı — knip (zero-dep enforcer, npx, $0)
allowed-tools: Bash(npx knip:*)
---

Kullanılmayan dosya/export/dependency'leri bul (CLAUDE.md "unused code = sil" otomatik enforcer).

1. Çalıştır: `npx -y knip --no-progress` (config yoksa knip otomatik keşfeder; yanlış-pozitif çoksa scope daralt: `npx knip --include files,exports`).
2. Çıktı: kategori tablosu — unused files · unused exports · unused deps · unused devDeps. Her biri dosya:isim.

Kural: read-only (silme önerisi sun, otomatik silme). ollamas zero-dep hedefi → unused dep çıkarsa ÖZELLİKLE flag'le. Yanlış-pozitif (dynamic import/entry) ihtimalini belirt. npx ilk-çalıştırma indirir.
