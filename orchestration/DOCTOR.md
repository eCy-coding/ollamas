# DOCTOR — 0-manuel autopilot readiness
<!-- AUTO doctor.ts · 2026-06-20T11:46:08.443Z · NO-GO · regenerate: tsx orchestration/bin/doctor.ts -->

## 🛑 NO-GO — 1 blokaj + 1 uyarı (0-manuel AKTİF DEĞİL)

- [✗] **Claude Code hook'ları (SessionStart + model-hook)** — eksik: SessionStart model-hook
  🔧 → AUTOPILOT_SETUP.md (settings.json hook snippet + autopilot-install.sh load) §1: hook snippet'ini .claude/settings.json'a yapıştır (guardrail: ajan kendi config'ini yazamaz).
- [!] **launchd autopilot agent (WatchPaths + periyodik)** — yüklü değil
  🔧 → bash orchestration/bin/autopilot-install.sh load (bir-kerelik, sistem-op).
- [✓] **Benchmark verisi tazeliği (en-verimli-seçim girdisi)** — taze (2026-06-20T11:45:20.115Z)
- [✓] **Otopilot artefaktları (MODEL_PROMPT/CONDUCTOR/AUTOPILOT)** — hepsi var

_Doctor read-only denetler + safe self-heal (`--fix`); settings.json/launchctl AKTİVASYONU privileged → kullanıcı (AUTOPILOT_SETUP.md (settings.json hook snippet + autopilot-install.sh load))._
