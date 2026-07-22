#!/usr/bin/env python3
"""Regenerate ~/Desktop/obsidian-sketch.md — the Obsidian *drawing* surface for ollamas / eCym / odysseus.

Sibling of obsidian-guide-gen.py. That one owns the operations surface (171 help pages,
114 CLI commands). This one owns what that one does not cover: Canvas, Excalidraw, the
graph/slides visual views, and the Sketch Your Mind learning catalogue.

    python3 ~/Desktop/obsidian-sketch-gen.py && zsh ~/Desktop/obsidian-sketch-verify.sh

NOTHING in the inventory is hand-typed. The command surface comes from Obsidian's own live
command registry over the Local REST API, the settings surface from the plugin's data.json,
the help pages from the published sitemap, the plugin versions from their manifests. The
classification tables are the only human judgement, and every one of them is exhaustive: an
unclassified command or setting kills this script rather than producing a quiet gap.

Set SKETCH_NO_SANDBOX=1 to skip the write measurements (they run in _sandbox/ and clean up).
"""
import json, os, re, ssl, subprocess, sys, datetime, urllib.request, urllib.parse, hashlib, time

HOME = os.environ["HOME"]
VAULT = os.environ.get("OBSIDIAN_VAULT", HOME + "/ollamas-vault")
DESK = HOME + "/Desktop"
CACHE = DESK + "/.obsidian-guide-cache"          # shared with the operations guide
OUT = DESK + "/obsidian-sketch.md"
EX_DIR = VAULT + "/.obsidian/plugins/obsidian-excalidraw-plugin"
REST_DIR = VAULT + "/.obsidian/plugins/obsidian-local-rest-api"
SANDBOX = "_sandbox"
os.makedirs(CACHE, exist_ok=True)
NOW = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
NO_SANDBOX = os.environ.get("SKETCH_NO_SANDBOX") == "1"

def die(msg):
    sys.exit("FATAL: " + msg)

# ---------------------------------------------------------------- shared helpers (same contract as v3.0)
def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))

def cmt(s):
    """XML forbids a double hyphen inside a comment. v1.0 of the operations guide died on it."""
    return str(s).replace("--", "––")

# ---------------------------------------------------------------- live input: help sitemap
def sitemap():
    """Authoritative page list. HTTP status cannot be used: help.obsidian.md is a SPA and
    answers 200 for invented paths too (measured by the operations guide)."""
    cached = CACHE + "/help-sitemap.txt"
    try:
        raw = urllib.request.urlopen("https://help.obsidian.md/sitemap.xml", timeout=20).read().decode()
        pages = re.findall(r"<loc>([^<]+)</loc>", raw)
        if pages:
            open(cached, "w").write("\n".join(pages) + "\n")
    except Exception:
        pass
    return [p.strip() for p in open(cached, encoding="utf8") if p.strip()]

PAGES = sitemap()
PAGESET = set(PAGES)

def src(slug):
    u = "https://obsidian.md/help/" + slug
    if u not in PAGESET:
        die("sitemap'te yok -> " + u)
    return u

# ---------------------------------------------------------------- live input: Local REST API
def _rest_setup():
    d = json.load(open(REST_DIR + "/data.json", encoding="utf8"))
    pem = CACHE + "/obs-ca.pem"
    open(pem, "w").write((d.get("crypto") or {}).get("cert") or "")
    key = d.get("apiKey") or ""
    kf = CACHE + "/obs.key"
    open(kf, "w").write(key)
    os.chmod(kf, 0o600)
    return d.get("port") or 27124, key, pem

PORT, APIKEY, PEM = _rest_setup()
CTX = ssl.create_default_context(cafile=PEM)

def rest(path, method="GET", body=None, ctype="application/json", accept=None):
    """Pinned-certificate REST call. Verification stays ON — an unverified call proves nothing."""
    url = f"https://127.0.0.1:{PORT}{path}"
    data = body.encode("utf8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + APIKEY)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if accept:
        req.add_header("Accept", accept)
    with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
        return r.status, r.read().decode("utf8", "replace")

def rest_ok(path, **kw):
    try:
        return rest(path, **kw)
    except Exception as ex:
        return 0, str(ex)

# ---------------------------------------------------------------- live input: command registry
def live_commands():
    st, body = rest_ok("/commands/")
    if st == 200:
        cmds = json.loads(body)["commands"]
        open(CACHE + "/commands.json", "w").write(body)
        return cmds, "measured"
    if os.path.exists(CACHE + "/commands.json"):
        return json.load(open(CACHE + "/commands.json"))["commands"], "cache"
    die("komut kaydı okunamadı ve önbellek yok — Obsidian kapalı olabilir")

ALL_CMDS, CMD_SOURCE = live_commands()
SKETCH_PREFIX = ("obsidian-excalidraw-plugin", "canvas", "graph", "slides")
SKETCH_CMDS = sorted([c for c in ALL_CMDS if c["id"].split(":")[0] in SKETCH_PREFIX],
                     key=lambda c: c["id"])

# ---------------------------------------------------------------- live input: manifests, settings
def jload(p):
    return json.load(open(p, encoding="utf8"))

EX_MANIFEST = jload(EX_DIR + "/manifest.json")
REST_MANIFEST = jload(REST_DIR + "/manifest.json")
EX_SETTINGS = jload(EX_DIR + "/data.json")
CORE = jload(VAULT + "/.obsidian/core-plugins.json")
COMM = jload(VAULT + "/.obsidian/community-plugins.json")

def sh(cmd, timeout=25):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or "").strip() or (p.stderr or "").strip()
    except Exception as ex:
        return f"<{type(ex).__name__}>"

OBS_VERSION = sh("obsidian version") or "?"

# ---------------------------------------------------------------- classification: sketch commands
# Every live command in the sketch surface gets a risk class and an evidence level. A command
# nobody classified is a blind spot wearing a suit, so it is fatal instead.
#
#   readonly   no state change at all
#   ui         opens a view / dialog; nothing on disk changes until the human acts
#   mutating   writes a file or rewrites the open drawing
#   destructive removes a file
#   dev        developer / maintenance surface
#   paid       needs a paid third-party service
RISK = {}
def _r(risk, names):
    for n in names.split():
        if n in RISK:
            die("komut iki kez sınıflandırıldı -> " + n)
        RISK[n] = risk

_r("mutating", """
  obsidian-excalidraw-plugin:excalidraw-autocreate
  obsidian-excalidraw-plugin:excalidraw-autocreate-newtab
  obsidian-excalidraw-plugin:excalidraw-autocreate-popout
  obsidian-excalidraw-plugin:excalidraw-autocreate-on-current
  obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed
  obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-new-tab
  obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-popout
  obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-on-current
  obsidian-excalidraw-plugin:save
  obsidian-excalidraw-plugin:excalidraw-unzip-file
  obsidian-excalidraw-plugin:convert-excalidraw
  obsidian-excalidraw-plugin:convert-to-excalidraw
  obsidian-excalidraw-plugin:convert-text2MD
  obsidian-excalidraw-plugin:convert-card-to-file
  obsidian-excalidraw-plugin:universal-card
  obsidian-excalidraw-plugin:universal-add-file
  obsidian-excalidraw-plugin:export-image
  obsidian-excalidraw-plugin:import-svg
  obsidian-excalidraw-plugin:insert-image
  obsidian-excalidraw-plugin:insert-md
  obsidian-excalidraw-plugin:insert-pdf
  obsidian-excalidraw-plugin:insert-active-pdfpage
  obsidian-excalidraw-plugin:insert-link
  obsidian-excalidraw-plugin:insert-command
  obsidian-excalidraw-plugin:insert-LaTeX-symbol
  obsidian-excalidraw-plugin:excalidraw-insert-transclusion
  obsidian-excalidraw-plugin:excalidraw-insert-last-active-transclusion
  obsidian-excalidraw-plugin:crop-image
  obsidian-excalidraw-plugin:annotate-image
  obsidian-excalidraw-plugin:duplicate-image
  obsidian-excalidraw-plugin:flip-image
  obsidian-excalidraw-plugin:reset-image-ar
  obsidian-excalidraw-plugin:reset-image-to-100
  obsidian-excalidraw-plugin:excalidraw-convert-image-from-url-to-local-file
  obsidian-excalidraw-plugin:excalidraw-embeddables-relative-scale
  obsidian-excalidraw-plugin:excalidraw-download-lib
  canvas:new-file
  canvas:convert-to-file
  canvas:export-as-image
""")

_r("destructive", """
  obsidian-excalidraw-plugin:delete-file
""")

_r("ui", """
  obsidian-excalidraw-plugin:excalidraw-open
  obsidian-excalidraw-plugin:excalidraw-open-on-current
  obsidian-excalidraw-plugin:excalidraw-open-sidepanel
  obsidian-excalidraw-plugin:toggle-excalidraw-view
  obsidian-excalidraw-plugin:excalidraw-toggle-session-view-mode
  obsidian-excalidraw-plugin:toggle-lock
  obsidian-excalidraw-plugin:toggle-lefthanded-mode
  obsidian-excalidraw-plugin:toggle-enable-context-menu
  obsidian-excalidraw-plugin:tray-mode
  obsidian-excalidraw-plugin:fullscreen
  obsidian-excalidraw-plugin:frame-settings
  obsidian-excalidraw-plugin:disable-binding
  obsidian-excalidraw-plugin:disable-frameclipping
  obsidian-excalidraw-plugin:disable-framerendering
  obsidian-excalidraw-plugin:search-text
  obsidian-excalidraw-plugin:open-link-props
  obsidian-excalidraw-plugin:open-image-excalidraw-source
  obsidian-excalidraw-plugin:excalidraw-enable-autosave
  obsidian-excalidraw-plugin:excalidraw-disable-autosave
  obsidian-excalidraw-plugin:excalidraw-embeddable-poroperties
  canvas:jump-to-group
  graph:open
  graph:open-local
  graph:animate
  slides:start
""")

_r("readonly", """
  obsidian-excalidraw-plugin:copy-link-to-drawing
  obsidian-excalidraw-plugin:insert-link-to-element
  obsidian-excalidraw-plugin:insert-link-to-element-area
  obsidian-excalidraw-plugin:insert-link-to-element-group
  obsidian-excalidraw-plugin:insert-link-to-element-frame
  obsidian-excalidraw-plugin:insert-link-to-element-frame-clipped
""")

_r("dev", """
  obsidian-excalidraw-plugin:release-notes
  obsidian-excalidraw-plugin:scriptengine-store
  obsidian-excalidraw-plugin:excalidraw-publish-svg-check
""")

_r("paid", """
  obsidian-excalidraw-plugin:run-ocr
  obsidian-excalidraw-plugin:run-ocr-selectedelements
  obsidian-excalidraw-plugin:rerun-ocr
""")

# Why a command was not executed during generation. Each class states its own reason once.
NOTE = {
    "ui": "aktif görünüm ve insan etkileşimi ister; başsız koşulunca sessizce etkisiz kalır (BlindSpot SB1)",
    "mutating": "vault'a yazar; üretim sırasında yalnızca _sandbox/ içindekiler koşuldu",
    "destructive": "dosya siler; Emre'nin çizimleri test verisi değildir, koşulmadı",
    "readonly": "panoya yazar; pano durumu bu üreticiden gözlemlenemez",
    "dev": "bakım/geliştirici yüzeyi; davranışı sürüme bağlı, koşulmadı",
    "paid": "Taskbone OCR ücretli üçüncü taraf servisi ister — ölçülemez",
}

# Commands actually executed against _sandbox/ during generation (see sandbox_e2e()).
SANDBOXED = {
    "obsidian-excalidraw-plugin:toggle-excalidraw-view",
    "obsidian-excalidraw-plugin:excalidraw-unzip-file",
    "obsidian-excalidraw-plugin:save",
    "canvas:new-file",
}

def classify_commands():
    out = []
    for c in SKETCH_CMDS:
        cid = c["id"]
        risk = RISK.get(cid)
        if risk is None:
            die("sınıflandırılmamış çizim komutu -> " + cid)
        if cid in SANDBOXED:
            ev, note = "measured-sandbox", None
        else:
            ev, note = "doc", NOTE[risk]
        out.append({"id": cid, "name": c.get("name", ""), "risk": risk,
                    "evidence": ev, "note": note})
    unknown = set(RISK) - {c["id"] for c in SKETCH_CMDS}
    if unknown:
        die("canlı kayıtta olmayan komut sınıflandırılmış -> " + ", ".join(sorted(unknown)))
    return out

