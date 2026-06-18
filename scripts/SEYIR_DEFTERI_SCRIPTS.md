# SEYIR_DEFTERI_SCRIPTS.md — Scripts Domain Logbook

> Her phase ve her hata buraya işlenir (kanıt/komut çıktısı ile). Canlı ayna: `~/.llm-mission-control/seyir-defteri-scripts.jsonl` (`kind:"script_run"`), `bin/host-bridge/tools/logbook.mjs` pattern'i ile.
>
> **Entry formatı:** `[ISO ts] kind=phase|error|fix | what | evidence | green-gate sonucu`
>
> Hata sınıfları kalıcı olarak `errors_registry.json`'da; burası kronolojik anlatı.

---

## v1 — Foundation & Inventory

- `[2026-06-19] kind=phase | Governance 4 dosya kuruldu (SCRIPTS_AGENTS.md, ROADMAP_SCRIPTS.md, SEYIR_DEFTERI_SCRIPTS.md, errors_registry.json) | scripts/ altında, feat/scripts-v1 branch | gate: pending`
- `[2026-06-19] kind=phase | Branch feat/scripts-v1 main'den ayrıldı (CLI worktree izolasyonu) | git checkout -b feat/scripts-v1 | OK`

> Kalan v1 phase'leri (inventory.json, baseline doğrula, HMAC parity, commit) işlendikçe buraya eklenecek.

---

## Hata Anlatıları

> Henüz scripts domain'inde hata yaşanmadı. İlk hata `errors_registry.json`'a yazıldığında buraya kronolojik anlatısı eklenir.
>
> Kural (SCRIPTS_AGENTS.md §9): registry'deki bir hata **asla tekrarlanmaz**; tekrarlanırsa `recurrence_count++` + prevention_rule güçlendirilir.
