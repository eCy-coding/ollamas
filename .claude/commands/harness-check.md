---
description: Harness sağlık raporu — hooks/agents/statusline/permissions/launchd durumunu doğrular
---

Bu projenin Claude Code harness'ını denetle ve tek tablo bas. SADECE read-only komutlar çalıştır:

1. `node .claude/validate-settings.mjs` → tüm top-level key'ler geçerli mi (uydurma-key yok); sonra `node .claude/merge-settings.mjs` (dry-run) → drift var mı ("would add: nothing/-..." = tam aktif; allow+/enabledMcp+ çıkarsa re-apply gerek).
2. Tüm hook suite'i koş: `bash .claude/hooks/test-hooks.sh` → 22/22 bekle. (Blocker'lar `permissionDecision:"deny"` JSON + exit 0 kullanır — exit2 DEĞİL; lifecycle hookları exit 0.)
3. `.claude/statusline.mjs`'i örnek session JSON ile render et.
4. `ls .claude/agents/` → cli-coder, cli-verifier, harness-reviewer var mı.
5. `launchctl list | grep ollamas.orchestration.autopilot` → launchd yüklü mü.
6. `.git/hooks/pre-commit` var mı + içinde `validate-settings`/`test-hooks` çağrısı → ağır gate + self-koruma kurulu mu.
7. `cat .mcp.json` → ollamas/context7/deepwiki; canlı settings `enabledMcpjsonServers` ile eşleşiyor mu (eşleşmezse re-apply).

Çıktı: her boyut için OK/MISSING + eksikler için tek-satır fix (apply-harness.sh çalıştır / Terminal.app'ten launchd load). Kanıt-önce: gerçek exit kodlarını göster.
