#!/usr/bin/env bash
# vO-FND.2 — TEK KOMUT 0-manuel aktivasyon. EMRE çalıştırır (settings.json yazımı onun yetkisi).
# Idempotent: .claude/settings.json hook'ları (SessionStart→autopilot + UserPromptSubmit→model-hook)
# ekle (varsa atla, role-hook KORUNUR) → launchd autopilot agent yükle → doctor GO/NO-GO doğrula.
# Kullanım: bash orchestration/bin/activate.sh [--dry-run]
set -euo pipefail

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
WT="$HOME/Desktop/ollamas-orchestration-wt"
ORCH="$WT/orchestration"
SETTINGS="$WT/.claude/settings.json"
TSX="$HOME/Desktop/ollamas/node_modules/.bin/tsx"

echo "== vO-FND.2 0-manuel aktivasyon (dry-run=$DRY) =="

# 1) settings.json idempotent patch — PURE settings-patch.ts REUSE.
"$TSX" -e "
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { patchSettings } from '$ORCH/bin/lib/settings-patch.ts';
const f = '$SETTINGS';
const cur = existsSync(f) ? readFileSync(f, 'utf8') : '{}';
const r = patchSettings(cur);
if (!r.changed) console.log('settings.json: ZATEN patched (değişiklik yok)');
else if ($DRY) { console.log('settings.json: EKLENECEK → ' + r.added.join(', ') + ' (role-hook korunur)'); console.log('--- önizleme ---'); console.log(r.json); }
else { writeFileSync(f, r.json); console.log('settings.json: PATCHED → ' + r.added.join(', ')); }
"

if [ "$DRY" = "1" ]; then echo "== dry-run: launchd + doctor ATLANDI (dosya YAZILMADI) =="; exit 0; fi

# 2) launchd autopilot agent (mevcut installer REUSE).
echo "-- launchd autopilot agent --"
bash "$ORCH/bin/autopilot-install.sh" load || echo "launchd: autopilot-install.sh başarısız (elle kontrol)"

# 3) doctor GO/NO-GO doğrula (REUSE).
echo "-- readiness doğrulama (doctor) --"
"$TSX" "$ORCH/bin/doctor.ts" --quiet || true

echo "== AKTİVASYON TAMAM. Yeni sekme aç → 0-manuel CANLI (autopilot+model-hook+launchd). =="
echo "   Durdur: bash $ORCH/bin/autopilot-install.sh unload"
