---
description: Harness otonom sağlık raporu — read-only suite (validate/test-hooks/drift/gitleaks/launchd); --deep ekler semgrep/trivy/knip
allowed-tools: Bash(node .claude/harness-ops.mjs:*)
---

Harness'in otonom read-only sağlık taramasını ŞİMDİ çalıştır (launchd saatlik de koşar).

1. `node .claude/harness-ops.mjs` (FAST) veya `node .claude/harness-ops.mjs --deep` (semgrep+trivy+knip ekler, yavaş).
2. Çıktı tablosunu sun: her check st (✓/✗/⚠) + detail. `.claude/harness-ops-report.md`'ye yazılır.
3. ✗/⚠ varsa: tek-satır fix öner (settings drift → `bash .claude/apply-harness.sh`; gitleaks → incele).

Kural: READ-ONLY (heartbeat §3 observe). ASLA auto-fix/commit/apply. Mutasyon = insan onayı. Evidence-first: gerçek çıktı.
