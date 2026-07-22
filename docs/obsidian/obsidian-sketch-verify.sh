#!/bin/zsh
# obsidian-sketch-verify.sh — the gate for ~/Desktop/obsidian-sketch.md
#
# WHY THIS EXISTS: the hand-written draft this guide replaces cited a community host that does
# not resolve, a plugin that does not exist, and a settings panel with a "Validate Config"
# button that was never there. None of it was ever run. Every claim here is re-derived from a
# live source, and a gate that cannot be evaluated reports SKIP — it never reports PASS.
#
# Two truths behave differently and the gates treat them differently:
#   help.obsidian.md is a SPA and answers 200 for invented paths -> truth is sitemap membership
#   community.sketch-your-mind.com is Discourse and answers 404 for invented topics -> truth is HTTP
#
# Usage:  zsh ~/Desktop/obsidian-sketch-verify.sh [--xml FILE]
# Exit:   0 = every evaluated gate passed, 1 = at least one FAIL

set -u
setopt PIPE_FAIL 2>/dev/null || true

GUIDE="${HOME}/Desktop/obsidian-sketch.md"
SCHEMA="${HOME}/Desktop/obsidian-sketch.schema.json"
REDUCE="${HOME}/Desktop/obsidian-sketch-reduce.py"
SIBLING="${HOME}/Desktop/obsidian.md"
VAULT="${OBSIDIAN_VAULT:-${HOME}/ollamas-vault}"
CACHE="${HOME}/Desktop/.obsidian-guide-cache"
PLUGIN_JSON="${VAULT}/.obsidian/plugins/obsidian-local-rest-api/data.json"
EX_JSON="${VAULT}/.obsidian/plugins/obsidian-excalidraw-plugin/data.json"
REAL_DRAWING="${VAULT}/Excalidraw/Drawing 2026-07-22 15.43.21.excalidraw.md"
XML_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --xml) XML_OVERRIDE="$2"; shift 2 ;;
    *) echo "bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$CACHE"
PASS=0; FAIL=0; SKIP=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- S1  xmllint
head_ "S1  XML gerçekten ayrıştırılıyor mu  (xmllint --noout)"
XML="${CACHE}/sketch.xml"
if [ -n "$XML_OVERRIDE" ]; then
  cp "$XML_OVERRIDE" "$XML"
elif [ -f "$GUIDE" ]; then
  awk '/^```xml$/{f=1;next} /^```$/{f=0} f' "$GUIDE" > "$XML"
else
  bad "kılavuz yok: $GUIDE"; XML=""
fi

if [ -n "$XML" ] && [ -s "$XML" ]; then
  if ERR=$(xmllint --noout "$XML" 2>&1); then
    ok "xmllint temiz ($(wc -l < "$XML" | tr -d ' ') satır XML)"
  else
    bad "xmllint reddetti:"; printf '%s\n' "$ERR" | sed 's/^/        /' | head -12
  fi
else
  [ -n "$XML" ] && bad "obsidian-sketch.md içinde \`\`\`xml bloğu bulunamadı"
fi

# ---------------------------------------------------------------- S2  sitemap üyeliği
head_ "S2  obsidian.md/help kaynakları sitemap'te var mı  (HTTP 200 bir SPA'da kanıt değil)"
SITEMAP="${CACHE}/help-sitemap.txt"
curl -s --max-time 20 https://help.obsidian.md/sitemap.xml \
  | grep -oE '<loc>[^<]+</loc>' | sed -E 's|</?loc>||g' > "${CACHE}/sitemap.live" 2>/dev/null
if [ -s "${CACHE}/sitemap.live" ]; then cp "${CACHE}/sitemap.live" "$SITEMAP"; fi

if [ -s "$XML" ] && [ -s "$SITEMAP" ]; then
  MISS=0; TOTAL=0
  for U in $(grep -oE 'url="https://obsidian\.md/help/[^"]+"' "$XML" | sed -E 's/url="//;s/"//' | sort -u); do
    TOTAL=$((TOTAL+1))
    grep -qxF "$U" "$SITEMAP" || { bad "sitemap'te yok: $U"; MISS=$((MISS+1)); }
  done
  [ "$MISS" -eq 0 ] && ok "${TOTAL} yardım kaynağının tamamı sitemap üyesi ($(wc -l < "$SITEMAP" | tr -d ' ') sayfa)"
  # Excalidraw resmi yardımda YOKTUR; kılavuz bunu iddia ediyorsa yalan söylüyor demektir.
  if grep -qi 'obsidian\.md/help/[a-z/-]*excalidraw' "$XML"; then
    bad "kılavuz obsidian.md/help altında excalidraw sayfası iddia ediyor — böyle bir sayfa yok"
  else
    ok "excalidraw resmi yardım sayfası olarak İDDİA EDİLMİYOR (doğru: topluluk eklentisi)"
  fi
