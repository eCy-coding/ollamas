---
description: Lisans raporu — license-checker ile bağımlılık lisans uyumu (audit-service deliverable, npx, $0)
allowed-tools: Bash(npx license-checker:*)
---

Bağımlılık lisanslarını raporla (audit-service müşteri-deliverable + uyum kontrolü).

1. Özet: `npx -y license-checker --summary` → lisans-tipi dağılımı.
2. Risk: `npx -y license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0;Unlicense" --excludePrivatePackages` → izin-dışı (GPL/AGPL/proprietary) lisansları yakala.
3. Çıktı: lisans dağılım tablosu + RİSKLİ paketler (copyleft/unknown) + öneri.

Kural: read-only. ollamas zero-dep runtime → çoğu devDep; runtime'da copyleft çıkarsa CRİTİK flag. Müşteri-repo'da çalıştırılabilir (audit-service). npx ilk-çalıştırma indirir.
