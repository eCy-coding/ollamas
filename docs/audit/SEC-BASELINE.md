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

## EK — custom `no-shell-exec` repo-wide triage (µ1 completeness; EXEC-INVENTORY server/cli/orchestration-only'di, .mjs/.claude/contract kaçmıştı)
Full-repo `semgrep --config .semgrep/` başta **9 hit** verdi → hepsi FP/scope-dışı, **0 gerçek yeni-vuln**:
| hit | sınıf | disposition |
|---|---|---|
| `.claude/harness-ops.mjs:13,74` · `.claude/hooks/{gate-before-commit,on-stop,preserve-context}.mjs` · `.claude/statusline.mjs:17` · `scripts/system-monitor.mjs:29` (7) | dev/ops harness `sh` helper (hardcoded-cmd, shipped-yüzey değil, attacker-unreachable) | rule `paths: exclude` (.claude/**, scripts/**, tests) |
| `contract/src/mesh.ts:22` `exec()` | no-arg → child_process değil; injected ExecFn default = `execFileSync("tailscale",[...])` (safe) | rule `pattern-not: exec()` |
| `bin/host-bridge/gate.mjs:36` `exec(s)` | DI step-runner (`opts.exec`, step-object alır), child_process değil | inline `nosemgrep: no-shell-exec` |

**Sonuç:** rule shipped-surface'e (server/cli/orchestration/contract/bin) scope'landı → repo-wide **0 FP**, scratch-vuln hâlâ **1** (8e60fe2). Gate-flip (1.24.3) artık CI'yı FP ile kırmaz.

## GATE-PROOF (1.24.3 µ2 — canlı CI iki-yön kanıt, eCy-coding/ollamas)
CI `security / security-gate` job blocking doğrulandı (gitleaks + trivy@v0.36.0 + semgrep-CLI @1.157.0 `--config .semgrep/ --error`):
- 🟢 **GREEN** (temiz feat/key-autonomy): https://github.com/eCy-coding/ollamas/actions/runs/28980567897 — 3 step geçti.
- 🔴 **RED** (planted shell-exec `server/__sec_proof.ts`): https://github.com/eCy-coding/ollamas/actions/runs/28980848065 — Semgrep step X (`semgrep.no-shell-exec` planted-vuln'ü blocking yakaladı), gitleaks+trivy geçti; proof-branch sonrasında silindi.
- Gate-yapı düzeltmesi: deprecated `semgrep-action@v1` (sadece 1-config koşup nosemgrep-line-above yoksayıyordu) → pinned CLI; kırık `trivy-action@0.28.0`→`@v0.36.0` (v-prefix tag).
