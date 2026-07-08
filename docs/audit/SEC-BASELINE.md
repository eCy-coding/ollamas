# SEC-BASELINE — Trivy + Semgrep disposition (v1.24.2)

> Üretildi: v1.24.2 µ1 · Scanner'lar yerel koşuldu (feat/key-autonomy).
> - Trivy `fs --scanners vuln,misconfig,secret --severity CRITICAL,HIGH` → vuln=0, secret=0, **misconfig=2** (main-tree; `.claude/worktrees/*` gitignored → CI'da yok).
> - Semgrep `--config auto` (229 rules, 1077 files) → **6 ERROR** + custom `.semgrep/no-shell-exec` = 0.
> Verdict: FIX (kod/dep-bump) · SUPPRESS (kural-gerçek-ama-scope-dışı/justified) · FP (kural yanlış-eşleşme).

## Disposition tablosu (8 finding)
| # | scanner | rule | sev | file:line | verdict | WHY (grounded) |
|---|---|---|---|---|---|---|
| 1 | semgrep | gcm-no-tag-length | ERROR | server.ts:2945 | **FIX** | AES-256-GCM self-test roundtrip; default 16B tag zaten güvenli (getAuthTag/setAuthTag doğru) ama explicit `{ authTagLength: 16 }` = defense-in-depth. Vuln değil, açıklık-hardening. |
| 2 | semgrep | express-wkhtmltoimage-injection | ERROR | server.ts:1067 | **FP** | Sink `ProviderRouter.generate(testConfig)` = LLM üretimi; wkhtmltoimage/pdf YOK. Registry taint-kuralı `generate(...)` çağrısını yanlış eşleştirdi. |
| 3 | semgrep | express-wkhtmltoimage-injection | ERROR | server/contract.ts:438 | **FP** | Aynı: `ProviderRouter.generate(...)` fleet-provider; komut-exec yok, wkhtmltoimage yok. |
| 4 | semgrep | react-insecure-request | ERROR | cli/lib/client.ts:645 | **FP** | `fetch("http://127.0.0.1:7345/health")` = loopback bridge-probe; http→localhost transport-riski taşımaz. |
| 5 | semgrep | react-insecure-request | ERROR | orchestration/bin/benchprompt.ts:64 | **FP** | Loopback (yerel ollama/host); http→127.0.0.1 güvenli. |
| 6 | semgrep | react-insecure-request | ERROR | orchestration/bin/benchprompt.ts:80 | **FP** | Aynı loopback. |
| 7 | trivy | KSV-0014 (readOnlyRootFilesystem) | HIGH | deploy/helm/ollamas/templates/deployment.yaml | **SUPPRESS** | Operatör kararı: **K8s-scope=HAYIR**. ollamas CLI/binary/npm olarak ship edilir; k8s manifest referans-artefakt, shipped-yüzey değil. `.trivyignore`. |
| 8 | trivy | KSV-0014 (readOnlyRootFilesystem) | HIGH | deploy/k8s/ollamas.yaml | **SUPPRESS** | Aynı: K8s out-of-scope (Emre). `.trivyignore`. |

## Özet
- **FIX (µ2):** 1 — gcm authTagLength explicit (server.ts:2945).
- **SUPPRESS (µ3):** 7 — 5 semgrep FP (`nosemgrep: <id> -- WHY` inline) + 2 trivy KSV-0014 (`.trivyignore`).
- **Gerçek exploitable vuln: 0.** Baseline temiz; suppress-sonrası iki-scanner exit0 hedefi (µ3).

## Not
- `auto` registry ruleset 6 FP üretti → 1.24.3 gate-blocking-flip öncesi suppress ŞART (yoksa CI hep-kırmızı, gate işe yaramaz). Custom `.semgrep/no-shell-exec` = 0 (temiz).
- CI run-log kanıtı (Trivy misconfig deploy/, Semgrep 6→0-post-suppress) push'ta doğrulanır.