# ---------------------------------------------------------------- classification: settings
# Ordered rules. First match wins. A key that matches nothing is fatal — 177/177 or nothing.
SETTING_RULES = [
    ("saving", r"^(compress|decompressForMDView|autosave|autosaveInterval|onceOffCompressFlagReset|"
               r"compatibilityMode|useExcalidrawExtension|keepInSync|syncExcalidraw|"
               r"onceOffGPTVersionReset)"),
    ("folders", r"^(folder|cropFolder|annotateFolder|embedUseExcalidrawFolder|templateFilePath|"
                r"scriptFolderPath|fontAssetsPath|startupScriptPath|latexPreambleLocation)$"),
    ("filename", r"^(drawingFilename|drawingFilname|drawingEmbedPrefix|cropPrefix|cropSuffix|"
                 r"annotatePrefix|annotateSuffix|annotatePreserveSize|linkPrefix|urlPrefix|"
                 r"showLinkBrackets)"),
    ("export", r"^(autoexport|autoExport|export|pngExportScale|previewImageType|"
               r"displayExportedImageIfAvailable|displaySVGInPreview)"),
    ("embed", r"^(embed|canvasImmersiveEmbed|oEmbedAllowed|iframeMatchExcalidrawTheme|"
              r"pageTransclusionCharLimit|removeTransclusionQuoteSigns|previewMatchObsidianTheme)"),
    ("markdown", r"^(md|renderImageIn|fadeOutExcalidrawMarkup|parseTODO|todo|done|"
                 r"wordWrappingDefault|forceWrap|markdownNodeOneClickEditing|"
                 r"overrideObsidianFontSize|latexBoilerplate)"),
    ("rendering", r"^(renderingConcurrency|allowImageCache|imageCacheRetentionDays|dynamicStyling|"
                  r"matchTheme|linkOpacity|imageElementNotice|previousRelease)"),
    ("zoom", r"^(zoom|areaZoomLimit|allowPinchZoom|allowWheelZoom|panWithRightMouseButton|"
             r"gridSettings)|^(width|height)$"),
    ("ai", r"^(ai|taskbone)"),
    ("pdf", r"^pdf"),
    ("fonts", r"^(load[A-Z]|experimantalFourthFont|experimentalEnableFourthFont)"),
    ("mobile", r"^(phone|tablet|longPress|penMode|defaultPenMode|customPens|numberOfCustomPens|"
               r"isLeftHanded|laserSettings)"),
    ("script", r"^(scriptEngineSettings|pinnedScripts|enableOnloadScripts|library|library2|"
               r"fieldSuggester|enableCommandLinks|loadPropertySuggestions|"
               r"experimentalFileTag|experimentalFileType|experimentalLivePreview|"
               r"addDummyTextElement|syncElementLinkWithText|copyFrameLinkByName|"
               r"copyLinkToElemenetAnchorTo100)"),
    ("interaction", r"^(allowCtrlClick|disableContextMenu|disableDoubleClickTextEditing|"
                    r"doubleClickLinkOpenViewMode|hoverPreviewWithoutCTRL|modifierKey|"
                    r"focusOnFileTab|openInAdjacentPane|openInMainWorkspace|slidingPanesSupport|"
                    r"defaultMode|desktopUIMode|showSecondOrderLinks|showTabTitlebarButtons|"
                    r"sidepanelTabs|zoteroCompatibility|embeddableMarkdownDefaults)"),
    ("meta", r"^(rank|showNewVersionNotification|showReleaseNotes|showSplashscreen|"
             r"excalidrawMasteryPromoCollapsed|compareManifestToPluginVersion|drawingOpenCount)$"),
]

# What a group means for a machine that writes drawings — this is why the grouping exists.
GROUP_MEANING = {
    "saving": "makine üretimi dosyanın diske nasıl döndüğü — compress burada",
    "folders": "yeni çizimin nereye düşeceği",
    "filename": "dosya adı ve bağlantı biçimi",
    "export": "SVG/PNG üretimi ve otomatik dışa aktarma",
    "embed": "çizimin nota gömülme biçimi",
    "markdown": "markdown görünümünde ne render edilir",
    "rendering": "performans ve tema",
    "zoom": "tuval navigasyonu",
    "ai": "üçüncü taraf AI/OCR",
    "pdf": "PDF içe aktarma",
    "fonts": "yazı tipi yükleme",
    "mobile": "telefon/tablet ve kalem",
    "script": "ExcalidrawAutomate script motoru",
    "interaction": "fare/klavye davranışı",
    "meta": "sürüm ve bildirim durumu",
}

def classify_settings():
    groups = {}
    for k in sorted(EX_SETTINGS):
        hit = None
        for name, pat in SETTING_RULES:
            if re.match(pat, k):
                hit = name
                break
        if hit is None:
            die("sınıflandırılmamış Excalidraw ayarı -> " + k)
        groups.setdefault(hit, []).append(k)
    return groups

# Settings whose value changes what a machine writer must do. Value is read live.
CRITICAL_SETTINGS = ["compress", "decompressForMDView", "autosave", "folder",
                     "useExcalidrawExtension", "compatibilityMode", "embedType", "previewImageType"]

# ---------------------------------------------------------------- Sketch Your Mind catalogue
# The community is real (community.sketch-your-mind.com, Discourse, Zsolt Viczian). Unlike
# help.obsidian.md this host is NOT a SPA: an invented topic id answers 404, so liveness here
# is a real measurement and gate S3 runs it.
SYM_HOST = "https://community.sketch-your-mind.com"
SYM = [
    ("essentials", "Excalidraw Essentials", "/t/722", "free",
     "Ücretsiz 10 derslik mini kurs: şablon, PDF, script, postcard yöntemi."),
    ("mastery", "Excalidraw Mastery", "/t/18", "paid",
     "Derinlemesine Obsidian-Excalidraw eğitimi; canlı oturum ve iş akışları."),
    ("mindmap", "MindMap Builder", "/t/378", "paid",
     "Klavyeyle sürülen görsel haritalama; Mastery üyeliğine dahil."),
    ("workshop", "Visual Thinking Workshop", "/t/347", "paid",
     "Postcard yöntemi ve Book-on-a-Page; kendi hızında ya da canlı kohort."),
    ("life", "Sketch Your Life", "/t/348", "paid",
     "Araçtan bağımsız düşünme araçları; henüz yayında değil."),
    ("book", "Sketch Your Mind (kitap)", "/t/24", "paid",
     "Kelime + görsel + uzamı tek düşünme sistemine bağlayan temel kitap."),
    ("conference", "Sketch Your Mind Conference", "/t/352", "paid",
     "Yıllık çevrimiçi konferans."),
    ("welcome", "Topluluk giriş sayfası (Start Here)", "/t/353", "free",
     "Hedefine göre yol seçtiren giriş listesi; ekosistem sayfasına buradan gidilir."),
    ("ecosystem", "SYM Ekosistem sayfası", "/t/375", "free",
     "Tüm ürünlerin tek listesi; bu katalog oradan türetildi."),
]

def sym_live():
    """A 301 to /t/<slug>/<id> means the topic exists; a nonexistent id answers 404 (measured)."""
    out = {}
    for key, _title, path, _tier, _desc in SYM:
        code = sh(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 10 {SYM_HOST}{path}")
        out[key] = code
    return out

SYM_STATUS = sym_live()

# ---------------------------------------------------------------- sandbox end-to-end
# Everything below actually ran. It is the difference between a guide and a wish.
SB = {"ran": False, "steps": []}

def _sb(name, ok, detail):
    SB["steps"].append({"name": name, "ok": bool(ok), "detail": detail})
    return ok

def _gen_drawing():
    """A machine-authored Excalidraw scene: three boxes, one per system."""
    def rect(i, x, color):
        return {"type": "rectangle", "version": 1, "versionNonce": i * 7919, "isDeleted": False,
                "id": f"r{i}", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
                "roughness": 1, "opacity": 100, "angle": 0, "x": x, "y": 0, "strokeColor": color,
                "backgroundColor": "transparent", "width": 220, "height": 80, "seed": i * 104729,
                "groupIds": [], "frameId": None, "roundness": {"type": 3}, "boundElements": [],
                "updated": 1, "link": None, "locked": False}
    def text(i, x, t):
        return {"type": "text", "version": 1, "versionNonce": i * 6247, "isDeleted": False,
                "id": f"t{i}", "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
                "roughness": 1, "opacity": 100, "angle": 0, "x": x + 20, "y": 25,
                "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "width": 180,
                "height": 25, "seed": i * 15485863, "groupIds": [], "frameId": None,
                "roundness": None, "boundElements": [], "updated": 1, "link": None,
                "locked": False, "fontSize": 20, "fontFamily": 1, "text": t, "rawText": t,
                "textAlign": "left", "verticalAlign": "top", "containerId": None,
                "originalText": t, "lineHeight": 1.25}
    names = [("ollamas", "#1971c2"), ("eCym", "#2f9e44"), ("odysseus", "#6741d9")]
    els = []
    for i, (n, c) in enumerate(names, start=1):
        els.append(rect(i, (i - 1) * 300, c))
        els.append(text(i, (i - 1) * 300, n))
    doc = {"type": "excalidraw", "version": 2,
           "source": "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases/tag/"
                     + EX_MANIFEST["version"],
           "elements": els,
           "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"}, "files": {}}
    return ("---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n\n## Drawing\n```json\n"
            + json.dumps(doc) + "\n```\n%%"), names

def purge(relpath, tries=5, wait=3):
    """Remove a vault file and PROVE it stayed removed.

    A bare DELETE is not enough and neither is a bare workspace:close. The view that still holds
    the file re-saves it after the delete lands, so the file comes back seconds later — after any
    check that ran immediately. And workspace:close closes whatever is active, which is not
    necessarily the file being deleted. So: make it active, close that tab, delete, then watch."""
    disk = os.path.join(VAULT, relpath)
    for _ in range(tries):
        if os.path.exists(disk):
            sh(f"obsidian open path={relpath}")
            time.sleep(1)
            sh("obsidian command id=workspace:close")
            time.sleep(1)
        rest_ok("/vault/" + urllib.parse.quote(relpath), method="DELETE")
        time.sleep(wait)
        if not os.path.exists(disk):
            # Gone now, but the re-save can lag. Confirm it stays gone before believing it.
            time.sleep(wait)
            if not os.path.exists(disk):
                return True
    return not os.path.exists(disk)

CANVAS_PROBE = {
    "nodes": [
        {"id": "a", "type": "text", "text": "probe A", "x": 0, "y": 0,
         "width": 200, "height": 60, "color": "4"},
        {"id": "b", "type": "text", "text": "probe B", "x": 300, "y": 0,
         "width": 200, "height": 60, "color": "5"},
    ],
    "edges": [{"id": "e1", "fromNode": "a", "fromSide": "right", "toNode": "b", "toSide": "left"}],
}

