#!/usr/bin/env bash
# eCym'in risky() listesine GUI otomasyon token'larını ekler.
#
# NEDEN: mevcut liste kabuk komutları için yazılmış (sudo|rm|dd|chmod|…) ve
# osascript/open -a içermiyor. AppleScript operatör adına mail gönderebilir,
# mesaj atabilir, Finder'dan silebilir — ` rm ` desenine hiç uğramadan.
#
# BU SCRIPT OTOMATİK ÇALIŞMAZ. Dosya sizin, kararı sizin. Yedek alır, idempotenttir,
# ve satır numarasına değil İÇERİĞE çıpalanır.
set -euo pipefail

ECYM="${ECYM_PATH:-$HOME/.local/bin/ecym}"
ADD='osascript|tell app|System Events|shortcuts run|automator|tccutil|screencapture|empty trash'

[ -f "$ECYM" ] || { echo "bulunamadı: $ECYM" >&2; exit 1; }

if grep -q 'osascript' "$ECYM"; then
  echo "zaten yamalı (osascript mevcut) — değişiklik yok"; exit 0
fi

grep -q 'defaults write' "$ECYM" || { echo "beklenen çıpa 'defaults write' yok — risky() değişmiş olabilir, elle bakın" >&2; exit 2; }

BAK="$ECYM.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ECYM" "$BAK"
echo "yedek: $BAK"

# İçerik-çıpalı tek değişiklik: 'defaults write' token'ının yanına ekle.
python3 - "$ECYM" "$ADD" <<'PY'
import sys
path, add = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
assert s.count("defaults write") == 1, "çıpa tek olmalı"
open(path, "w", encoding="utf-8").write(s.replace("defaults write", "defaults write|" + add))
PY

bash -n "$ECYM" && echo "sözdizimi tamam"
echo "yamalandı. doğrula: npx tsx scripts/ecym-guard-check.ts"
echo "geri al:  cp '$BAK' '$ECYM'"
