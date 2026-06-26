---
description: Harness'e yeni CLI entegre et (smoke-test + permission + registry) — argüman= <cli> [allow|ask] [pattern]
allowed-tools: Bash(node .claude/add-cli.mjs:*), Bash(command -v:*)
---

Kullanıcının verdiği CLI'ı harness'e e2e entegre et.

1. CLI kurulu mu kontrol: `command -v <cli>`. Kurulu değilse kurulum komutu öner (brew/npm), DUR.
2. Sınıflandır: read-only/analiz → `allow`; side-effectful/outward/mutating (deploy, push, delete) → `ask`.
3. Çalıştır: `node .claude/add-cli.mjs <cli> --tier <allow|ask> --pattern "<sub:*>" --use "<amaç>"`
   - smoke-test eder, cli-extensions.json'a ekler (idempotent), CLI-REGISTRY.md'ye satır düşer.
4. Operatöre bildir: `bash .claude/apply-harness.sh` (union → canlı) + gerekirse restart.
5. Doğrula: `node .claude/merge-settings.mjs` dry-run'da yeni rule allow/ask'ta görünür.

Kural: side-effectful CLI ASLA allow'a koyma → ask. Pattern dar tut (örn `trivy fs:*` değil `trivy:*` gerekmiyorsa). Evidence-first: smoke çıktısını göster.