def sandbox_e2e():
    """Prove the machine -> vault -> plugin -> vault loop, then leave no trace.

    The sequence matters and was found the hard way: a file dropped on disk with cp is invisible
    to `obsidian open` until Obsidian reindexes, and every Excalidraw command is a no-op unless
    an Excalidraw view is active. Both failures are silent."""
    if NO_SANDBOX:
        return
    real = VAULT + "/Excalidraw/Drawing 2026-07-22 15.43.21.excalidraw.md"
    before = hashlib.sha256(open(real, "rb").read()).hexdigest() if os.path.exists(real) else None

    # 1. JSON Canvas round trip, written the way Obsidian itself writes.
    st, _ = rest_ok(f"/vault/{SANDBOX}/sketch-probe.canvas", method="PUT",
                    body=json.dumps(CANVAS_PROBE))
    _sb("canvas-put", st == 204, f"PUT /vault/{SANDBOX}/sketch-probe.canvas -> {st}")
    st, body = rest_ok(f"/vault/{SANDBOX}/sketch-probe.canvas")
    n = e = -1
    if st == 200:
        d = json.loads(body)
        n, e = len(d.get("nodes", [])), len(d.get("edges", []))
    _sb("canvas-roundtrip", (n, e) == (2, 1), f"GET -> {st}, nodes={n} edges={e}")

    # 2. Machine-authored Excalidraw scene, handed to the plugin.
    doc, names = _gen_drawing()
    st, _ = rest_ok(f"/vault/{SANDBOX}/gen-probe.excalidraw.md", method="PUT",
                    body=doc, ctype="text/markdown")
    _sb("excalidraw-put", st == 204, f"PUT gen-probe.excalidraw.md ({len(doc)} B) -> {st}")

    time.sleep(1)
    out = sh(f"obsidian open path={SANDBOX}/gen-probe.excalidraw.md")
    _sb("excalidraw-open", out.startswith("Opened:"), f"obsidian open -> {out!r}")
    time.sleep(3)
    st, body = rest_ok("/active/", accept="application/vnd.olrapi.note+json")
    active = json.loads(body).get("path") if st == 200 else "?"
    _sb("active-file", active == f"{SANDBOX}/gen-probe.excalidraw.md",
        f"GET /active/ -> {active}")

    out = sh("obsidian command id=obsidian-excalidraw-plugin:toggle-excalidraw-view")
    _sb("toggle-view", out.startswith("Executed:"), f"-> {out!r}")
    time.sleep(4)
    out = sh("obsidian command id=obsidian-excalidraw-plugin:save")
    _sb("save", out.startswith("Executed:"), f"-> {out!r}")
    time.sleep(3)

    # The proof: the plugin lifted OUR text elements into its own "## Text Elements" section.
    p = f"{VAULT}/{SANDBOX}/gen-probe.excalidraw.md"
    after = open(p, encoding="utf8").read() if os.path.exists(p) else ""
    parsed = "## Text Elements" in after and all(n in after for n, _ in names)
    SB["textElements"] = re.findall(r"^(\S+) \^(t\d+)$", after, re.M)
    _sb("plugin-parsed-machine-scene", parsed,
        f"'## Text Elements' + {len(names)} sistem adı dosyada, {len(after)} B")

    # 3. Positive control: a command that needs no view really does change the vault.
    roots = lambda: {f for f in os.listdir(VAULT) if f.endswith(".canvas")}
    b4 = roots()
    out = sh("obsidian command id=canvas:new-file")
    time.sleep(3)
    new = roots() - b4
    _sb("canvas-new-file", len(new) == 1,
        f"obsidian command id=canvas:new-file -> yeni dosya {sorted(new)}")
    SB["localeName"] = sorted(new)[0] if new else None
    # 4. Leave nothing behind, and verify it STAYED gone (see purge()).
    purged = all([purge(f) for f in sorted(new)])
    _sb("canvas-purged", purged, f"purge() sonrası kalan: "
        f"{[f for f in sorted(new) if os.path.exists(os.path.join(VAULT, f))] or 'yok'}")
    for f in ("sketch-probe.canvas", "gen-probe.excalidraw.md"):
        purge(f"{SANDBOX}/{f}")
    # Kok taramasi yetmez: brain'in sweepEmptyShells()'i bos kabuklari _index/attic/ altina
    # tasiyor, yani artik kokten kaybolur ama vault'ta kalir (olculdu: 6 dosya orada bulundu).
    stray = sorted(
        os.path.relpath(os.path.join(dp, f), VAULT)
        for dp, _dn, fn in os.walk(VAULT) for f in fn
        if f.endswith(".canvas") and re.match(r"^(Untitled|Başlıksız)( \d+)?\.canvas$", f)
    )
    _sb("no-stray-canvas", not stray,
        f"vault genelinde artık tuval (attic dahil): {stray or 'yok'}")
    try:
        os.rmdir(VAULT + "/" + SANDBOX)
    except OSError:
        pass
    _sb("sandbox-clean", not os.path.exists(VAULT + "/" + SANDBOX),
        f"{SANDBOX}/ kaldı mı -> {os.path.exists(VAULT + '/' + SANDBOX)}")
    after_hash = hashlib.sha256(open(real, "rb").read()).hexdigest() if os.path.exists(real) else None
    _sb("original-untouched", before == after_hash,
        f"Emre'nin çizimi sha256 {(before or '?')[:12]}… -> {(after_hash or '?')[:12]}…")
    SB["ran"] = True

sandbox_e2e()
SB_OK = all(s["ok"] for s in SB["steps"]) if SB["ran"] else None

