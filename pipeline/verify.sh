#!/bin/zsh
# verify.sh — eCym pipeline 4-sistem kapısı. "çalışıyor" iddiasını tek komutta doğrula.
#
# ollamas + eCym + obsidian + claudecode'un GERÇEKTEN bağlı olduğunu denetler. Kalıp
# `_bin/cc-verify.sh`'ten alındı ve orada kanıtlandı: dişli (FAIL → exit 1), ama dalgalı
# servisi FAIL saymaz — kalıcı yanlış-kırmızı bir kapıyı işe yaramaz hale getirir.
#
#   zsh pipeline/verify.sh            zarif-degrade (servis kapalıysa SKIP)
#   zsh pipeline/verify.sh --strict   her SKIP'i FAIL say (elle tam denetim)
set -u
REPO="${OLLAMAS_REPO:-$HOME/Desktop/ollamas}"
V="${OBSIDIAN_VAULT:-$HOME/ollamas-vault}"
API="${OLLAMAS_API:-http://127.0.0.1:3000}"
STRICT=0; [ "${1:-}" = "--strict" ] && STRICT=1
PASS=0; FAIL=0; SKIP=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
degrade() { [ "$STRICT" = "1" ] && bad "$1" || skip "$1 (servis dalgalı — zarif-degrade)"; }
head_(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
cd "$REPO" || exit 1

head_ "1  Saf çekirdek — testler + ≥%90 coverage"
T=$(npx vitest run --project pipeline --reporter=json 2>/dev/null | python3 -c "
import json,sys,re
m=re.search(r'\{.*\}',sys.stdin.read(),re.S)
d=json.loads(m.group(0)) if m else {}
print(f\"{d.get('numPassedTests',0)}/{d.get('numTotalTests',0)}:{d.get('numFailedTests',1)}\")" 2>/dev/null)
[ "${T##*:}" = "0" ] && [ -n "$T" ] && ok "pipeline testleri ${T%%:*}" || bad "pipeline testleri ${T:-koşmadı}"
COV=$(npx vitest run --project pipeline --coverage.enabled --coverage.reporter=json-summary \
  --coverage.reportsDirectory="$REPO/coverage-pipeline" --coverage.thresholds.lines=0 \
  --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 >/dev/null 2>&1; python3 -c "
import json,os
p='$REPO/coverage-pipeline/coverage-summary.json'
d=json.load(open(p))
v=[x['lines']['pct'] for k,x in d.items() if 'pipeline/lib' in k]
print(round(sum(v)/len(v),2) if v else 0)" 2>/dev/null)
python3 -c "import sys;sys.exit(0 if float('${COV:-0}')>=90 else 1)" 2>/dev/null \
  && ok "pipeline/lib coverage ${COV}% (≥90)" || bad "pipeline/lib coverage ${COV:-?}% (<90)"

head_ "2  DAG bütünlüğü"
D=$(npx tsx -e "
import {readFileSync} from 'node:fs';
import {explain,order} from './pipeline/lib/dag.ts';
const p=JSON.parse(readFileSync('pipeline/workflow.json','utf8'));
const o=order(p); console.log(o.length+'|'+explain(p).at(-1));" 2>/dev/null)
[ "${D%%|*}" = "18" ] && ok "18 adım, döngü yok · ${D#*|}" || bad "DAG bozuk: ${D:-parse edilemedi}"

head_ "3  obsidian — kapsül katmanı ve referans çapaları"
CCKB="$V/_bin/cckb"
if [ -x "$CCKB" ]; then
  B=$("$CCKB" --json ask -k 3 "hooks nasil yazilir" 2>/dev/null | wc -c | tr -d ' ')
  [ "${B:-0}" -gt 100 ] && ok "cckb --json cevap veriyor (${B} B, ağsız)" || bad "cckb --json çalışmıyor"
else bad "vault-kanonik cckb yok ($CCKB)"; fi
python3 "$V/_bin/pipe-anchors.py" --check >/tmp/pa.txt 2>&1 \
  && ok "$(head -1 /tmp/pa.txt)" || bad "$(head -1 /tmp/pa.txt)"
rm -f /tmp/pa.txt
for f in "_index/pipeline.md" "pipeline-sistem.canvas" "_index/pipe-kaynaklar.md"; do
  [ -s "$V/$f" ] && ok "vault yüzeyi: $f" || bad "vault yüzeyi eksik: $f"
done
CVM=$(python3 -c "
import json,os
V='$V'; d=json.load(open(os.path.join(V,'pipeline-sistem.canvas')))
print(sum(1 for n in d['nodes'] if n.get('type')=='file' and not os.path.exists(os.path.join(V,n['file']))))" 2>/dev/null)
[ "${CVM:-1}" = "0" ] && ok "canvas'ta kayıp dosya-düğüm yok" || bad "${CVM} kayıp canvas düğümü"

head_ "4  ollamas — CLI, allowlist, metrikler"
npx tsx cli/index.ts pipeline explain >/dev/null 2>&1 \
  && ok "\`ollamas pipeline\` komutu kayıtlı" || bad "\`ollamas pipeline\` çalışmıyor"
R=$(npx tsx -e "import {isShellRunnable} from './server/terminal.ts';console.log(isShellRunnable('cckb ask \"x\"'))" 2>/dev/null | tail -1)
[ "$R" = "true" ] && ok "cckb kabuk allowlist'inde" || bad "cckb allowlist'te değil"
if curl -s -o /dev/null --max-time 4 "$API/api/health"; then
  M=$(curl -s --max-time 8 "$API/metrics" 2>/dev/null | grep -c "workflow_step_duration_seconds")
  [ "${M:-0}" -ge 1 ] && ok "/metrics workflow_step_* yayınlıyor (${M} satır)" \
    || skip "/metrics'te workflow_step_* yok (sunucu bu süreçte koşu görmedi)"
else degrade "ollamas :3000 doğrulanamadı"; fi

head_ "5  eCym — doğal dil rotaları"
if [ -x "$HOME/.local/bin/ecy-cmd" ]; then
  HIT=0
  for q in "pipeline calistir" "pipeline benchmark al" "kor nokta var mi" "pipeline dag goster"; do
    ID=$("$HOME/.local/bin/ecy-cmd" "$q" 2>/dev/null | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('id',''))
except Exception: print('')" 2>/dev/null)
    case "$ID" in pipeline-*) HIT=$((HIT+1)) ;; esac
  done
  [ "$HIT" -eq 4 ] && ok "4/4 doğal dil sorgusu pipeline rotasına gidiyor" \
    || bad "eCym rotası eksik: ${HIT}/4"
else skip "ecy-cmd yok"; fi

head_ "6  claudecode — skill + slash komut"
[ -s "$HOME/.claude/skills/ai-pipeline/SKILL.md" ] && ok "skill ai-pipeline kurulu" || bad "skill yok"
[ -s "$HOME/.claude/commands/pipeline.md" ] && ok "/pipeline komutu kurulu" || bad "/pipeline yok"

head_ "7  Kendini güncelleyen prompt"
for f in "$REPO/pipeline/PROMPT.md" "$HOME/Desktop/eCym.md"; do
  grep -q "MEASURED:BEGIN" "$f" 2>/dev/null && ok "MEASURED bloğu var: $(basename "$f")" \
    || bad "MEASURED bloğu yok: $(basename "$f")"
done
LASTRUN=$(ls -t "$V/orchestra/runs"/*.json 2>/dev/null | head -1)
[ -n "$LASTRUN" ] && ok "artefakt yazılıyor: $(basename "$LASTRUN")" || bad "hiç koşu artefaktı yok"

head_ "8  Sandbox havuzu ve sızıntı"
if docker info >/dev/null 2>&1; then
  LEAK=$(docker ps -aq --filter label=ecym-pipeline=sandbox 2>/dev/null | wc -l | tr -d ' ')
  [ "${LEAK:-0}" = "0" ] && ok "artık sandbox konteyneri yok (sızıntı 0)" \
    || bad "${LEAK} artık konteyner — \`ollamas pipeline sweep\`"
else degrade "docker doğrulanamadı"; fi

printf '\n\033[1mÖZET\033[0m  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] && echo "eCym pipeline sağlam — 4 sistem bağlı." \
  || echo "Kırık — yukarıdaki FAIL'leri düzelt."
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
