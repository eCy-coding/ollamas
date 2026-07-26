#!/usr/bin/env bash
# verify-standard.sh — provisioning standardının KENDİSİNİ denetler.
#
#   bash scripts/worker/verify-standard.sh
#
# Dört kapı. Hiçbiri makineye bağlanmaz; standardın iç tutarlılığını ölçer.
#   T1 sözdizimi        — bash -n
#   T2 anti-desen       — Y-2/4/5/9/10/11 script'te BULUNMAMALI (yorumlar dışlanır)
#   T3 sözleşme izi     — vmIdleTimeout=-1, InstanceName, npm install, base64, powercfg VAR olmalı
#   T4 heredoc render   — her unquoted heredoc GERÇEKTEN render edilmeli (Y-16)
#
# NEDEN T4 VAR: `bash -n` yalnız sözdizimi bakar. Unquoted heredoc içinde PowerShell backtick'i
# bash'te command substitution olur; blok sessizce BOŞ gider. bash -n bunu göremez (Y-16).
#
# NEDEN T2 YORUMLARI DIŞLAR: ilk sürüm 4 meşru `-First 1` ve 2 açıklama satırını "ihlal" saydı;
# kural denetleyicisi de bir ölçüm aracıdır ve kendisi ölçülmeden güvenilmez (Y-14).
set -uo pipefail
cd "$(dirname "$0")"

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$*"; PASS=$((PASS+1)); }
no()  { printf '  ⛔ %s\n' "$*"; FAIL=$((FAIL+1)); }
code_only() { grep -vE '^\s*#' "$1"; }

echo "── T1 sözdizimi"
for f in provision-worker.sh lib.sh verify-standard.sh; do
  bash -n "$f" 2>/dev/null && ok "$f" || no "$f sözdizimi"
done

echo "── T2 anti-desen (bulunmamalı)"
chk() { local y="$1" pat="$2"; shift 2; local hit=""
  for f in "$@"; do hit="$hit$(code_only "$f" | grep -nE "$pat" || true)"; done
  [ -z "$hit" ] && ok "$y" || no "$y → $hit"; }
chk "Y-2  sshd_config'e dokunma"  'sshd_config'                       provision-worker.sh
chk "Y-4  termal -First 1"        'MSAcpi.*First 1'                   provision-worker.sh thermal-watch.ps1
chk "Y-5  winget"                 'winget +(install|upgrade)'          provision-worker.sh
chk "Y-9  npm ci"                 'npm ci'                            provision-worker.sh
chk "Y-10 .env yazma"             '> *\.env|Set-Content[^;]*\.env'    provision-worker.sh
chk "Y-11 autoMemoryReclaim"      'autoMemoryReclaim'                 provision-worker.sh

echo "── T3 sözleşme izi (bulunmalı)"
need() { local d="$1" pat="$2"; shift 2
  local n=0; for f in "$@"; do grep -qE "$pat" "$f" 2>/dev/null && n=$((n+1)); done
  [ "$n" -gt 0 ] && ok "$d ($n dosya)" || no "$d EKSİK"; }
need "vmIdleTimeout=-1 (Y-13)" 'vmIdleTimeout=-1'  provision-worker.sh WORKER-STANDARD.md
need "InstanceName (Y-4)"      'InstanceName'      thermal-watch.ps1 WORKER-STANDARD.md
need "npm install (Y-9)"       'npm install'       provision-worker.sh
need "powercfg (Y-15)"         'powercfg'          provision-worker.sh WORKER-STANDARD.md
need "base64 taşıma (Y-12)"    'utf-16-le|base64'  lib.sh
need "MISS≠PASS sözleşmesi"    'MISS'              provision-worker.sh WORKER-STANDARD.md

echo "── T4 heredoc render (Y-16: bash -n'in kaçırdığı kusur)"
python3 - <<'PY'
import re, subprocess, pathlib, sys
src = pathlib.Path("provision-worker.sh").read_text().split("\n")
bad = ok_ = 0; i = 0
while i < len(src):
    m = re.search(r"<<'?(\w+)'?", src[i])
    if m:
        tag, quoted = m.group(1), "<<'" in src[i]
        body, j = [], i + 1
        while j < len(src) and src[j].strip() != tag:
            body.append(src[j]); j += 1
        if not quoted and body:
            r = subprocess.run(["bash","-c", f"X=$(cat <<{tag}\n" + "\n".join(body) + f"\n{tag}\n)\nprintf '%s' \"$X\""],
                               capture_output=True, text=True)
            if r.stderr.strip() or not r.stdout.strip():
                print(f"  ⛔ satır {i+1} (<<{tag}): {r.stderr.strip()[:80] or 'BOŞ RENDER'}"); bad += 1
            else:
                print(f"  ✅ satır {i+1} (<<{tag}): {len(r.stdout)} bayt"); ok_ += 1
        i = j
    i += 1
print(f"RENDER_SONUC {ok_} {bad}")
PY
R=$(bash -c 'cd "'"$PWD"'" && python3 - <<'"'"'PY'"'"'
import re,subprocess,pathlib
src=pathlib.Path("provision-worker.sh").read_text().split("\n"); bad=0; i=0
while i<len(src):
    m=re.search(r"<<'"'"'?(\w+)'"'"'?",src[i])
    if m:
        tag,q=m.group(1),"<<'"'"'" in src[i]; body=[]; j=i+1
        while j<len(src) and src[j].strip()!=tag: body.append(src[j]); j+=1
        if not q and body:
            r=subprocess.run(["bash","-c",f"X=$(cat <<{tag}\n"+"\n".join(body)+f"\n{tag}\n)\nprintf %s \"$X\""],capture_output=True,text=True)
            if r.stderr.strip() or not r.stdout.strip(): bad+=1
        i=j
    i+=1
print(bad)
PY' 2>/dev/null | tail -1)
[ "${R:-1}" = "0" ] && ok "tüm unquoted heredoc'lar render ediliyor" || no "$R heredoc bozuk render"

echo
echo "════ SONUÇ: PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
