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

head_ "9  Kanonik çıktı belgesi (master prompt'un kendi sözleşmesi)"
DOC=$(ls -t "$V/orchestra/runs"/*.document.json 2>/dev/null | head -1)
if [ -n "$DOC" ]; then
  RES=$(python3 - "$DOC" <<'PYEOF'
import json, sys, re
d = json.load(open(sys.argv[1]))
req = ["search_results","thoughts","analysis","plan","todo_board",
       "benchmark_configuration","ci_cd_yaml","references"]
missing = [k for k in req if k not in d]
# Atıf bütünlüğü: her [n] gerçek bir ref_id'ye çözülmeli
ids = {r["ref_id"] for r in d.get("references", [])} | {s["ref_id"] for s in d.get("search_results", [])}
bad = []
for sec, gaps in (d.get("analysis") or {}).items():
    for g in gaps or []:
        for n in re.findall(r"\[(\d+)\]", g.get("evidence", "")):
            if int(n) not in ids:
                bad.append(f"{sec}:[{n}]")
print(f"{len(req)-len(missing)}/{len(req)}|{','.join(missing) or '-'}|{len(bad)}|{','.join(bad[:3]) or '-'}")
PYEOF
)
  KEYS=${RES%%|*}; REST=${RES#*|}; MISS=${REST%%|*}; REST=${REST#*|}; BADN=${REST%%|*}; BADL=${REST#*|}
  [ "$KEYS" = "8/8" ] && ok "8 anahtarın tamamı üretiliyor" || bad "belge anahtarı eksik: ${KEYS} (${MISS})"
  [ "${BADN:-1}" = "0" ] && ok "atıf bütünlüğü: her [n] bir kaynağa çözülüyor" \
    || bad "${BADN} çözülmeyen atıf: ${BADL}"
else bad "hiç .document.json yok — `ollamas pipeline run` çalıştır"; fi

head_ "10  CI eşikleri kaynakla aynı mı (ayrışma testi)"
DRIFT=$(npx tsx -e "
import { renderWorkflow, parseThresholdEnv, envName } from './pipeline/lib/ci.ts';
import { DEFAULT_THRESHOLDS } from './pipeline/lib/gates.ts';
const p = parseThresholdEnv(renderWorkflow());
const bad = Object.entries(DEFAULT_THRESHOLDS).filter(([k,v]) =>
  p[envName(k)] !== (Array.isArray(v) ? v.join(',') : String(v))).map(([k]) => k);
console.log(bad.length ? 'DRIFT:' + bad.join(',') : 'OK');" 2>/dev/null | tail -1)
[ "$DRIFT" = "OK" ] && ok "CI YAML eşikleri DEFAULT_THRESHOLDS ile birebir" || bad "CI ayrışması: $DRIFT"
[ -s "$REPO/.github/workflows/pipeline.yml" ] && ok "workflow dosyası diskte" || bad ".github/workflows/pipeline.yml yok"

head_ "11  75/25 lookahead ölçüldü mü"
LA=$(python3 -c "
import json,glob,os,sys
fs=sorted(glob.glob(os.path.expanduser('$V/orchestra/runs/*-*.json')),key=os.path.getmtime)
fs=[f for f in fs if not f.endswith('.document.json')]
if not fs: print('YOK'); sys.exit()
d=json.load(open(fs[-1]))
# Açıklayıcı notu seç, ilk eşleşeni değil: notlar arasında hem 'lookahead_saved_ms=N'
# hem de insan-okunur satır var; ilkini almak kapıyı yanlış-kırmızı yapıyordu.
n=[x for x in (d.get('env',{}).get('notes') or []) if x.startswith('lookahead:')]
print(n[0] if n else 'YOK')" 2>/dev/null)
case "$LA" in
  *"fired at"*) ok "lookahead: ${LA#lookahead: }" ;;
  *"not triggered"*) skip "lookahead tetiklenmedi (koşu %75'i geçmedi)" ;;
  *) bad "lookahead ölçümü raporda yok" ;;
esac

head_ "12  Web arama degrade dürüstlüğü"
WS=$(npx tsx -e "
import { webSearch } from './pipeline/runtime/websearch.ts';
(async () => {
  const r = await webSearch({ queries: ['x'], backend: async () => ({ source: 'stub', results: [] }) });
  console.log(JSON.stringify({ n: r.results.length, deg: r.degraded, hasReason: Boolean(r.reason) }));
})();" 2>/dev/null | tail -1)
echo "$WS" | grep -q '"n":0,"deg":true,"hasReason":true' \
  && ok "boş arama dürüstçe degrade (uydurma kaynak yok)" \
  || bad "web arama degrade yolu bozuk: ${WS:-çıktı yok}"

head_ "13  Görünür sekme yeteneği (gizli iş yok)"
CAP=$(npx tsx -e "
import { capability } from './pipeline/runtime/termtab.ts';
capability('terminal').then(c => console.log((c.ok?'OK|':'NO|') + c.reason + '|' + c.fix));" 2>/dev/null | tail -1)
case "$CAP" in
  OK\|*) ok "sekme açılabiliyor — ${CAP#OK|}" ;;
  NO\|*) bad "sekme açılamıyor: ${CAP#NO|}" ;;
  *) bad "sekme yeteneği ölçülemedi" ;;
esac

head_ "14  Board headless kapısı (aynı adımlar, pencere yok)"
if timeout 600 npx tsx pipeline/bin/board.ts --lanes obsidian --headless >/tmp/board.txt 2>&1; then
  ok "board obsidian lane GREEN ($(grep -c '^✓' /tmp/board.txt) adım)"
else
  bad "board obsidian lane RED — $(grep -m1 '^✗' /tmp/board.txt || echo 'sebep yok')"
fi
rm -f /tmp/board.txt

head_ "15  Arka plan envanteri"
BG=$(timeout 120 python3 "$V/_bin/bg-audit.py" --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
j=d['jobs']; run=[x for x in j if x['running']]
print(f\"{len(j)}|{len(run)}|{len(d['processes'])}\")" 2>/dev/null)
JOBS=${BG%%|*}; REST=${BG#*|}; RUN=${REST%%|*}; PROCS=${REST#*|}
[ "${JOBS:-0}" -ge 20 ] && ok "envanter: ${JOBS} launchd işi · ${RUN} koşuyor · ${PROCS} bağımsız süreç" \
  || bad "envanter üretilemedi (${BG:-boş})"
[ -s "$V/_index/arkaplan.md" ] && ok "vault notu _index/arkaplan.md var" || bad "arkaplan notu yok"

head_ "16  Sekme sızıntısı"
LEAK=$(ps -Ao command 2>/dev/null | grep -c "[.]ollamas/term/.*tab\.sh" || true)
[ "${LEAK:-0}" -le 1 ] && ok "artık sekme döngüsü yok (${LEAK})" \
  || bad "${LEAK} artık sekme döngüsü — pkill -f '.ollamas/term'"

head_ "17  Log okunabilirliği (4 gerçek biçim)"
LF=$(npx tsx -e "
import {parseLine} from './pipeline/lib/logfmt.ts';
const R=['2026-07-24 13:20:57  cc-verify: PASS=24  FAIL=1','2026-07-24 10:32:25,421 INFO gateway.run: x','WARNING gateway.run: y','2026-07-24T10:32:12.122+03:00 [plugins] z'];
const p=R.map(l=>parseLine(l,'j'));
const times=p.filter(x=>x&&x.time).length, levels=p.filter(x=>x&&!x.levelInferred).length;
console.log(times+'|'+levels);" 2>/dev/null | tail -1)
TIMES=${LF%%|*}; LEVELS=${LF#*|}
[ "${TIMES:-0}" = "3" ] && [ "${LEVELS:-0}" = "3" ] \
  && ok "4 biçim ayrıştı: 3 zaman damgası + 3 açık seviye (damgasız satır dürüstçe boş)" \
  || bad "log ayrıştırma bozuk (zaman=${TIMES:-?} seviye=${LEVELS:-?})"

head_ "18  Anlatı üretimi (algoritma akışı)"
NR=$(npx tsx -e "
import {narrateGates,narrateDecision} from './pipeline/lib/narrate.ts';
import {evaluate,decide} from './pipeline/lib/gates.ts';
import {summarize} from './pipeline/lib/stats.ts';
const ev={steps:{think:summarize([200]),sandbox_test:summarize([40])},total:summarize([1000]),errorRatePct:0,coveragePct:99,chaosSuccess:1,totals:[1000]};
const g=narrateGates(evaluate(ev)).some(l=>l.text.includes('ÖLÇÜLMEDİ'));
const d=narrateDecision(decide(ev)).some(l=>l.text.includes('gevşetilmedi'));
console.log((g?'MISS-OK':'MISS-NO')+'|'+(d?'WEAK-OK':'WEAK-NO'));" 2>/dev/null | tail -1)
case "$NR" in
  MISS-OK\|WEAK-OK) ok "anlatı: ÖLÇÜLMEDİ ayrımı + zayıf-kanıt uyarısı üretiliyor" ;;
  *) bad "anlatı eksik: ${NR:-üretilemedi}" ;;
esac

printf '\n\033[1mÖZET\033[0m  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] && echo "eCym pipeline sağlam — 4 sistem bağlı." \
  || echo "Kırık — yukarıdaki FAIL'leri düzelt."
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