else
  skip "XML ya da sitemap yok"
fi

# ---------------------------------------------------------------- S3  SYM canlılığı
head_ "S3  Sketch Your Mind konuları gerçekten var mı  (bu host SPA değil: uydurma id 404 verir)"
if [ -s "$XML" ]; then
  SYMBAD=0; SYMN=0
  for U in $(grep -oE 'url="https://community\.sketch-your-mind\.com[^"]*"' "$XML" | sed -E 's/url="//;s/"//' | sort -u); do
    SYMN=$((SYMN+1))
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$U")
    case "$CODE" in
      200|301|302) ;;
      *) bad "SYM konusu yok: $U -> $CODE"; SYMBAD=$((SYMBAD+1)) ;;
    esac
  done
  if [ "$SYMN" -eq 0 ]; then
    skip "kılavuzda SYM bağlantısı yok"
  elif [ "$SYMBAD" -eq 0 ]; then
    ok "${SYMN} SYM bağlantısının tamamı canlı (200/301)"
  fi
  # Kapının gerçekten düşebildiğini göster: var olmayan bir konu 404 vermeli.
  NEG=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 https://community.sketch-your-mind.com/t/999999)
  [ "$NEG" = "404" ] && ok "negatif kontrol: /t/999999 -> 404 (kapı düşebilir)" \
                     || bad "negatif kontrol beklenmedik: /t/999999 -> ${NEG} (kapı anlamsız olabilir)"
else
  skip "XML yok"
fi

# ---------------------------------------------------------------- S4  envanter yeniden türetme
head_ "S4  Sayılar canlı kaynaktan yeniden türetiliyor mu"
if [ -f "$PLUGIN_JSON" ]; then
  node -e '
    const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    fs.writeFileSync(process.argv[2], d.crypto?.cert ?? "");
    process.stdout.write(String(d.apiKey ?? ""));
  ' "$PLUGIN_JSON" "${CACHE}/obs-ca.pem" > "${CACHE}/obs.key" 2>/dev/null
  chmod 600 "${CACHE}/obs.key" 2>/dev/null
  PORT=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port||27124)}catch{console.log(27124)}' "$PLUGIN_JSON")
  KEY=$(cat "${CACHE}/obs.key" 2>/dev/null)
else
  PORT=27124; KEY=""
fi

