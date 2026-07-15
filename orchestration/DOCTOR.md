# DOCTOR — 0-manuel autopilot readiness
<!-- AUTO doctor.ts · 2026-07-12T07:52:54.252Z · GO · regenerate: tsx orchestration/bin/doctor.ts -->

## ✅ GO (uyarılı) — 1 uyarı (aktif ama tazeleme/launchd eksik)

- [!] **launchd autopilot agent (WatchPaths + periyodik)** — yüklü değil
  🔧 → bash orchestration/bin/autopilot-install.sh load (bir-kerelik, sistem-op).
- [✓] **Claude Code hook'ları (SessionStart + model-hook)** — aktif
- [✓] **Benchmark verisi tazeliği (en-verimli-seçim girdisi)** — taze (2026-07-11T10:41:38.436Z)
- [✓] **Otopilot artefaktları (MODEL_PROMPT/CONDUCTOR/AUTOPILOT)** — hepsi var

_Doctor read-only denetler + safe self-heal (`--fix`); settings.json/launchctl AKTİVASYONU privileged → kullanıcı (AUTOPILOT_SETUP.md (settings.json hook snippet + autopilot-install.sh load))._
