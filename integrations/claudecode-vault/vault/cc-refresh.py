#!/usr/bin/env python3
"""Claude Code bilgi kümesi canlı izleyici.
Haftalık: llms.txt + whats-new + 4 çapa URL curl → YENİ sayfa/hafta için stub not + ollamas ingest,
çapa URL içerik-drift'ini hash ile tespit + logla. WebFetch yok (launchd) → curl + :3000/api/brain/remember.
"""
import json, os, re, hashlib, subprocess, time, urllib.request

HOME = os.path.expanduser("~")
V = f"{HOME}/ollamas-vault"
STATE = f"{V}/_index/.cc-refresh-state.json"
LOG = f"{V}/_index/cc-refresh.log"
LLMS = "https://code.claude.com/docs/llms.txt"
ANCHORS = [
    "https://code.claude.com/docs/llms.txt",
    "https://claude.com/product/claude-code",
    "https://support.claude.com/en/",
    "https://www.anthropic.com/",
]

def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")

def curl(url, timeout=30):
    try:
        return subprocess.run(["curl", "-fsSL", "-m", str(timeout), url],
                              capture_output=True, text=True, timeout=timeout+5).stdout
    except Exception as e:
        log(f"curl FAIL {url}: {e}")
        return ""

def sha(s): return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()[:16]

def cat_tier(path):
    p = path[3:] if path.startswith("en/") else path
    def has(*xs): return any(x in p for x in xs)
    if p.startswith("agent-sdk/"): return "sdk", "learned"
    if p.startswith("whats-new"): return "whatsnew", "learned"
    if has("gateway"): return "gateways", "learned"
    if has("bedrock","vertex","foundry","platform-on-aws"): return "cloud","learned"
    if has("github","gitlab"): return "cicd","procedural"
    if has("plugin"): return "plugins","procedural"
    if has("hook"): return "hooks","procedural"
    if has("mcp","channels","tools-reference"): return "mcp","procedural"
    if has("desktop","mobile","web-quickstart","claude-code-on-the-web","vs-code","jetbrains","chrome","slack","platforms"): return "platforms","learned"
    if has("permission","security","sandbox"): return "security","procedural"
    if has("setting","env-vars","claude-directory","keybinding","terminal-config","statusline","model-config","auto-mode"): return "config","procedural"
    if has("admin","server-managed","network-config","corporate","third-party"): return "enterprise","learned"
    if has("cost","analytics","monitoring"): return "costs","learned"
    if has("session","agent-view","agent-teams","worktree","routine","scheduled-tasks","workflows","agents"): return "sessions","procedural"
    if has("skill","sub-agent"): return "skills","procedural"
    if has("troubleshoot","debug","errors"): return "troubleshoot","procedural"
    if has("best-practices","prompt-library","champion","communications"): return "adoption","learned"
    if has("memory","context-window","prompt-caching"): return "memory","learned"
    if has("cli-reference","commands","headless"): return "cli","procedural"
    if has("code-review","ultrareview","ultraplan","advisor"): return "review","procedural"
    if has("data-usage","zero-data","legal","glossary","feature-availability","accessibility","fast-mode"): return "reference","learned"
    if has("quickstart","overview","how-claude-code-works","setup","authentication","troubleshoot-install"): return "getting-started","procedural"
    return "features", "procedural"

def slugify(path):
    p = path[3:] if path.startswith("en/") else path
    p = p.replace("agent-sdk/","sdk-").replace("whats-new/","wn-").replace("whats-new","wn-index")
    return p.strip("/").replace("/","-")

def remember(mid, content, tier):
    payload = json.dumps({"id": mid, "content": content, "ns": "default",
                          "tier": tier, "source": "claude-code"}).encode()
    req = urllib.request.Request("http://localhost:3000/api/brain/remember",
                                 data=payload, headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        log(f"remember FAIL {mid}: {e}")
        return None

def main():
    state = json.load(open(STATE)) if os.path.exists(STATE) else {"hashes": {}, "known": []}
    known = set(state.get("known", []))

    # 1) drift: çapa URL hash
    for url in ANCHORS:
        body = curl(url)
        if not body: continue
        h = sha(body)
        old = state["hashes"].get(url)
        if old and old != h:
            log(f"DRIFT: {url} değişti (yeniden tam-build için workflow'u koş)")
        state["hashes"][url] = h

    # 2) yeni sayfa/hafta tespiti
    llms = curl(LLMS)
    rows = re.findall(r'^-\s+\[(.*?)\]\((https://code\.claude\.com/docs/(en/[^)]+?)\.md)\)(?::\s*(.*))?$', llms, re.M)
    new_count = 0
    for title, url, path, desc in rows:
        slug = slugify(path)
        if slug in known:
            continue
        # not zaten var mı (v1/workflow'dan)?
        cat, tier = cat_tier(path)
        target = f"{V}/{tier}/claude-code-{slug}.md"
        known.add(slug)
        if os.path.exists(target):
            continue
        # stub not oluştur (title+desc+source_url) + ingest
        ms = int(time.time()*1000)
        fm = (f'---\nid: "claude-code:{slug}"\nns: default\ntier: {tier}\nsource: claude-code\n'
              f'source_url: {url}\ncreated_ms: {ms}\ncssclasses: [brain, tier-{tier}, system-claudecode]\n'
              f'tags: [tier/{tier}, ns/claude-code, system/claudecode, cc/{cat}, cc/auto-stub]\n'
              f'aliases: ["{title[:70].replace(chr(34),"")}"]\n---\n')
        body = (f"\n# {title}\n\n> [!note] claudecode · otomatik-stub · {url}\n\n{desc}\n\n"
                f"> Tam içerik: {url} (bir sonraki tam-build'de TR'ye çevrilecek)\n\n"
                f"## Related\n[[claude-code]] · [[cc-{cat}]] · [[entity-claude]]\n")
        with open(target, "w") as f:
            f.write(fm + body)
        remember(f"claude-code:{slug}", body.strip(), tier)
        log(f"YENİ: {slug} ({cat}/{tier}) stub+ingest")
        new_count += 1

    state["known"] = sorted(known)
    json.dump(state, open(STATE, "w"), ensure_ascii=False, indent=1)
    log(f"tamamlandı · yeni sayfa: {new_count} · toplam bilinen: {len(known)}")

if __name__ == "__main__":
    main()
