---
description: Harness sağlık raporu — hooks/agents/statusline/permissions/launchd durumunu doğrular
---

Bu projenin Claude Code harness'ını denetle ve tek tablo bas. SADECE read-only komutlar çalıştır:

1. `node .claude/merge-settings.mjs` (dry-run) → settings.json'da permissions/statusLine/PreToolUse var mı ("would add: nothing" = tam aktif).
2. Her güvenlik hook'unu sahte payload'la test et: `redact-tokens` (secret→exit2), `block-destructive` (rm-rf/→exit2), `gate-before-commit` (add -A→exit2); pass-path (ls→exit0).
3. `.claude/statusline.mjs`'i örnek session JSON ile render et.
4. `ls .claude/agents/` → cli-coder, cli-verifier, harness-reviewer var mı.
5. `launchctl list | grep ollamas.orchestration.autopilot` → launchd yüklü mü.
6. `git config core.hooksPath` + `.git/hooks/pre-commit` var mı → ağır gate kurulu mu.

Çıktı: her boyut için OK/MISSING + eksikler için tek-satır fix (apply-harness.sh çalıştır / Terminal.app'ten launchd load). Kanıt-önce: gerçek exit kodlarını göster.