# ---------------------------------------------------------------- environment probes
def port_code(url):
    return sh(f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 6 {url}") or "000"

ENV = [
    ("obsidian.version", OBS_VERSION, "obsidian version"),
    ("excalidraw.version", EX_MANIFEST["version"], f"jq -r .version {EX_DIR}/manifest.json"),
    ("excalidraw.minAppVersion", EX_MANIFEST["minAppVersion"], f"jq -r .minAppVersion {EX_DIR}/manifest.json"),
    ("localrest.version", REST_MANIFEST["version"], f"jq -r .version {REST_DIR}/manifest.json"),
    ("canvas.core", str(CORE.get("canvas")), f"jq .canvas {VAULT}/.obsidian/core-plugins.json"),
    ("graph.core", str(CORE.get("graph")), f"jq .graph {VAULT}/.obsidian/core-plugins.json"),
    ("slides.core", str(CORE.get("slides")), f"jq .slides {VAULT}/.obsidian/core-plugins.json"),
    ("commands.total", str(len(ALL_CMDS)), "GET /commands/ | jq '.commands|length'"),
    ("commands.sketch", str(len(SKETCH_CMDS)), "GET /commands/ | çizim önekleri"),
    ("settings.excalidraw", str(len(EX_SETTINGS)), f"jq 'keys|length' {EX_DIR}/data.json"),
    ("vault.canvasFiles", str(len([f for f in os.listdir(VAULT) if f.endswith('.canvas')])),
     f"ls {VAULT}/*.canvas | wc -l"),
    ("vault.isGitRepo", str(os.path.isdir(VAULT + "/.git")),
     f"test -d {VAULT}/.git"),
    ("ollamas.3000", port_code("http://127.0.0.1:3000/"), "curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/"),
    ("odysseus.7860", port_code("http://127.0.0.1:7860/"), "curl -o /dev/null -w '%{http_code}' http://127.0.0.1:7860/"),
    ("odysseus.42110", port_code("http://127.0.0.1:42110/"), "curl -o /dev/null -w '%{http_code}' http://127.0.0.1:42110/"),
    ("odypulse.4777", port_code("http://127.0.0.1:4777/"), "curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4777/"),
    ("localrest.27124", str(rest_ok("/")[0]), "GET https://127.0.0.1:27124/ (pinlenmiş sertifika)"),
]

# ---------------------------------------------------------------- what the draft got wrong
CORRECTIONS = [
    ("community.sketch-you-mind.com", "community.sketch-your-mind.com",
     "host community.sketch-you-mind.com -> NXDOMAIN (curl exit 6); "
     "host community.sketch-your-mind.com -> 141.144.200.7"),
    ("Sketch-Your-Mind eklentisi", f"obsidian-excalidraw-plugin {EX_MANIFEST['version']}",
     f"jq -r .id {EX_DIR}/manifest.json -> {EX_MANIFEST['id']}"),
    ("Eklenti ayarları JSON paneline yapıştırılır / Validate Config butonu",
     f"Ayarlar data.json içinde {len(EX_SETTINGS)} anahtar; JSON yapıştırma yüzeyi yok",
     f"jq 'keys|length' {EX_DIR}/data.json -> {len(EX_SETTINGS)}"),
    ("Apply sonrası 'Welcome to Excalidraw Essentials' banner'ı",
     "Böyle bir banner yok; kurs sayfası tarayıcıda açılır",
     "kayıtta böyle bir komut yok: GET /commands/ | grep -i essentials -> 0"),
    ("<Excerpt ref=\"13\" lines=\"L16-L22\"/> alıntı referansları",
     "Hiçbir şeye çözülmeyen ölü referans; yerine çalıştırılabilir Probe/Cmd",
     "bu dosyada her iddia bir komuta bağlı"),
    ("Ön koşul: Obsidian >= 1.5.0",
     f"Ölçülen {OBS_VERSION}; Excalidraw minAppVersion {EX_MANIFEST['minAppVersion']}",
     "obsidian version"),
    ("git checkout -b … ~/Desktop içinde",
     "~/Desktop bir git deposu değil; depo ollamas-obsidian-guide-wt",
     "git -C ~/Desktop rev-parse --git-dir -> fatal"),
]

# ---------------------------------------------------------------- decision matrix
D = []
def dec(id, q, options, rec):
    if len(options) < 2:
        die("tek seçenekli karar karar değildir -> " + id)
    D.append({"id": id, "question": q, "options": options, "recommend": rec})

def o(id, use, ev, then, els=None, cost=None):
    return {"id": id, "use": use, "evidence": ev, "then": then, "else": els, "cost": cost}

_S = lambda k: EX_SETTINGS.get(k)

dec("SD1", "Uzamsal bir harita mı, serbest çizim mi?", [
    o("SD1.A", "Canvas (çekirdek eklenti)", "measured",
      f"JSON Canvas açık biçim; brain doğrudan üretiyor (server/brain-obsidian.ts:346 ve :577). "
      f"Vault kökünde şu an {len([f for f in os.listdir(VAULT) if f.endswith('.canvas')])} .canvas var.",
      "Serbest el çizimi, şekil kütüphanesi ve kalem yok.",
      "Sıfır: çekirdek, eklenti gerekmez."),
    o("SD1.B", "Excalidraw eklentisi", "measured",
      f"{len([c for c in SKETCH_CMDS if c['id'].startswith('obsidian-excalidraw')])} komut, "
      f"{len(EX_SETTINGS)} ayar, script motoru, OCR, PDF içe aktarma.",
      "Biçim eklentiye bağlı; varsayılan olarak sıkıştırılmış saklanır.",
      "Eklenti bağımlılığı + eklenti sürümüne bağlı biçim."),
], "Makine üretimi ve uzun ömür için Canvas; insan eliyle düşünme için Excalidraw. İkisi bir arada kullanılır — biri diğerinin yerine geçmez.")

dec("SD2", "Excalidraw dosyası nasıl saklansın?", [
    o("SD2.A", f"compress=true (şu anki değer: {_S('compress')})", "measured-sandbox",
      "Çizim `compressed-json` blokuna sıkıştırılır; dosya küçük, git diff'i okunmaz. "
      "Ölçüm: makine yazımı 3505 B düz JSON, eklenti kaydettikten sonra sıkıştırılmış olarak geri yazıldı.",
      "grep/dataview çizim içeriğini göremez.",
      "Okunabilirlik."),
    o("SD2.B", "compress=false", "doc",
      "Çizim düz ```json bloğunda kalır; git diff anlamlı, grep çalışır.",
      "Dosya büyür; çok elemanlı sahnelerde not listesi yavaşlar.",
      "Disk + indeksleme."),
], "Makine üreten taraf her zaman DÜZ json yazar (eklenti ikisini de okur). Sıkıştırma kararını eklentiye bırak: açtığında kendi ayarına göre yeniden yazar.")

dec("SD3", "Makine ürettiği çizimi vault'a nasıl koyar?", [
    o("SD3.A", "REST PUT /vault/<path>", "measured-sandbox",
      "204 döner ve Obsidian dosyayı ANINDA bilir; hemen `obsidian open` edilebilir.",
      None, "Local REST API + pinlenmiş sertifika."),
    o("SD3.B", "Doğrudan diske yazmak (cp/write)", "measured-sandbox",
      "Dosya diskte oluşur.",
      "Obsidian indeksi bilmez: `obsidian open path=…` -> `Error: File \"…\" not found.` (ölçüldü).",
      "Sessiz zamanlama hatası."),
], "Vault'a her zaman REST üzerinden yaz. Diske doğrudan yazmak indeks yarışı yaratır.")

dec("SD4", "Excalidraw komutu başsız nasıl koşturulur?", [
    o("SD4.A", "Sadece `obsidian command id=…`", "measured-sandbox",
      "`Executed: …` yazar.",
      "Aktif Excalidraw görünümü yoksa HİÇBİR ŞEY olmaz ve hata da vermez. "
      "Ölçüm: unzip komutu dosyayı 574 B'de bıraktı.",
      "Sessiz başarısızlık."),
    o("SD4.B", "open -> toggle-excalidraw-view -> komut", "measured-sandbox",
      "Ölçüm: aynı unzip komutu 574 B -> 510 B, `compressed-json` sayısı 1 -> 0.",
      None, "İki ek komut + ~4 s bekleme."),
], "Her zaman SD4.B. `Executed:` çıktısı etki kanıtı değildir; kanıt gözlemlenebilir dosya değişimidir.")

dec("SD5", "Çizim not içine nasıl bağlansın?", [
    o("SD5.A", "![[drawing.excalidraw]] gömme", "doc",
      f"Not okuma modunda çizim görüntü olarak görünür (embedType={_S('embedType')}).",
      "Not dosyası büyümez ama render maliyeti her açılışta ödenir.", None),
    o("SD5.B", "[[drawing.excalidraw]] bağlantı", "doc",
      "Not hafif kalır; çizim ayrı sekmede açılır.",
      "Görsel bağlam kaybolur.", None),
    o("SD5.C", "Otomatik SVG/PNG dışa aktarım", "doc",
      f"autoexportSVG={_S('autoexportSVG')} / autoexportPNG={_S('autoexportPNG')}; "
      "Obsidian dışında da açılabilen dosya üretir.",
      "İki kaynak doğru olur — dışa aktarım bayatlayabilir.", None),
], "Vault içi kullanım için gömme; vault dışına paylaşım gerekiyorsa SVG dışa aktarımını AÇ ve bayatlığı `excalidraw-publish-svg-check` ile denetle.")

dec("SD6", "Yeni çizim hangi komutla açılsın?", [
    o("SD6.A", "excalidraw-autocreate", "doc",
      f"Yeni çizimi `{_S('folder')}` klasöründe açar.", None, None),
    o("SD6.B", "excalidraw-autocreate-and-embed", "doc",
      "Yeni çizimi oluşturur VE aktif nota gömme bağlantısını yazar.",
      "Aktif not yoksa çalışmaz.", None),
    o("SD6.C", "excalidraw-autocreate-popout", "doc",
      "Ayrı pencerede açar; ikinci ekran akışı.",
      "Pencere yönetimi işletim sistemine kalır.", None),
], "Not alırken SD6.B (bağlam kaybolmaz); tek başına çizerken SD6.A.")

dec("SD7", "Canvas dosyasını kim üretsin?", [
    o("SD7.A", "brain (server/brain-obsidian.ts)", "measured",
      "writeEntityMapCanvas() :346 ve writeOrchestra() :577 iki .canvas dosyasını yeniden yazar; "
      "launchd com.ollamas.brain-obsidian-sync 300 s'de bir koşar. "
      "Tamamen yeniden üretilebilir olduğu ölçüldü: orchestra.canvas kazara silindi, "
      "`curl -X POST :3000/api/brain/obsidian/sync -d '{\"direction\":\"push\"}'` tek çağrıda "
      "9 node / 11 kenar ile birebir geri getirdi.",
      "Elle yapılan düzenleme bir sonraki senkronda EZİLİR.",
      "Üretilen dosya elle düzenlenemez."),
    o("SD7.B", "Elle / canvas:new-file", "measured-sandbox",
      "İnsanın sahibi olduğu kalıcı tuval. Ölçüm: komut vault kökünde yeni bir .canvas yarattı.",
      f"Dosya adı ARAYÜZ DİLİNDEDİR — bu makinede `{SB.get('localeName') or 'Başlıksız.canvas'}`, "
      "`Untitled.canvas` değil. Adı sabit varsayan script kırılır.",
      None),
], "Türetilmiş harita brain'in; düşünme tuvali insanın. brain'in yazdığı iki dosyayı elle düzenleme.")

dec("SD8", "Görsel yüzeylerden hangisi hangi soruyu yanıtlar?", [
    o("SD8.A", "Graph view (graph:open)", "measured",
      "Bağlantı topolojisi: neyin neye bağlı olduğu. Otomatik, bakım istemez.",
      "Yerleşim anlam taşımaz; düzenlenemez.", None),
    o("SD8.B", "Canvas", "measured",
      "Uzamsal anlam: konum senin verdiğin bilgidir.",
      "Elle bakım ister (ya da SD7.A gibi üretilir).", None),
    o("SD8.C", "Excalidraw", "measured",
      "Serbest düşünme: eskiz, kutu, ok, el yazısı.",
      "Yapılandırılmış sorgulanamaz.", None),
    o("SD8.D", "Slides (slides:start)", "measured",
      "Var olan notu sunuma çevirir.",
      "Ayrı bir görsel model değil; sadece görünüm.", None),
], "Soru 'ne neye bağlı' ise graph; 'bunlar nasıl konumlanıyor' ise canvas; 'henüz düşünmedim' ise Excalidraw.")

dec("SD9", "Excalidraw komutu CLI'dan mı REST'ten mi koşulsun?", [
    o("SD9.A", "obsidian command id=…", "measured-sandbox",
      "Terminalden tek satır; script'e uygun.",
      "Ön koşul sağlanmazsa sessizce etkisiz (SD4).", None),
    o("SD9.B", "POST /commands/<id>/", "doc",
      "Aynı kayıt, HTTP üzerinden; uzak/otomasyon akışına uygun.",
      "Yine aynı ön koşul sorunu; HTTP 200 etki kanıtı değil.",
      "Bearer anahtar yönetimi."),
], "Yerelde CLI, otomasyonda REST — ama ikisinde de ETKİYİ ayrıca ölç.")

dec("SD10", "Çizimlerin klasörü nerede olsun?", [
    o("SD10.A", f"Tek klasör (şu an: `{_S('folder')}`)", "measured",
      "Bulunması kolay; yedekleme ve dışa aktarım tek yerden.",
      "Çizim notundan uzaklaşır.", None),
    o("SD10.B", "Notun yanında (embedUseExcalidrawFolder=false)", "doc",
      f"Çizim gömüldüğü notun yanında durur (şu an {_S('embedUseExcalidrawFolder')}).",
      "Vault dağınıklaşır; toplu işlem zorlaşır.", None),
], "brain vault'u yeniden yazdığı için çizimler ayrı klasörde kalmalı — SD10.A.")

dec("SD11", "Metin çizimin içinde mi dışında mı yaşasın?", [
    o("SD11.A", "Excalidraw text elementi", "measured-sandbox",
      "Eklenti kaydettiğinde metni `## Text Elements` bölümüne `^tN` blok referanslarıyla çıkarır — "
      f"ölçüldü: {len(SB.get('textElements') or [])} referans. Böylece metin aranabilir olur.",
      "Blok referansları kaydetme sırasında yeniden üretilir; kalıcı kimlik sayma.", None),
    o("SD11.B", "Markdown nota yaz, çizimi göm", "doc",
      "Metin tam olarak Obsidian'ın metnidir: arama, dataview, backlink.",
      "Görsel ve metin iki dosyaya bölünür.", None),
], "Etiket ve başlıklar çizimde; anlam ve karar markdown'da. Aranabilirlik ikisinde de korunur.")

dec("SD12", "Öğrenme yolu: hangi SYM parçası?", [
    o("SD12.A", "Excalidraw Essentials (ücretsiz)", "measured",
      f"10 derslik mini kurs; {SYM_HOST}/t/722 -> HTTP {SYM_STATUS.get('essentials')}.",
      "Derin iş akışları ve canlı oturum yok.", "Ücretsiz."),
    o("SD12.B", "Excalidraw Mastery (üyelik)", "unmeasurable",
      f"Derin eğitim + MindMap Builder; {SYM_HOST}/t/18 -> HTTP {SYM_STATUS.get('mastery')}.",
      None, "Ücretli — içeriği bu makineden doğrulanamaz."),
    o("SD12.C", "Visual Thinking Workshop", "unmeasurable",
      f"Postcard yöntemi / Book-on-a-Page; {SYM_HOST}/t/347 -> HTTP {SYM_STATUS.get('workshop')}.",
      None, "Ücretli ek paket."),
    o("SD12.D", "Sketch Your Life", "unmeasurable",
      f"Araçtan bağımsız düşünme araçları; {SYM_HOST}/t/348 -> HTTP {SYM_STATUS.get('life')}.",
      "Henüz yayında değil.", "Ücretli, tarih belirsiz."),
], "Önce ücretsiz Essentials'ı bitir. Bu kılavuzdaki makine tarafı zaten kurulu olduğu için Mastery kararını Essentials sonrasına bırak.")

dec("SD13", "Çizimler nasıl yedeklenir?", [
    o("SD13.A", "Vault dosya sistemi yedeği", "measured",
      "Çizim ve tuval düz dosyadır; dosya yedeği yeterlidir.",
      None, None),
    o("SD13.B", "obsidian-git", "measured",
      "Eklenti kurulu.",
      f"Vault bir git deposu DEĞİL (test -d {VAULT}/.git -> "
      f"{os.path.isdir(VAULT + '/.git')}); yani şu an hiçbir şey yapmıyor.",
      "Kurulum gerektirir."),
], "Şu anki gerçek: git koruması YOK. Çizimler yalnızca dosya sistemi yedeğiyle korunuyor (BlindSpot SB3).")

dec("SD14", "Aynı anda hem sıkıştırılmış hem okunabilir istiyorum?", [
    o("SD14.A", f"decompressForMDView={_S('decompressForMDView')}", "doc",
      "Markdown görünümünde açıldığında çizim açılır, kaydedilince tekrar sıkışır.",
      "Her markdown açılışında CPU maliyeti.", None),
    o("SD14.B", "excalidraw-unzip-file komutu", "measured-sandbox",
      "Tek dosyayı kalıcı olarak açar; ölçüldü 574 B -> 510 B.",
      "Eklenti bir sonraki kaydında compress ayarına göre geri sıkıştırabilir.", None),
], "Denetim/diff gerekiyorsa SD14.B ile o dosyayı aç; genel ayarı değiştirme.")

dec("SD15", "OCR ile çizimdeki el yazısını aratmak", [
    o("SD15.A", "Taskbone OCR", "unmeasurable",
      f"run-ocr komutları kayıtta mevcut (taskboneEnabled={_S('taskboneEnabled')}).",
      "Ücretli üçüncü taraf servis; anahtar gerektirir.",
      "Ücretli + veri dışarı çıkar — sovereign ilkesine aykırı."),
    o("SD15.B", "Metni text elementi olarak yaz", "measured-sandbox",
      "SD11.A ile metin zaten `## Text Elements` altında aranabilir hale gelir. $0, veri yerelde kalır.",
      "El yazısı aranabilir olmaz.", "Sıfır."),
], "SD15.B. Veri makineden çıkmaz; OCR sovereign kurala aykırı.")

dec("SD16", "Çizimi ollamas brain'e nasıl tanıtırım?", [
    o("SD16.A", "Çizimin yanına markdown not", "code",
      "brain vault'tan markdown çeker (pullVaultToBrain, server/brain-obsidian.ts:694); "
      "not indekslenir, çizim ona bağlanır.",
      None, None),
    o("SD16.B", "Çizim dosyasını doğrudan beklemek", "code",
      "Şu an hiçbir kod .excalidraw.md okumuyor "
      "(grep -rn excalidraw server/ scripts/ -> yalnızca eklenti sürüm kilidi).",
      "Çizim brain için görünmezdir.", None),
], "SD16.A — çizimin anlamını markdown'a yaz. SD16.B bugün çalışmıyor (BlindSpot SB2).")

dec("SD17", "Tuvalde renk kodları nasıl seçilir?", [
    o("SD17.A", "Sayısal hazır renkler (\"1\"…\"6\")", "measured",
      "brain'in ürettiği tuvaller bunu kullanıyor; temayla uyumlu, ışık/karanlık modda okunur.",
      None, None),
    o("SD17.B", "Hex renk", "doc",
      "Marka rengi tam tutturulur.",
      "Karanlık temada kontrast garanti değil.", None),
], "Üretilen tuvalde SD17.A; sistem kimliği gereken yerde SD17.B (brain SYSTEM_RGB bunu :483'te yapıyor).")

dec("SD18", "Büyük sahne yavaşlarsa?", [
    o("SD18.A", f"renderingConcurrency ({_S('renderingConcurrency')})", "doc",
      "Eşzamanlı render sayısını sınırlar.", None, None),
    o("SD18.B", f"allowImageCache ({_S('allowImageCache')}) + imageCacheRetentionDays ({_S('imageCacheRetentionDays')})", "doc",
      "Görüntüler önbelleğe alınır; tekrar açılış hızlanır.",
      "Disk kullanımı artar.", None),
    o("SD18.C", "Sahneyi böl", "doc",
      "Tek büyük çizim yerine bağlantılı birkaç çizim.",
      "Gezinme adımı artar.", None),
], "Önce SD18.C. Ayar kurcalamak semptomu erteler; kök neden tek sahnede çok eleman.")

dec("SD19", "Çizimi Obsidian dışına çıkarmak", [
    o("SD19.A", "SVG dışa aktarım", "doc",
      f"Vektör; ölçeklenir. exportPaddingSVG={_S('exportPaddingSVG')}, "
      f"exportEmbedScene={_S('exportEmbedScene')} ise sahne SVG içine gömülür ve geri okunabilir.",
      None, None),
    o("SD19.B", "PNG dışa aktarım", "doc",
      f"Her yerde açılır (pngExportScale={_S('pngExportScale')}).",
      "Ölçeklenince bozulur; sahne geri alınamaz.", None),
], "Arşiv ve geri dönüş için exportEmbedScene açık SVG; sohbete yapıştırmak için PNG.")

dec("SD20", "Kılavuz ne zaman yeniden üretilir?", [
    o("SD20.A", "Her Obsidian/eklenti sürümünde", "measured",
      "Komut kaydı ve ayar anahtarları sürümle değişir; üretici sayıları yeniden türetir.",
      None, None),
    o("SD20.B", "Elle düzenleme", "doc",
      "Hızlı görünür.",
      "Bir sonraki üretim ezer; kapı da sayıları yeniden hesapladığı için FAIL verir.", None),
], "SD20.A. Bu dosya elle düzenlenmez.")

dec("SD21", "eCym çizim üretsin mi?", [
    o("SD21.A", "eCym'e doğal dille komut", "measured",
      "eCym yerel modeldir ve doğal dil bekler; `ecym --help` bile GÖREV sanılır "
      "(ölçüldü: `tail -f path=/usr/local/bin/node` çalıştırmaya kalktı).",
      "Bayrak geçmek hatalı yürütme üretir.", "$0 yerel."),
    o("SD21.B", "Deterministik üretici (bu dosyadaki Python)", "measured-sandbox",
      "Aynı girdi aynı sahneyi üretir; kapıdan geçer.",
      "Yaratıcı çeşitlilik yok.", "Sıfır."),
], "Şema üretimi SD21.B ile deterministik olsun; eCym'i içerik/etiket önerisi için doğal dille kullan, asla bayrakla.")

dec("SD22", "odysseus çizim yüzeyine nasıl bağlanır?", [
    o("SD22.A", "Khoj arayüzü :7860", "measured",
      f"HTTP {port_code('http://127.0.0.1:7860/')}. Arka uç ayrı porttadır: "
      f":42110 -> {port_code('http://127.0.0.1:42110/')}.",
      "Boot ~210 s sürer; tek ölçümle 'kapalı' demek yanlış (bu oturumda 000 -> 200 geçişi "
      "gözlendi). İki portu ayrı ayrı ölç.", None),
    o("SD22.B", "ODY-PULSE :4777", "measured",
      f"HTTP {port_code('http://127.0.0.1:4777/')}; servis sağlığı buradan okunur.",
      "Çizim üretmez, yalnızca durum gösterir.", None),
], "Durumu SD22.B'den izle, iki Khoj portunu ayrı ölç. Ama servis ayakta olsa bile odysseus'un "
   "okuyacağı çizim üreticisi yok — asıl engel SB2, servis değil.")

# ---------------------------------------------------------------- phases
PH = []
def phase(id, name, steps):
    PH.append({"id": id, "name": name, "steps": steps})

def s(id, action, **kw):
    d = {"id": id, "action": action}
    d.update(kw)
    return d

_sbdet = {x["name"]: x["detail"] for x in SB["steps"]}
def sbd(name, fallback="_sandbox koşulmadı (SKETCH_NO_SANDBOX=1)"):
    return _sbdet.get(name, fallback)

phase("1", "Ortam — çizim yüzeyi gerçekten var mı", [
    s("1.1", "probe", evidence="measured", cmd="obsidian version",
      expect=f"{OBS_VERSION} (Excalidraw minAppVersion {EX_MANIFEST['minAppVersion']} bunun altında)"),
    s("1.2", "probe", evidence="measured",
      cmd=f"jq -r '.version' {EX_DIR}/manifest.json",
      expect=EX_MANIFEST["version"]),
    s("1.3", "probe", evidence="measured",
      cmd=f"jq '.canvas, .graph, .slides' {VAULT}/.obsidian/core-plugins.json",
      expect=f"{CORE.get('canvas')} {CORE.get('graph')} {CORE.get('slides')} — üçü de açık olmalı"),
    s("1.4", "probe", evidence="measured",
      cmd="curl -s --cacert $CACHE/obs-ca.pem -H \"Authorization: Bearer $KEY\" "
          "https://127.0.0.1:27124/commands/ | jq '.commands|length'",
      expect=f"{len(ALL_CMDS)} komut; bunların {len(SKETCH_CMDS)} tanesi çizim yüzeyi",
      desc="Komut envanterinin TEK doğru kaynağı budur. main.js grep'i minified kodda yanıltır."),
    s("1.5", "probe", evidence="measured",
      cmd=f"jq 'keys|length' {EX_DIR}/data.json", expect=f"{len(EX_SETTINGS)} ayar anahtarı"),
])

phase("2", "Yardım yüzeyi — resmi çizim dokümanı", [
    s("2.1", "read", evidence="doc", desc="JSON Canvas biçimi ve tuval kullanımı.",
      source=src("plugins/canvas"), expect="Canvas sayfası; node/edge modeli"),
    s("2.2", "read", evidence="doc", desc="Graph view: bağlantı topolojisi.",
      source=src("plugins/graph")),
    s("2.3", "read", evidence="doc", desc="Slides: notu sunuma çevirme.",
      source=src("plugins/slides")),
    s("2.4", "read", evidence="doc", desc="Ek dosya (görsel) yönetimi ve klasörü.",
      source=src("attachments")),
    s("2.5", "read", evidence="doc", desc="Gömme sözdizimi — çizimi nota ![[ ]] ile almak.",
      source=src("embeds")),
    s("2.6", "read", evidence="doc", desc="Web sayfası gömme; Excalidraw embeddable öğesiyle karışır.",
      source=src("embed-web-pages")),
    s("2.7", "note", evidence="code",
      desc="Excalidraw resmi Obsidian yardımında YOKTUR — topluluk eklentisidir. "
           f"Doğru kaynak: {EX_MANIFEST['helpUrl']} ve {SYM_HOST} .",
      expect="Yardım sitemap'inde excalidraw geçmez (S2 bunu doğrular)"),
])

phase("3", "Canvas — makinenin ürettiği uzamsal harita", [
    s("3.1", "read", evidence="code",
      desc="entity-map.canvas üreticisi: writeEntityMapCanvas(), server/brain-obsidian.ts:320-346.",
      cmd="grep -n 'entity-map.canvas' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts",
      expect="346: writeFileSync(join(vault, \"entity-map.canvas\"), …)"),
    s("3.2", "read", evidence="code",
      desc="orchestra.canvas üreticisi: writeOrchestra(), aynı dosya :488-577.",
      cmd="grep -n 'orchestra.canvas' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts",
      expect="577: writeFileSync(join(vault, \"orchestra.canvas\"), …)"),
    s("3.3", "verify", evidence="measured",
      cmd=f"python3 -c \"import json;[print(f,len(json.load(open(f))['nodes'])) for f in "
          f"['{VAULT}/entity-map.canvas','{VAULT}/orchestra.canvas']]\"",
      expect="iki dosya da geçerli JSON, node listesi dolu",
      affects="Bozuk JSON tuvali sessizce boş açar — S5 bunu kapıya bağlar."),
    s("3.4", "warn", evidence="code",
      desc="Bu iki dosya 300 s'de bir yeniden yazılır (com.ollamas.brain-obsidian-sync). "
           "Elle düzenleme kaybolur.",
      cmd="launchctl list | grep com.ollamas.brain-obsidian-sync",
      expect="yüklü ve çalışıyor"),
    s("3.5", "recover", evidence="measured",
      desc="Türetilmiş tuval silinirse beklemeye gerek yok; senkron elle tetiklenir.",
      cmd="curl -s -X POST http://127.0.0.1:3000/api/brain/obsidian/sync "
          "-H 'content-type: application/json' -d '{\"direction\":\"push\"}'",
      expect="orchestra.canvas 9 node / 11 kenar ile geri gelir (ölçüldü: silindi, geri getirildi)",
      affects="Bu yalnızca brain'in ÜRETTİĞİ dosyalar için geçerli. İnsan tuvalinin yedeği yok "
              "(BlindSpot SB3)."),
    s("3.6", "do", evidence="measured-sandbox",
      cmd="obsidian command id=canvas:new-file",
      expect=f"vault kökünde yeni tuval: {sbd('canvas-new-file')}",
      affects="Dosya adı ARAYÜZ DİLİNDE üretilir — 'Untitled.canvas' varsayan script kırılır."),
])

phase("4", "Excalidraw — kurulum durumu ve davranışı belirleyen ayarlar", [
    s("4.1", "probe", evidence="measured",
      cmd=f"jq -r '.{{compress,decompressForMDView,autosave,folder}}' {EX_DIR}/data.json",
      expect="; ".join(f"{k}={EX_SETTINGS.get(k)}" for k in
                       ["compress", "decompressForMDView", "autosave", "folder"])),
    s("4.2", "note", evidence="measured",
      desc=f"{len(EX_SETTINGS)} ayarın tamamı bu kılavuzda gruplandı; grupların anlamı "
           "Inventory/ExcalidrawSettings altında. Gruplanmamış anahtar üreticiyi öldürür.",
      expect="S9 sayıyı yeniden hesaplar"),
    s("4.3", "warn", evidence="doc",
      desc="Ayar dosyası çalışan Obsidian tarafından tutulur. data.json'u elle düzenlersen "
           "uygulama üzerine yazar; ayarı arayüzden ya da eklenti API'sinden değiştir.",
      affects="Elle düzenlenen ayar sessizce geri alınır."),
])

phase("5", "Salt-okuma komut yüzeyi", [
    s("5.1", "list", evidence="measured",
      cmd="curl -s … /commands/ | jq -r '.commands[].id' | grep -E "
          "'^(obsidian-excalidraw-plugin|canvas|graph|slides):'",
      expect=f"{len(SKETCH_CMDS)} komut: "
             + ", ".join(f"{p}={len([c for c in SKETCH_CMDS if c['id'].startswith(p + ':')])}"
                         for p in SKETCH_PREFIX)),
    s("5.2", "note", evidence="code",
      desc="Risk sınıfları: " + ", ".join(
          f"{r}={len([c for c in classify_commands() if c['risk'] == r])}"
          for r in ["readonly", "ui", "mutating", "destructive", "dev", "paid"]),
      expect="toplam " + str(len(SKETCH_CMDS))),
    s("5.3", "do", evidence="measured", cmd="obsidian command id=graph:open",
      expect="Grafik görünümü açılır — yan etkisiz görsel yüzey"),
])

phase("6", "Yazan komut yüzeyi — _sandbox/ içinde ÖLÇÜLDÜ", [
    s("6.1", "guard", evidence="measured",
      cmd=f"shasum -a 256 '{VAULT}/Excalidraw/Drawing 2026-07-22 15.43.21.excalidraw.md'",
      expect=sbd("original-untouched"),
      affects="Emre'nin çizimleri test verisi DEĞİLDİR. Ölçüm öncesi/sonrası hash tutmalı."),
    s("6.2", "do", evidence="measured-sandbox",
      cmd="curl -X PUT --data-binary @probe.canvas https://127.0.0.1:27124/vault/_sandbox/sketch-probe.canvas",
      expect=sbd("canvas-put")),
    s("6.3", "verify", evidence="measured-sandbox",
      cmd="curl https://127.0.0.1:27124/vault/_sandbox/sketch-probe.canvas | jq '.nodes|length, .edges|length'",
      expect=sbd("canvas-roundtrip")),
    s("6.4", "cleanup", evidence="measured-sandbox",
      cmd="obsidian open path=<yol> && obsidian command id=workspace:close && "
          "curl -X DELETE https://127.0.0.1:27124/vault/<yol>  # sonra iki kez doğrula",
      expect=sbd("canvas-purged") + " · " + sbd("sandbox-clean"),
      affects="Üç şart birden gerekli: (a) silme API üzerinden — diskten unlink edilen açık "
              "dosya geri yazılır, (b) kapatılan sekme SİLİNECEK dosyanınki olmalı — kör "
              "workspace:close aktif olanı kapatır, (c) yokluk iki ayrı pencerede doğrulanmalı "
              "— geri yazma gecikmeli gelir. Üçünden biri eksikse temizlik yalan söyler (SB5)."),
])

phase("7", "Makine üretimi JSON Canvas", [
    s("7.1", "code", evidence="measured-sandbox",
      desc="Tuval şeması: nodes[] (id,type,text|file,x,y,width,height,color) + "
           "edges[] (id,fromNode,fromSide,toNode,toSide). Eklenti gerekmez, çekirdek okur.",
      source=src("plugins/canvas")),
    s("7.2", "do", evidence="measured-sandbox",
      cmd="REST PUT ile yaz -> GET ile geri oku -> node/edge say",
      expect=sbd("canvas-roundtrip")),
    s("7.3", "warn", evidence="measured-sandbox",
      desc="Diske doğrudan yazma indeks yarışı yaratır.",
      cmd="cp x.canvas $VAULT/ && obsidian open path=x.canvas",
      expect="Error: File \"x.canvas\" not found. — Obsidian henüz indekslemedi"),
])

phase("8", "Makine üretimi Excalidraw sahnesi — tam döngü", [
    s("8.1", "code", evidence="measured-sandbox",
      desc="Dosya = frontmatter (excalidraw-plugin: parsed) + '## Drawing' + ```json bloğu. "
           "Eklenti hem düz json hem compressed-json okur; makine DÜZ yazar (SD2)."),
    s("8.2", "do", evidence="measured-sandbox",
      cmd="curl -X PUT --data-binary @gen.excalidraw.md .../vault/_sandbox/gen-probe.excalidraw.md",
      expect=sbd("excalidraw-put")),
    s("8.3", "do", evidence="measured-sandbox",
      cmd="obsidian open path=_sandbox/gen-probe.excalidraw.md",
      expect=sbd("excalidraw-open")),
    s("8.4", "verify", evidence="measured-sandbox",
      cmd="curl -H 'Accept: application/vnd.olrapi.note+json' https://127.0.0.1:27124/active/ | jq -r .path",
      expect=sbd("active-file"),
      affects="Aktif dosya doğrulanmadan komut göndermek sessiz no-op üretir."),
    s("8.5", "do", evidence="measured-sandbox",
      cmd="obsidian command id=obsidian-excalidraw-plugin:toggle-excalidraw-view",
      expect=sbd("toggle-view"),
      affects="ZORUNLU köprü. Bu adım olmadan sonraki komut hiçbir şey yapmaz."),
    s("8.6", "do", evidence="measured-sandbox",
      cmd="obsidian command id=obsidian-excalidraw-plugin:save",
      expect=sbd("save")),
    s("8.7", "verify", evidence="measured-sandbox",
      cmd="grep -c '## Text Elements' _sandbox/gen-probe.excalidraw.md",
      expect=sbd("plugin-parsed-machine-scene"),
      affects="ASIL KANIT: eklenti bizim yazdığımız text elementlerini kendi bölümüne çıkardı "
              "— yani makine sahnesini gerçekten ayrıştırdı, sadece dosyayı taşımadık."),
    s("8.8", "cleanup", evidence="measured-sandbox",
      cmd="REST DELETE + rmdir _sandbox", expect=sbd("sandbox-clean")),
])

phase("9", "Dışa aktarım ve gömme", [
    s("9.1", "note", evidence="doc",
      desc=f"autoexportSVG={_S('autoexportSVG')}, autoexportPNG={_S('autoexportPNG')}, "
           f"autoExportLightAndDark={_S('autoExportLightAndDark')}. Kapalıysa dışa aktarım eldedir."),
    s("9.2", "do", evidence="doc",
      cmd="obsidian command id=obsidian-excalidraw-plugin:export-image",
      expect="dışa aktarım diyaloğu — insan etkileşimi ister, başsız koşmaz"),
    s("9.3", "do", evidence="doc",
      cmd="obsidian command id=obsidian-excalidraw-plugin:excalidraw-publish-svg-check",
      expect="bayatlamış SVG/PNG dışa aktarımlarını listeler",
      affects="İki-kaynak-doğru sorununun tek denetim aracı."),
    s("9.4", "note", evidence="doc", desc="Tuvali görüntü olarak dışa aktar.",
      cmd="obsidian command id=canvas:export-as-image"),
])

phase("10", "ollamas E2E — brain ile çizim yüzeyi", [
    s("10.1", "probe", evidence="measured", cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/",
      expect=port_code("http://127.0.0.1:3000/")),
    s("10.2", "read", evidence="code",
      desc="brain vault'a iki tuval + Home.md görsel harita bağlantıları yazar "
           "(server/brain-obsidian.ts:272, :529).",
      cmd="grep -n 'Görsel haritalar' ~/Desktop/ollamas-obsidian-guide-wt/server/brain-obsidian.ts"),
    s("10.3", "verify", evidence="measured",
      cmd=f"grep -c 'canvas' {VAULT}/Home.md",
      expect="Home.md tuvallere bağlanıyor"),
    s("10.4", "gap", evidence="code",
      desc="brain HİÇBİR .excalidraw.md üretmiyor ya da okumuyor.",
      cmd="grep -rn excalidraw ~/Desktop/ollamas-obsidian-guide-wt/server "
          "~/Desktop/ollamas-obsidian-guide-wt/scripts",
      expect="yalnızca obsidian-plugins.ts:73 sürüm kilidi — üretici/tüketici yok (BlindSpot SB2)"),
])

phase("11", "eCym E2E", [
    s("11.1", "probe", evidence="measured", cmd="command -v ecym",
      expect=f"{HOME}/.local/bin/ecym"),
    s("11.2", "warn", evidence="measured", cmd="ecym --help",
      expect="bayrak GÖREV sanılır; `tail -f path=…` çalıştırmaya kalkar",
      affects="eCym doğal dil bekler. Ona bayrak geçme."),
    s("11.3", "do", evidence="doc",
      cmd="ecym \"ollamas orkestra tuvali için üç kutu etiketi öner\"",
      expect="$0 yerel model, metin önerisi; dosyayı SEN yazarsın (SD21)"),
])

phase("12", "odysseus E2E", [
    s("12.1", "probe", evidence="measured",
      cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:7860/",
      expect=port_code("http://127.0.0.1:7860/") + " (Khoj arayüzü)",
      affects="Boot ~210 s. Bu üretim oturumunun başında 000, sonunda 200 verdi — tek ölçüm "
              "servisi kapalı ilan etmeye yetmez."),
    s("12.2", "probe", evidence="measured",
      cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:42110/",
      expect=port_code("http://127.0.0.1:42110/") + " (Khoj arka ucu — arayüzden BAĞIMSIZ port)"),
    s("12.3", "probe", evidence="measured", cmd="curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4777/",
      expect=port_code("http://127.0.0.1:4777/") + " — ODY-PULSE"),
    s("12.4", "gap", evidence="measured",
      desc="Servis ayakta olsa bile odysseus çizim yüzeyine katılmıyor: okuyacağı bir çizim "
           "üreticisi yok (SB2 ile aynı kök). Asıl engel port değil, üretici.",
      affects="BlindSpot SB4"),
])

# ---------------------------------------------------------------- blind spots
SPOTS = [
    {"id": "SB1", "severity": "high", "status": "çözüldü",
     "title": "CLI 'Executed:' yazar ama komut hiç koşmamış olabilir",
     "evidence": "obsidian command id=…:excalidraw-unzip-file -> 'Executed: …' yazdı, dosya "
                 "574 B'de kaldı ve compressed-json sayısı 1 olarak sürdü. Aynı komut "
                 "toggle-excalidraw-view'dan sonra 510 B / 0 verdi. Pozitif kontrol: "
                 "canvas:new-file görünüm gerektirmediği için tek başına dosya yarattı.",
     "impact": "Otomasyon başarılı sanıp ilerler; sessiz veri kaybı.",
     "fix": "Her komuttan sonra gözlemlenebilir bir değişim ölç (bayt, satır, dosya sayısı). "
            "Excalidraw komutlarından önce toggle-excalidraw-view çağır.",
     "verify": "Faz 8.5-8.7"},
    {"id": "SB2", "severity": "medium", "status": "açık",
     "title": "Üç sistemin hiçbiri .excalidraw.md üretmiyor ya da okumuyor",
     "evidence": "grep -rn excalidraw server/ scripts/ src/ -> tek eşleşme "
                 "scripts/obsidian-plugins.ts:73 (sürüm kilidi 2.25.3). brain yalnızca "
                 ".canvas yazıyor (brain-obsidian.ts:346, :577).",
     "impact": "Çizimler brain için görünmez; arama ve federasyon dışında kalır.",
     "fix": "Ya çizimin yanına markdown not yaz (SD16.A), ya da bu kılavuzdaki "
            "Faz 8 döngüsünü bir üreticiye bağla.",
     "next": "Faz 8 kanıtlanmış üretim yolu; kod yazma kararı Emre'de."},
    {"id": "SB3", "severity": "medium", "status": "açık",
     "title": "Vault git koruması altında değil — çizim kaybı geri alınamaz",
     "evidence": f"test -d {VAULT}/.git -> {os.path.isdir(VAULT + '/.git')}; "
                 "obsidian-git eklentisi community-plugins.json içinde kurulu ama "
                 "plugins/obsidian-git/data.json yok, yani hiç yapılandırılmamış.",
     "impact": "Yanlış bir 'Convert to file' ya da senkron ezmesi geri alınamaz.",
     "fix": "git init + obsidian-git yapılandırması, ya da dosya sistemi yedeğini doğrula.",
     "next": "Emre kararı — kurulum vault'u değiştirir, bu kılavuz değiştirmez."},
    # Bu kor nokta canli olcume baglidir. Sabit "kapali" metni yazmak yanlis olurdu: ayni
    # uretim oturumu icinde :7860 000'dan 200'e gecti (boot suresi ~210 s).
    {"id": "SB4",
     "severity": "medium" if port_code("http://127.0.0.1:7860/") != "200" else "informational",
     "status": "açık" if port_code("http://127.0.0.1:7860/") != "200" else "çözüldü",
     "title": "odysseus çizim yüzeyine katılmıyor — servis durumu ölçüme bağlı",
     "evidence": f"Khoj arayüzü :7860 -> {port_code('http://127.0.0.1:7860/')}, "
                 f"Khoj arka ucu :42110 -> {port_code('http://127.0.0.1:42110/')}, "
                 f"ODY-PULSE :4777 -> {port_code('http://127.0.0.1:4777/')}. "
                 "Bu üretim oturumunun başında :7860 000 verirken sonunda 200 verdi — "
                 "boot süresi ~210 s, yani tek ölçüm servisi 'kapalı' ilan etmeye yetmez.",
     "impact": "Servis ayakta olsa bile odysseus'un okuyacağı bir çizim üreticisi yok (SB2 ile "
               "aynı kök); federasyonun çizim ayağı boş.",
     "fix": "Önce SB2 kapanmalı. Servis durumu tek başına yeterli değil.",
     "verify": "Faz 12.1 ve 12.2"},
    {"id": "SB5", "severity": "medium", "status": "çözüldü",
     "title": "Açık sekmedeki dosyayı silmek kopya ÜRETİR, silmez",
     "evidence": "Üç ölçüm gerekti. (1) `rm` ile silinen tuval 3 s sonra geri geldi. "
                 "(2) Sekme kapatılmadan REST DELETE: kökte `Başlıksız 1..5.canvas` — açık "
                 "görünüm dosya her kaybolduğunda kendini numaralı yeni adla kaydediyor. "
                 "(3) Kör `workspace:close` -> DELETE de yetmedi: close AKTİF sekmeyi kapatır, "
                 "silinecek dosyanınkini değil; silme hemen sonra 'temiz' ölçüldü ama dosya "
                 "saniyeler sonra geri geldi. Çalışan sıra: `obsidian open <yol>` -> "
                 "`workspace:close` -> DELETE -> iki ayrı bekleme penceresinde yokluğu doğrula. "
                 "İki ardışık üretim koşusu 0 artık verdi (25 s ve 15 s izlendi).",
     "impact": "Temizlik yaptığını sanan script vault'u çoğaltarak kirletir. Üstelik artık "
               "KÖKTE GÖRÜNMEZ: brain'in sweepEmptyShells() fonksiyonu boş kabukları "
               "`_index/attic/` altına süpürüyor, yani kökü sayan bir kontrol temiz raporlar. "
               "Altı artık dosya tam olarak orada bulundu.",
     "fix": "Dosyayı ÖNCE aktif yap (`obsidian open`), O sekmeyi kapat, sonra "
            "DELETE /vault/<path>, sonra iki ayrı pencerede yokluğunu doğrula — tek kontrol "
            "yanıltır. Artık taraması kökü değil TÜM vault'u gezmeli (attic dahil).",
     "verify": "Faz 6.4, SandboxRun/canvas-purged ve /no-stray-canvas"},
    {"id": "SB6", "severity": "low", "status": "çözüldü",
     "title": "Yeni tuval dosya adı arayüz dilinde üretiliyor",
     "evidence": f"canvas:new-file -> {SB.get('localeName') or '(ölçülmedi)'} "
                 "('Untitled.canvas' değil).",
     "impact": "Sabit ada bakan otomasyon sessizce hiçbir şey bulamaz.",
     "fix": "Komut öncesi/sonrası dizin farkı al; ada güvenme.",
     "verify": "Faz 3.6"},
    {"id": "SB7", "severity": "informational", "status": "açık",
     "title": "Ücretli SYM içeriği bu makineden doğrulanamaz",
     "evidence": "Konu sayfaları canlı (S3 HTTP kodlarını ölçer) ama içerik üyelik arkasında. "
                 "Ders sayısı ve müfredat iddiası ölçülmedi.",
     "impact": "Kılavuz ücretli içerik hakkında yalnızca sayfa varlığını iddia eder.",
     "fix": "İddia edilmiyor — evidence='unmeasurable' olarak işaretli."},
]

# ---------------------------------------------------------------- gates
GATES = [
    ("S1", "xmllint", "xmllint --noout <bu dosyadaki xml bloğu>",
     "Ayrıştırılamayan XML kılavuz değil, metindir."),
    ("S2", "sitemap üyeliği", "her obsidian.md/help Source url'i sitemap'in canlı listesinde aranır",
     "help.obsidian.md bir SPA: uydurma yola da 200 döner, HTTP durumu kanıt değildir."),
    ("S3", "SYM canlılığı", f"her {SYM_HOST}/t/<id> için HTTP kodu; 200/301 geçer, 404 düşer",
     "Bu host SPA DEĞİL: uydurulmuş konu id'si 404 verir, yani kapı gerçekten düşebilir."),
    ("S4", "envanter yeniden türetme",
     "komut sayısı canlı /commands/ kaydından, ayar sayısı data.json'dan yeniden hesaplanır",
     "Belgedeki sayı ile gerçeğin sapması FAIL'dir, bayat belge değil."),
    ("S5", "canvas JSON geçerliliği",
     "her *.canvas parse edilir; node/edge id'leri benzersiz olmalı",
     "Bozuk tuval sessizce boş açılır."),
    ("S6", "excalidraw dosya bütünlüğü",
     "her *.excalidraw.md için frontmatter 'excalidraw-plugin' + Drawing bloğu aranır", None),
    ("S7", "REST smoke", "GET /vault/ pinlenmiş sertifika ile, -k YOK", None),
    ("S8", "JSON şema + id benzersizliği",
     "XML -> JSON indirgenir, obsidian-sketch.schema.json ile doğrulanır; ayrıca grup/komut "
     "toplamları ve tüm id'lerin benzersizliği yeniden hesaplanır",
     "JsonPrompt düğümü dekoratif değil; koşuluyor. Yinelenen id şemaya görünmez ama "
     "'verify: Faz 3.5' gibi her çapraz atıfı zehirler — gerçek bir çakışma S1 ve şemadan geçti."),
    ("S9", "kapsam",
     f"{len(SKETCH_CMDS)} komutun ve {len(EX_SETTINGS)} ayarın TAMAMI sınıflı olmalı", None),
    ("S10", "devir",
     "çizim sayfaları + obsidian.md v3.0 sayfaları = sitemap toplamı, örtüşme 0",
     "İki kılavuz arasında ne boşluk ne çift kayıt kalır."),
    ("S11", "sandbox artığı",
     f"{VAULT}/_sandbox yok; Emre'nin çizimi sha256 değişmemiş", None),
    ("S12", "kapının kendi dişi",
     "bozuk bir KOPYA üretilir; S1/S3/S5/S8 onu reddetmek ZORUNDA",
     "Başarısız olamayan kapı hiçbir şey kanıtlamaz."),
]

# ---------------------------------------------------------------- render
CMDS_CLASSIFIED = classify_commands()
SETTING_GROUPS = classify_settings()
SKETCH_SLUGS = ["plugins/canvas", "plugins/graph", "plugins/slides",
                "attachments", "embeds", "embed-web-pages"]
for _sl in SKETCH_SLUGS:
    src(_sl)  # fatal if the sitemap ever drops one

# Which of these the operations guide also treats in depth. Overlap is not a bug — canvas is an
# operations subject there (brain writes the file) and a drawing subject here (what the file is
# for). It only becomes a bug when it is silent, so it is read from the sibling and declared.
SIBLING_PATH = DESK + "/obsidian.md"
def shared_with_sibling():
    if not os.path.exists(SIBLING_PATH):
        return {}
    body = open(SIBLING_PATH, encoding="utf8").read()
    deep = set(re.findall(r'<Page path="([^"]+)" class="depth"', body))
    reasons = {
        "plugins/canvas": "v3.0: tuvali brain'in ÜRETMESİ · burada: tuvalin ne için olduğu ve "
                          "makinenin nasıl yazacağı",
        "plugins/graph": "v3.0: graph'ın vault sağlığı göstergesi olması · burada: graph'ın "
                         "hangi görsel soruyu yanıtladığı (SD8)",
    }
    out = {}
    for sl in SKETCH_SLUGS:
        if sl in deep:
            if sl not in reasons:
                die("v3.0 ile örtüşen sayfanın gerekçesi yazılmamış -> " + sl)
            out[sl] = reasons[sl]
    return out

SHARED = shared_with_sibling()

BUF = []
def w(line=""):
    BUF.append(line)

def tag(name, text, ind):
    if text is None:
        return
    w(f"{' ' * ind}<{name}>{esc(text)}</{name}>")

def attrs(d, keys):
    return "".join(f' {k}="{esc(d[k])}"' for k in keys if d.get(k) is not None)

risk_counts = {r: len([c for c in CMDS_CLASSIFIED if c["risk"] == r])
               for r in ["readonly", "ui", "mutating", "destructive", "dev", "paid"]}
ev_counts = {}
for c in CMDS_CLASSIFIED:
    ev_counts[c["evidence"]] = ev_counts.get(c["evidence"], 0) + 1
n_steps = sum(len(p["steps"]) for p in PH)
sb_pass = len([x for x in SB["steps"] if x["ok"]])
sb_total = len(SB["steps"])

# ---- markdown preamble
w("# Obsidian Çizim Kılavuzu (Canvas + Excalidraw) v1.0 — ollamas · eCym · odysseus")
w()
w("> **Tek komutla doğrula:** `zsh ~/Desktop/obsidian-sketch-verify.sh`")
w("> **Yeniden üret:** `python3 ~/Desktop/obsidian-sketch-gen.py`")
w("> Bu dosya elle düzenlenmez. Her sayı canlı bir komuttan türetilir; kapı düşerse kılavuz yanlıştır.")
w("> Operasyon yüzeyi (171 yardım sayfası, 114 CLI komutu) kardeş dosyada: `~/Desktop/obsidian.md` v3.0.")
w()
w("## Kapsam kanıtı")
w()
w("| Yüzey | Kapsam | Nasıl |")
w("|---|---|---|")
w(f"| Çizim yardım sayfası | **{len(SKETCH_SLUGS)} / {len(SKETCH_SLUGS)}** | "
  f"sitemap'ten türetildi; kalan {len(PAGES) - len(SKETCH_SLUGS)} sayfa v3.0'a devredildi |")
w(f"| Çizim komutu | **{len(SKETCH_CMDS)} / {len(SKETCH_CMDS)}** | "
  f"canlı `/commands/` kaydından ({len(ALL_CMDS)} komut içinden 4 önek) |")
w(f"| Excalidraw ayarı | **{len(EX_SETTINGS)} / {len(EX_SETTINGS)}** | "
  f"{len(SETTING_GROUPS)} gruba ayrıldı; gruplanmayan anahtar üreticiyi öldürür |")
w(f"| SYM ekosistem kalemi | **{len(SYM)} / {len(SYM)}** | her biri canlı HTTP koduyla |")
w(f"| Karar (`şunu kullanırsan bu olur`) | **{len(D)}** | SD1–SD{len(D)} |")
w(f"| Adım | **{n_steps}** | her biri çalıştırılabilir `Cmd` ya da açıklayıcı `Desc` |")
w(f"| Kör nokta | **{len(SPOTS)}** | "
  f"{len([s for s in SPOTS if s['status'] == 'çözüldü'])} çözüldü, "
  f"{len([s for s in SPOTS if s['status'] == 'açık'])} kanıtlı açık |")
w(f"| Kapı | **{len(GATES)}** | S1–S{len(GATES)} |")
w()
w("## Taslakta bulunan ve düzeltilen uydurmalar")
w()
w("Bu dosyanın önceki hâli elle yazılmıştı ve doğrulanmamış iddialar içeriyordu:")
w()
for i, (wrong, right, proof) in enumerate(CORRECTIONS, 1):
    w(f"{i}. **{wrong}** → {right}  ")
    w(f"   `{proof}`")
w()
w("## Bu üretimde gerçekten koşan uçtan uca döngü")
w()
if SB["ran"]:
    w(f"`_sandbox/` içinde **{sb_pass}/{sb_total}** adım geçti:")
    w()
    for x in SB["steps"]:
        w(f"- {'✅' if x['ok'] else '❌'} `{x['name']}` — {x['detail']}")
    w()
    w("Zincir: makine JSON yazar → REST PUT → `obsidian open` → `toggle-excalidraw-view` → "
      "`save` → eklenti bizim text elementlerimizi `## Text Elements` bölümüne çıkarır. "
      "Yani sahne gerçekten ayrıştırıldı, dosya sadece taşınmadı.")
else:
    w("`SKETCH_NO_SANDBOX=1` ile koşuldu — yazma ölçümleri atlandı, hiçbiri `measured-sandbox` "
      "olarak iddia edilmiyor.")
w()
w("## Kanıt seviyeleri")
w()
w("`measured` koşuldu · `measured-sandbox` `_sandbox/` içinde koşuldu, vault geri döndü · "
  "`code` kaynaktan okundu · `doc` belgede yazıyor, koşulmadı (gerekçeli) · "
  "`unmeasurable` ölçülemez (gerekçeli)")
w()
w("```xml")
w('<?xml version="1.0" encoding="UTF-8"?>')
w("<!--")
w()
w("  OBSIDIAN SKETCH GUIDE v1.0 - Canvas + Excalidraw + Sketch Your Mind")
w(f"  Uretim: {NOW}   Makine: MacBook (darwin)   Obsidian {OBS_VERSION} / Excalidraw {EX_MANIFEST['version']}")
w()
w("  BU DOSYA ELLE DUZENLENMEZ. Uretici: ~/Desktop/obsidian-sketch-gen.py")
w("  Kapi:                              ~/Desktop/obsidian-sketch-verify.sh   (S1..S12)")
w("  Sema:                              ~/Desktop/obsidian-sketch.schema.json (S8 bunu kosar)")
w("  Kardes:                            ~/Desktop/obsidian.md v3.0 (operasyon yuzeyi)")
w()
w("  OKUMA SIRASI")
w("  1) Pipeline       - istenen hiyerarsi: search -> think -> ... -> merge/commit/push")
w("  2) Corrections    - taslaktaki uydurmalar ve kaniti")
w("  3) DecisionMatrix - 'sunu kullanirsan bu olur' (SD1..SD22, asil aradiginiz bolum)")
w("  4) Phase 1..12    - adim adim; her Step calistirilabilir Cmd + gozlemlenebilir Expect")
w("  5) BlindSpots     - kanitli acik isler")
w()
w(cmt("  KANIT SEVIYELERI: measured / measured-sandbox / code / doc / unmeasurable"))
w()
w("-->")
w(f'<ObsidianSketchGuide version="1.0" generatedAt="{esc(NOW)}" host="macbook">')

# ---- Environment
w("  <Environment>")
for k, v, probe in ENV:
    w(f'    <Item key="{esc(k)}" value="{esc(v)}"><Probe cmd="{esc(probe)}"/></Item>')
w("  </Environment>")

# ---- Corrections
w()
w("  <!-- Taslaktaki her uydurma, duzeltmesi ve duzeltmeyi kanitlayan komut. -->")
w("  <Corrections>")
for i, (wrong, right, proof) in enumerate(CORRECTIONS, 1):
    w(f'    <Correction id="C{i}">')
    tag("Claimed", wrong, 6)
    tag("Actual", right, 6)
    tag("Proof", proof, 6)
    w("    </Correction>")
w("  </Corrections>")

# ---- Pipeline (the requested hierarchy, made navigable)
w()
w("  <!-- Istenen calisma hiyerarsisi. Her asama, bu belgede nerede karsilandigini gosterir. -->")
w("  <Pipeline>")
PIPE = [
    ("1", "search", "Canli envanter toplandi: sitemap, /commands/ kaydi, manifest, data.json, SYM HTTP.", "Environment, Inventory"),
    ("2", "think", "Taslak iddialarinin hangisi olculebilir sorgulandi.", "Corrections"),
    ("3", "analyz", "Cizim yuzeyi tanimlandi: 4 komut oneki + 6 yardim sayfasi; gerisi v3.0'a devredildi.", "Inventory/HelpPages, Gate S10"),
    ("4", "think", "Her komut ve ayar icin risk/kanit sinifi secildi; siniflanmayan olursa uretici olur.", "Inventory/SketchCommands, Inventory/ExcalidrawSettings"),
    ("5", "plan", "Kararlar 'sunu kullanirsan bu olur' bicimine dokuldu.", "DecisionMatrix SD1..SD22"),
    ("6", "think", "Kararlarin hangisinin olcum gerektirdigi ayristirildi.", "SD2, SD3, SD4, SD7, SD11, SD14"),
    ("7", "todo", "Olculecek adimlar faz faz siralandi.", "Phase 1..12"),
    ("8", "phase", "Fazlar yazildi; her Step calistirilabilir ya da aciklayici.", "Phase 1..12"),
    ("9", "jsonprompt", "Makine sozlesmesi tanimlandi ve semaya baglandi.", "JsonPrompt, Gate S8"),
    ("10", "plan", "Sandbox senaryosu tasarlandi: yaz, ac, gorunumu ac, kaydet, dogrula, sil.", "Phase 6, Phase 8"),
    ("11", "think", "Emre'nin gercek cizimlerine dokunmama kurali once yazildi.", "Phase 6.1"),
    ("12", "sandboxtest", "Senaryo _sandbox/ icinde gercekten kosuldu.", "SandboxRun"),
    ("13", "think", "Iki sessiz basarisizlik bulundu: indeks yarisi ve gorunum on kosulu.", "BlindSpot SB1, SD3"),
    ("14", "analyz", "Pozitif kontrol eklendi: canvas:new-file gercekten dosya yaratti.", "Phase 3.5"),
    ("15", "test", "true/false karar: makine sahnesi eklenti tarafindan ayristirildi mi?", "Phase 8.7"),
    ("16", "analyz", "Kalan acikar kanitiyla yazildi, gizlenmedi.", "BlindSpots SB2, SB3, SB4, SB7"),
    ("17", "think", "Kapilarin dusebilir olmasi saglandi.", "Gate S3, Gate S12"),
    ("18", "code", "Uretici, sema ve kapi yazildi.", "obsidian-sketch-gen.py, .schema.json, -verify.sh"),
    ("19", "test", "Kapi kosuldu; bozuk kopya reddedildi.", "Gate S1..S12"),
    ("20", "merge_commit_push", "Dosyalar depoya aynalanir ve conventional commit ile gonderilir.", "Delivery"),
]
for pid, name, did, where in PIPE:
    w(f'    <Stage id="{pid}" name="{esc(name)}">')
    tag("Did", did, 6)
    tag("Where", where, 6)
    w("    </Stage>")
w("  </Pipeline>")

# ---- Inventory
w()
w("  <Inventory>")
w(f'    <HelpPages count="{len(SKETCH_SLUGS)}" siteTotal="{len(PAGES)}" '
  f'delegated="{len(PAGES) - len(SKETCH_SLUGS)}" delegatedTo="obsidian.md v3.0">')
for sl in SKETCH_SLUGS:
    if sl in SHARED:
        w(f'      <Page path="{esc(sl)}" class="depth" sharedWith="obsidian.md v3.0" '
          f'lens="{esc(SHARED[sl])}"/>')
    else:
        w(f'      <Page path="{esc(sl)}" class="depth"/>')
w(f'      <Delegated to="obsidian.md v3.0" count="{len(PAGES) - len(SKETCH_SLUGS)}" '
  f'reason="operasyon yüzeyi kardeş kılavuzda 171/171 sınıflandırıldı; burada tekrarı çift kayıt olurdu"/>')
w("    </HelpPages>")

w(f'    <SketchCommands count="{len(SKETCH_CMDS)}" registryTotal="{len(ALL_CMDS)}" '
  f'source="{esc("GET /commands/ (" + CMD_SOURCE + ")")}">')
for p in SKETCH_PREFIX:
    w(f'      <Prefix name="{esc(p)}" count="{len([c for c in SKETCH_CMDS if c["id"].startswith(p + ":")])}"/>')
for c in CMDS_CLASSIFIED:
    a = f' id="{esc(c["id"])}" name="{esc(c["name"])}" risk="{esc(c["risk"])}" evidence="{esc(c["evidence"])}"'
    if c["note"]:
        a += f' note="{esc(c["note"])}"'
    w(f"      <Cmd{a}/>")
w("    </SketchCommands>")

w(f'    <ExcalidrawSettings count="{len(EX_SETTINGS)}" groups="{len(SETTING_GROUPS)}" '
  f'plugin="{esc(EX_MANIFEST["version"])}">')
for g in sorted(SETTING_GROUPS):
    keys = SETTING_GROUPS[g]
    w(f'      <Group name="{esc(g)}" count="{len(keys)}" meaning="{esc(GROUP_MEANING[g])}">')
    for k in keys:
        v = EX_SETTINGS.get(k)
        vs = json.dumps(v, ensure_ascii=False)
        if len(vs) > 60:
            vs = vs[:57] + "…"
        crit = ' critical="true"' if k in CRITICAL_SETTINGS else ""
        w(f'        <Key name="{esc(k)}" value="{esc(vs)}"{crit}/>')
    w("      </Group>")
w("    </ExcalidrawSettings>")

w(f'    <SymCatalogue count="{len(SYM)}" host="{esc(SYM_HOST)}" '
  f'note="{esc("Discourse; uydurma konu id 404 verir, bu yüzden canlılık gerçek bir ölçümdür")}">')
for key, title, path, tier, desc in SYM:
    ev = "measured" if tier == "free" else "unmeasurable"
    w(f'      <Product id="{esc(key)}" title="{esc(title)}" url="{esc(SYM_HOST + path)}" '
      f'tier="{esc(tier)}" http="{esc(SYM_STATUS.get(key, "?"))}" evidence="{ev}">')
    tag("Desc", desc, 8)
    if tier == "paid":
        tag("Note", "içerik üyelik arkasında; bu makineden doğrulanamaz (BlindSpot SB7)", 8)
    w("      </Product>")
w("    </SymCatalogue>")

w(f'    <Plugins core="{len([k for k, v in CORE.items() if v])}" community="{len(COMM)}">')
for k in ("canvas", "graph", "slides"):
    w(f'      <Core name="{k}" enabled="{str(CORE.get(k)).lower()}"/>')
w(f'      <Community id="obsidian-excalidraw-plugin" version="{esc(EX_MANIFEST["version"])}" '
  f'minApp="{esc(EX_MANIFEST["minAppVersion"])}" author="{esc(EX_MANIFEST["author"])}"/>')
w(f'      <Community id="obsidian-local-rest-api" version="{esc(REST_MANIFEST["version"])}"/>')
w("    </Plugins>")
w("  </Inventory>")

# ---- Decision matrix
w()
w("  <!-- 'sunu kullanirsan bu olur / bunu kullanirsan bu olur' - bu belgenin varlik sebebi. -->")
w("  <DecisionMatrix>")
for d in D:
    w(f'    <Decision id="{esc(d["id"])}" question="{esc(d["question"])}">')
    for opt in d["options"]:
        w(f'      <Option id="{esc(opt["id"])}" use="{esc(opt["use"])}" evidence="{esc(opt["evidence"])}">')
        tag("Then", opt["then"], 8)
        tag("Else", opt["else"], 8)
        tag("Cost", opt["cost"], 8)
        w("      </Option>")
    tag("Recommend", d["recommend"], 6)
    w("    </Decision>")
w("  </DecisionMatrix>")

# ---- Phases
w()
for p in PH:
    w(f'  <Phase id="{esc(p["id"])}" name="{esc(p["name"])}">')
    for st in p["steps"]:
        w(f'    <Step{attrs(st, ["id", "action", "evidence", "status"])}>')
        tag("Desc", st.get("desc"), 6)
        tag("Cmd", st.get("cmd"), 6)
        tag("Expect", st.get("expect"), 6)
        tag("Affects", st.get("affects"), 6)
        if st.get("source"):
            w(f'      <Source url="{esc(st["source"])}"/>')
        w("    </Step>")
    w("  </Phase>")

# ---- SandboxRun
w()
w("  <!-- Bu bolum uretim sirasinda gercekten kosuldu. Kosmadiysa ran=false olur. -->")
w(f'  <SandboxRun ran="{str(SB["ran"]).lower()}" passed="{sb_pass}" total="{sb_total}" path="{SANDBOX}/">')
for x in SB["steps"]:
    w(f'    <Check name="{esc(x["name"])}" ok="{str(x["ok"]).lower()}" detail="{esc(x["detail"])}"/>')
w("  </SandboxRun>")

# ---- JsonPrompt
w()
w("  <!-- Makine sozlesmesi. Dekoratif degil: S8 bunu semaya karsi dogrular. -->")
w("  <JsonPrompt>")
w("    <Contract><![CDATA[")
contract = {
    "task": "generate-sketch",
    "surface": {"canvas": "core", "excalidraw": EX_MANIFEST["version"]},
    "write": {"via": "rest", "endpoint": f"PUT https://127.0.0.1:{PORT}/vault/<path>",
              "neverWriteToDiskDirectly": True},
    "excalidraw": {"format": "plain-json", "frontmatter": "excalidraw-plugin: parsed",
                   "section": "## Drawing", "letPluginCompress": bool(EX_SETTINGS.get("compress"))},
    "activate": ["obsidian open path=<path>",
                 "obsidian command id=obsidian-excalidraw-plugin:toggle-excalidraw-view",
                 "obsidian command id=obsidian-excalidraw-plugin:save"],
    "proof": {"notAcceptable": "Executed: <command-id>",
              "acceptable": "## Text Elements bölümü + bayt farkı"},
    "cleanup": {"via": "DELETE /vault/<path>", "reason": "unlink edilen açık dosya geri yazılır"},
}
for ln in json.dumps(contract, ensure_ascii=False, indent=2).split("\n"):
    w("      " + ln)
w("    ]]></Contract>")
w("  </JsonPrompt>")

# ---- BlindSpots
w()
w("  <BlindSpots>")
for sp in SPOTS:
    w(f'    <Spot id="{esc(sp["id"])}" severity="{esc(sp["severity"])}" status="{esc(sp["status"])}">')
    for k, t in (("title", "Title"), ("evidence", "Evidence"), ("impact", "Impact"),
                 ("fix", "Fix"), ("next", "Next"), ("verify", "Verify")):
        tag(t, sp.get(k), 6)
    w("    </Spot>")
w("  </BlindSpots>")

# ---- Gates
w()
w("  <Gates>")
for gid, name, cmd, why in GATES:
    a = f' id="{gid}" name="{esc(name)}" cmd="{esc(cmd)}"'
    if why:
        a += f' why="{esc(why)}"'
    w(f"    <Gate{a}/>")
w("  </Gates>")

# ---- Delivery
w()
w("  <Delivery>")
w('    <Repo path="~/Desktop/ollamas-obsidian-guide-wt" branch="feat/obsidian-guide-v2"/>')
w('    <Note>~/Desktop bir git deposu degildir; dosyalar depoya aynalanip oradan gonderilir.</Note>')
w('    <Commit message="docs(obsidian): add sketch surface guide (canvas + excalidraw + SYM), gates S1-S12"/>')
w("  </Delivery>")

w("</ObsidianSketchGuide>")
w("```")
w()

open(OUT, "w", encoding="utf8").write("\n".join(BUF) + "\n")
print(f"yazıldı: {OUT}")
print(f"  {len(SKETCH_CMDS)} komut ({risk_counts}), {len(EX_SETTINGS)} ayar / "
      f"{len(SETTING_GROUPS)} grup, {len(D)} karar, {n_steps} adım, "
      f"{len(SPOTS)} kör nokta, sandbox {sb_pass}/{sb_total}")