if [ -n "$KEY" ] && [ -s "${CACHE}/obs-ca.pem" ]; then
  LIVE=$(curl -s --cacert "${CACHE}/obs-ca.pem" -H "Authorization: Bearer ${KEY}" \
         "https://127.0.0.1:${PORT}/commands/" --max-time 12 \
         | python3 -c 'import json,sys
try: c=json.load(sys.stdin)["commands"]
except Exception: print("ERR"); raise SystemExit
p=("obsidian-excalidraw-plugin","canvas","graph","slides")
print(len([x for x in c if x["id"].split(":")[0] in p]))' 2>/dev/null)
  CLAIM=$(grep -oE '<SketchCommands count="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  if [ "$LIVE" = "ERR" ] || [ -z "$LIVE" ]; then
    skip "komut kaydı okunamadı (Obsidian kapalı olabilir)"
  elif [ "$LIVE" = "$CLAIM" ]; then
    ok "çizim komutu: canlı ${LIVE} = iddia ${CLAIM}"
  else
    bad "çizim komutu sapması: canlı ${LIVE}, kılavuz ${CLAIM} — yeniden üret"
  fi
else
  skip "REST anahtarı/sertifikası yok"
fi

if [ -f "$EX_JSON" ]; then
  SLIVE=$(python3 -c "import json;print(len(json.load(open('$EX_JSON'))))")
  SCLAIM=$(grep -oE '<ExcalidrawSettings count="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  [ "$SLIVE" = "$SCLAIM" ] && ok "Excalidraw ayarı: canlı ${SLIVE} = iddia ${SCLAIM}" \
                           || bad "ayar sapması: canlı ${SLIVE}, kılavuz ${SCLAIM}"
else
  skip "Excalidraw data.json yok"
fi

# ---------------------------------------------------------------- S5  canvas JSON geçerliliği
head_ "S5  Vault'taki her .canvas geçerli mi  (bozuk tuval sessizce boş açılır)"
python3 - "$VAULT" <<'PY'
import json, sys, glob, os
vault = sys.argv[1]
files = sorted(glob.glob(os.path.join(vault, "**", "*.canvas"), recursive=True))
if not files:
    print("SKIP  vault'ta .canvas yok"); raise SystemExit(0)
# Yolu YAZDIR. Sadece dosya adi basmak, kok disindaki artiklari kok temiz sanmaya yol acti:
# brain'in sweepEmptyShells()'i onlari _index/attic/ altina supurmustu ve S11 gormedi.
rel = lambda p: os.path.relpath(p, vault)
bad = 0
for f in files:
    try:
        d = json.load(open(f, encoding="utf8"))
    except Exception as ex:
        print(f"FAIL  ayrıştırılamadı {rel(f)}: {ex}"); bad += 1; continue
    nodes = d.get("nodes", []); edges = d.get("edges", [])
    ids = [n.get("id") for n in nodes]
    if len(ids) != len(set(ids)):
        print(f"FAIL  {rel(f)}: node id'leri benzersiz değil"); bad += 1; continue
    known = set(ids)
    dangling = [e for e in edges if e.get("fromNode") not in known or e.get("toNode") not in known]
    if dangling:
        print(f"FAIL  {rel(f)}: {len(dangling)} kenar var olmayan node'a bağlı"); bad += 1; continue
    print(f"PASS  {rel(f)}: {len(nodes)} node, {len(edges)} kenar")
raise SystemExit(1 if bad else 0)
PY
if [ $? -eq 0 ]; then ok "tüm .canvas dosyaları geçerli"; else bad ".canvas doğrulaması düştü"; fi

# ---------------------------------------------------------------- S6  excalidraw dosya bütünlüğü
head_ "S6  Vault'taki her .excalidraw.md eklentinin beklediği yapıda mı"
python3 - "$VAULT" <<'PY'
import sys, glob, os, re
vault = sys.argv[1]
files = sorted(glob.glob(os.path.join(vault, "**", "*.excalidraw.md"), recursive=True))
if not files:
    print("SKIP  vault'ta .excalidraw.md yok"); raise SystemExit(0)
bad = 0
for f in files:
    body = open(f, encoding="utf8", errors="replace").read()
    has_fm = re.search(r"^---\s*$.*?excalidraw-plugin\s*:", body, re.S | re.M) is not None
    has_drawing = "## Drawing" in body
    fence = "compressed-json" if "```compressed-json" in body else ("json" if "```json" in body else None)
    if not (has_fm and has_drawing and fence):
        print(f"FAIL  {os.path.basename(f)}: frontmatter={has_fm} drawing={has_drawing} blok={fence}")
        bad += 1
    else:
        print(f"PASS  {os.path.basename(f)}: {fence}, {len(body)} B")
raise SystemExit(1 if bad else 0)
PY
if [ $? -eq 0 ]; then ok "tüm .excalidraw.md dosyaları yapısal olarak sağlam"; else bad "excalidraw doğrulaması düştü"; fi

# ---------------------------------------------------------------- S7  REST smoke
head_ "S7  Local REST API canlı mı  (pinlenmiş sertifika, -k YOK)"
if [ -n "$KEY" ] && [ -s "${CACHE}/obs-ca.pem" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --cacert "${CACHE}/obs-ca.pem" \
         -H "Authorization: Bearer ${KEY}" "https://127.0.0.1:${PORT}/vault/" --max-time 8)
  [ "$CODE" = "200" ] && ok "GET /vault/ -> 200 (port ${PORT}, TLS doğrulaması AÇIK)" \
                      || bad "GET /vault/ -> ${CODE} (Obsidian kapalı ya da anahtar geçersiz)"
else
  skip "REST anahtarı/sertifikası yok"
fi

# ---------------------------------------------------------------- S8  JSON şema
head_ "S8  XML -> JSON indirgenip şemaya karşı doğrulanıyor mu"
if [ -s "$XML" ] && [ -f "$SCHEMA" ] && [ -f "$REDUCE" ]; then
  if OUT=$(python3 "$REDUCE" "$XML" "$SCHEMA" 2>&1); then
    ok "$OUT"
  else
    bad "şema doğrulaması düştü:"; printf '%s\n' "$OUT" | sed 's/^/        /' | head -10
  fi
else
  skip "XML, şema ya da indirgeyici yok"
fi

# ---------------------------------------------------------------- S9  kapsam
head_ "S9  Her komut ve her ayar sınıflandırılmış mı"
if [ -s "$XML" ]; then
  CN=$(grep -oE '<SketchCommands count="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  CL=$(grep -cE '^\s*<Cmd id=' "$XML")
  [ "$CN" = "$CL" ] && ok "komut: iddia ${CN} = listelenen ${CL}, hepsi risk+kanıt sınıflı" \
                    || bad "komut kapsamı: iddia ${CN}, listelenen ${CL}"
  # grep -c cikti bulamayinca 1 ile doner; `|| echo 0` iki satir uretip karsilastirmayi bozuyordu.
  UNR=$(grep -cE '<Cmd id="[^"]*"[^>]*risk=""' "$XML"); [ -z "$UNR" ] && UNR=0
  [ "$UNR" -eq 0 ] && ok "risk sınıfı boş komut yok" || bad "${UNR} komutun risk sınıfı boş"
  SN=$(grep -oE '<ExcalidrawSettings count="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  SL=$(grep -cE '^\s*<Key name=' "$XML")
  [ "$SN" = "$SL" ] && ok "ayar: iddia ${SN} = gruplanan ${SL}" \
                    || bad "ayar kapsamı: iddia ${SN}, gruplanan ${SL}"
else
  skip "XML yok"
fi

# ---------------------------------------------------------------- S10 devir
head_ "S10 Çizim kılavuzu ile v3.0 arasında boşluk ya da çift kayıt var mı"
if [ -s "$XML" ] && [ -s "$SITEMAP" ]; then
  SITEN=$(grep -c . "$SITEMAP")
  MINE=$(grep -oE '<HelpPages count="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  DELEG=$(grep -oE 'delegated="[0-9]+"' "$XML" | grep -oE '[0-9]+' | head -1)
  SUM=$((MINE + DELEG))
  [ "$SUM" = "$SITEN" ] && ok "devir tam: çizim ${MINE} + devredilen ${DELEG} = sitemap ${SITEN}" \
                        || bad "devir tutmuyor: ${MINE}+${DELEG}=${SUM}, sitemap ${SITEN}"
  if [ -f "$SIBLING" ]; then
    # Ortusme yasak degil; GIZLI ortusme yasak. Iki kilavuzda da depth olan her sayfa
    # sharedWith + lens ile beyan edilmis olmali, yoksa okuyucu ayni isi iki kez okur.
    UNDECL=0; DECL=0
    for P in $(grep -oE '<Page path="[^"]+"' "$XML" | sed -E 's/.*path="([^"]+)".*/\1/'); do
      if grep -qE "<Page path=\"${P}\" class=\"depth\"" "$SIBLING"; then
        if grep -qE "<Page path=\"${P}\"[^>]*sharedWith=" "$XML"; then
          DECL=$((DECL+1))
        else
          bad "beyan edilmemiş örtüşme: ${P} her iki kılavuzda da depth ama sharedWith yok"
          UNDECL=$((UNDECL+1))
        fi
      fi
    done
    [ "$UNDECL" -eq 0 ] && ok "örtüşme gizli değil: ${DECL} sayfa sharedWith+lens ile beyan edilmiş"
  else
    skip "kardeş kılavuz yok: $SIBLING"
  fi
else
  skip "XML ya da sitemap yok"
fi

# ---------------------------------------------------------------- S11 sandbox artığı
head_ "S11 Ölçüm vault'ta iz bıraktı mı"
if [ -d "${VAULT}/_sandbox" ]; then
  bad "_sandbox/ duruyor: $(ls "${VAULT}/_sandbox" | tr '\n' ' ')"
else
  ok "_sandbox/ yok"
fi
# Acik sekmedeki dosyayi silmek numarali kopya uretiyordu (SB5). Kok taramasi YETMEZ: brain'in
# sweepEmptyShells()'i bos kabuklari _index/attic/ altina tasiyor, yani artik kokten kaybolur
# ama vault'ta kalir. TUM vault taranir.
STRAYLIST=$(find "${VAULT}" -name '*.canvas' 2>/dev/null | grep -E '/(Untitled|Başlıksız)( [0-9]+)?\.canvas$')
STRAY=$(printf '%s' "$STRAYLIST" | grep -c . )
[ "$STRAY" -eq 0 ] && ok "vault genelinde adsız/numaralı tuval artığı yok (attic dahil)" \
                   || bad "${STRAY} artık tuval: $(printf '%s' "$STRAYLIST" | sed "s|${VAULT}/||" | tr '\n' ' ')"
if [ -f "$REAL_DRAWING" ]; then
  H=$(shasum -a 256 "$REAL_DRAWING" | cut -c1-64)
  EXPECT="0d7199b7298b99fc216d60601dc1a6e26d1154b4e795ab8b142cbb2a291ccb0f"
  [ "$H" = "$EXPECT" ] && ok "Emre'nin çizimi değişmemiş (${H:0:12}…)" \
                       || bad "Emre'nin çizimi DEĞİŞMİŞ: ${H:0:12}… beklenen ${EXPECT:0:12}…"
else
  skip "referans çizim yok (taşınmış olabilir)"
fi

# ---------------------------------------------------------------- S12 kapının kendi dişi
head_ "S12 Kapı gerçekten düşebiliyor mu  (bozuk kopya reddedilmeli)"
# Basarisiz olamayan kapi hicbir sey kanitlamaz. Uc ayri bozma, uc ayri kapiya.
if [ -s "$XML" ]; then
  T1="${CACHE}/sketch-broken-xml.xml"; T2="${CACHE}/sketch-broken-sym.xml"; T3="${CACHE}/sketch-broken-schema.xml"
  # (a) XML kirilmis -> S1 reddetmeli
  sed 's|</Environment>||' "$XML" > "$T1"
  if xmllint --noout "$T1" 2>/dev/null; then bad "S1 dişsiz: bozuk XML kabul edildi"; else ok "S1 bozuk XML'i reddetti"; fi
  # (b) uydurma SYM konusu -> S3 reddetmeli
  sed 's|community.sketch-your-mind.com/t/722|community.sketch-your-mind.com/t/999999|' "$XML" > "$T2"
  BURL=$(grep -oE 'url="https://community\.sketch-your-mind\.com/t/999999"' "$T2" | head -1)
  if [ -n "$BURL" ]; then
    BCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 https://community.sketch-your-mind.com/t/999999)
    [ "$BCODE" = "404" ] && ok "S3 dişli: uydurma konu 404 veriyor, kapı düşerdi" \
                         || bad "S3 dişsiz: uydurma konu ${BCODE} verdi"
  else
    skip "S3 diş testi için bağlantı bulunamadı"
  fi
  # (c) tek secenekli karar -> S8 reddetmeli
  python3 - "$XML" "$T3" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf8").read()
# ilk Decision'in ikinci Option blogunu sil -> "tek secenekli karar karar degildir"
m = re.search(r'(<Decision id="SD1".*?</Decision>)', src, re.S)
if m:
    block = m.group(1)
    opts = re.findall(r'<Option .*?</Option>\n', block, re.S)
    if len(opts) >= 2:
        src = src.replace(block, block.replace(opts[1], ""), 1)
open(sys.argv[2], "w", encoding="utf8").write(src)
PY
  if python3 "$REDUCE" "$T3" "$SCHEMA" >/dev/null 2>&1; then
    bad "S8 dişsiz: tek seçenekli karar şemadan geçti"
  else
    ok "S8 dişli: tek seçenekli kararı reddetti"
  fi
  # (d) yinelenen adim id -> S8 reddetmeli. Sema bunu goremez; indirgeyicideki sayim gorur.
  T4="${CACHE}/sketch-broken-dupid.xml"
  python3 - "$XML" "$T4" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf8").read()
m = re.search(r'<Phase id="3".*?</Phase>', src, re.S)
if m:
    block = m.group(0)
    ids = re.findall(r'<Step id="([^"]+)"', block)
    if len(ids) >= 2:
        block2 = block.replace(f'<Step id="{ids[1]}"', f'<Step id="{ids[0]}"', 1)
        src = src.replace(block, block2, 1)
open(sys.argv[2], "w", encoding="utf8").write(src)
PY
  if python3 "$REDUCE" "$T4" "$SCHEMA" >/dev/null 2>&1; then
    bad "S8 dişsiz: yinelenen adım id kabul edildi"
  else
    ok "S8 dişli: yinelenen adım id'yi reddetti"
  fi
  rm -f "$T1" "$T2" "$T3" "$T4"
else
  skip "XML yok"
fi

# ---------------------------------------------------------------- özet
printf '\n\033[1mÖZET\033[0m  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || printf '\nKapı düştü. Kılavuz yanlış — düzelt ve yeniden üret:\n  python3 ~/Desktop/obsidian-sketch-gen.py\n'
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
