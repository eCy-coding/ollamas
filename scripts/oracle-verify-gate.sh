#!/usr/bin/env bash
# ollamas BİRLEŞİK GÜVEN KAPISI (npm run oracle:verify) — tek komut, tek exit 0.
# Adımlar: tsc tip güvenliği → tüm vitest suite → Truth-Oracle CLI determinizm smoke (evrensel doğru/yanlış).
# ORACLE.md'de ilan edilen ama package.json'da eksik olan kapı. Kod değiştirmez; yalnız doğrular.
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$(dirname "$0")/.."

echo "→ [1/3] tsc --noEmit (tip güvenliği)"
npx tsc --noEmit

echo "→ [2/3] vitest run (tüm suite)"
npx vitest run

echo "→ [3/3] Truth-Oracle CLI determinizm smoke (CLI sözleşmesi + evrensel doğru/yanlış)"
# oracle.ts verdict'i exit-code ile de sinyaller (0=TRUE,1=FALSE,3=UNDECIDABLE) → çıktıyı yakala (|| true), sonra grep.
chk() {
  local q="$1" want="$2" out
  out="$(node ./node_modules/.bin/tsx orchestration/bin/oracle.ts --json "$q" 2>/dev/null || true)"
  if ! printf '%s' "$out" | grep -q "\"verdict\": *\"$want\""; then
    echo "   FAIL: « $q » beklenen $want değil → $out"; exit 1
  fi
  echo "   ✓ « $q » → $want"
}
chk "2+2=4" TRUE
chk "2+2=5" FALSE
chk "10 / 2 = 5" TRUE
chk "A and not A is always false" TRUE

echo "✅ oracle:verify GEÇTİ — tsc temiz, tüm testler yeşil, Truth-Oracle deterministik."
