---
description: OpenAPI lint — Spectral ile /api/openapi.json kalite denetimi (npx, $0)
allowed-tools: Bash(npx @stoplight/spectral-cli:*), Bash(curl:*), Bash(jq:*)
---

Projenin OpenAPI spec'ini Spectral ile denetle.

1. Spec'i al: tercihen canlı `curl -s http://127.0.0.1:8090/api/openapi.json -o /tmp/openapi.json` (server up ise); değilse repo'da `server/openapi.ts`'ten üretileni kullan veya kullanıcıdan path iste.
2. Lint: `npx -y @stoplight/spectral-cli lint /tmp/openapi.json` (kuralsız default `oas` ruleset). SARIF gerekirse `--format sarif`.
3. Çıktı: severity-sıralı bulgu tablosu (error/warn) | path | mesaj | öneri.

Kural: read-only (spec'i değiştirme). Bulgu yoksa "0 sorun". npx ilk-çalıştırma paketi indirir (cache). Evidence-first: gerçek spectral çıktısı.
