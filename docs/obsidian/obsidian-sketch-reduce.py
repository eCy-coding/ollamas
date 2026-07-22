#!/usr/bin/env python3
"""Reduce the sketch guide's XML to JSON and validate it against obsidian-sketch.schema.json (gate S8).

The draft this guide replaces carried a <JsonPrompt> node describing a config nothing ever ran.
This is that node made real: the structure it claims is checked on every gate run, so a decision
with one option, a step with neither command nor description, a paid product claimed as measured,
or a blind spot with no evidence all become a FAIL.

Usage: obsidian-sketch-reduce.py <guide.xml> <schema.json>
"""
import json, sys
import xml.etree.ElementTree as ET

def text(node, tag):
    el = node.find(tag)
    return (el.text or "").strip() if el is not None else None

def prune(d):
    return {k: v for k, v in d.items() if v not in (None, "")}

def as_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default

def reduce_guide(path):
    root = ET.parse(path).getroot()

    env = [prune({"key": i.get("key"), "value": i.get("value") or "",
                  "probe": (i.find("Probe").get("cmd") if i.find("Probe") is not None else None)})
           for i in root.findall("./Environment/Item")]

    corrections = [prune({"id": c.get("id"), "claimed": text(c, "Claimed"),
                          "actual": text(c, "Actual"), "proof": text(c, "Proof")})
                   for c in root.findall("./Corrections/Correction")]

    pipeline = [prune({"id": s.get("id"), "name": s.get("name"),
                       "did": text(s, "Did"), "where": text(s, "Where")})
                for s in root.findall("./Pipeline/Stage")]

    hp = root.find("./Inventory/HelpPages")
    pages = [prune({"path": p.get("path"), "class": p.get("class"), "reason": p.get("reason"),
                    "sharedWith": p.get("sharedWith"), "lens": p.get("lens")})
             for p in hp.findall("Page")]
    deleg = hp.find("Delegated")

    sc = root.find("./Inventory/SketchCommands")
    # NOTE: <Cmd> is also the tag a Step uses for its runnable command, so this is scoped to the
    # inventory. Unscoped, the count comes out far above the real command total.
    cmds = [prune({"id": c.get("id"), "name": c.get("name"), "risk": c.get("risk"),
                   "evidence": c.get("evidence"), "note": c.get("note")})
            for c in sc.findall("Cmd")]

    es = root.find("./Inventory/ExcalidrawSettings")
    groups = []
    for g in es.findall("Group"):
        groups.append(prune({
            "name": g.get("name"), "count": as_int(g.get("count")), "meaning": g.get("meaning"),
            "keys": [prune({"name": k.get("name"), "value": k.get("value") or "",
                            "critical": (k.get("critical") == "true") or None})
                     for k in g.findall("Key")],
        }))

    sy = root.find("./Inventory/SymCatalogue")
    products = [prune({
        "id": p.get("id"), "title": p.get("title"), "url": p.get("url"), "tier": p.get("tier"),
        "http": p.get("http"), "evidence": p.get("evidence"),
        "desc": text(p, "Desc"), "note": text(p, "Note"),
    }) for p in sy.findall("Product")]

    decisions = []
    for d in root.findall("./DecisionMatrix/Decision"):
        decisions.append(prune({
            "id": d.get("id"), "question": d.get("question"),
            "recommend": text(d, "Recommend"),
            "options": [prune({
                "id": o.get("id"), "use": o.get("use"), "evidence": o.get("evidence"),
                "then": text(o, "Then"), "else": text(o, "Else"), "cost": text(o, "Cost"),
            }) for o in d.findall("Option")],
        }))

    phases = []
    for ph in root.findall("./Phase"):
        phases.append(prune({
            "id": ph.get("id"), "name": ph.get("name"),
            "steps": [prune({
                "id": st.get("id"), "action": st.get("action"), "evidence": st.get("evidence"),
                "cmd": text(st, "Cmd"), "desc": text(st, "Desc"), "expect": text(st, "Expect"),
                "affects": text(st, "Affects"),
                "source": (st.find("Source").get("url") if st.find("Source") is not None else None),
            }) for st in ph.findall("Step")],
        }))

    sb = root.find("./SandboxRun")
    sandbox = {
        "ran": sb.get("ran") == "true",
        "passed": as_int(sb.get("passed")),
        "total": as_int(sb.get("total")),
        "checks": [{"name": c.get("name"), "ok": c.get("ok") == "true", "detail": c.get("detail")}
                   for c in sb.findall("Check")],
    }

    spots = [prune({
        "id": s.get("id"), "severity": s.get("severity"), "status": s.get("status"),
        "title": text(s, "Title"), "evidence": text(s, "Evidence"), "impact": text(s, "Impact"),
        "fix": text(s, "Fix"), "next": text(s, "Next"), "verify": text(s, "Verify"),
    }) for s in root.findall("./BlindSpots/Spot")]

    gates = [prune({"id": g.get("id"), "name": g.get("name"), "cmd": g.get("cmd"), "why": g.get("why")})
             for g in root.findall("./Gates/Gate")]

    return {
        "version": root.get("version"),
        "environment": env,
        "corrections": corrections,
        "pipeline": pipeline,
        "inventory": {
            "helpPages": prune({
                "count": as_int(hp.get("count")), "siteTotal": as_int(hp.get("siteTotal")),
                "delegated": as_int(hp.get("delegated")),
                "delegatedReason": deleg.get("reason") if deleg is not None else None,
                "pages": pages,
            }),
            "sketchCommands": {"count": as_int(sc.get("count")),
                               "registryTotal": as_int(sc.get("registryTotal")),
                               "commands": cmds},
            "excalidrawSettings": {"count": as_int(es.get("count")), "groups": groups},
            "symCatalogue": {"count": as_int(sy.get("count")), "host": sy.get("host"),
                             "products": products},
        },
        "decisions": decisions,
        "phases": phases,
        "sandboxRun": sandbox,
        "blindSpots": spots,
        "gates": gates,
    }

def main():
    if len(sys.argv) != 3:
        print("usage: obsidian-sketch-reduce.py <guide.xml> <schema.json>", file=sys.stderr)
        return 2
    doc = reduce_guide(sys.argv[1])
    schema = json.load(open(sys.argv[2], encoding="utf8"))
    try:
        import jsonschema
    except ImportError:
        print("jsonschema kurulu değil — S8 doğrulanamadı", file=sys.stderr)
        return 1

    v = jsonschema.Draft202012Validator(schema)
    errs = sorted(v.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))
    if errs:
        for e in errs[:8]:
            loc = "/".join(str(p) for p in e.absolute_path) or "(kök)"
            print(f"{loc}: {e.message}", file=sys.stderr)
        print(f"toplam {len(errs)} şema ihlali", file=sys.stderr)
        return 1

    # Counts the schema cannot express, but that make the coverage claim real. A settings group
    # list whose parts do not add up to the declared total is a silent gap, so it is checked here.
    inv = doc["inventory"]
    keysum = sum(len(g["keys"]) for g in inv["excalidrawSettings"]["groups"])
    if keysum != inv["excalidrawSettings"]["count"]:
        print(f"ayar toplamı tutmuyor: gruplarda {keysum}, iddia {inv['excalidrawSettings']['count']}",
              file=sys.stderr)
        return 1
    if len(inv["sketchCommands"]["commands"]) != inv["sketchCommands"]["count"]:
        print(f"komut toplamı tutmuyor: listede {len(inv['sketchCommands']['commands'])}, "
              f"iddia {inv['sketchCommands']['count']}", file=sys.stderr)
        return 1
    if inv["helpPages"]["count"] + inv["helpPages"]["delegated"] != inv["helpPages"]["siteTotal"]:
        print("sayfa devri tutmuyor: çizim + devredilen != sitemap toplamı", file=sys.stderr)
        return 1

    # Duplicate ids are invisible to JSON Schema but poison every cross-reference in the guide:
    # a blind spot that says "verify: Faz 3.5" points at two different steps. Caught here after
    # a real collision slipped through S1 and S8.
    def dupes(seq):
        seen, out = set(), []
        for x in seq:
            if x in seen:
                out.append(x)
            seen.add(x)
        return out
    for coll, label in ((doc["decisions"], "karar"), (doc["blindSpots"], "kör nokta"),
                        (doc["gates"], "kapı"), (doc["corrections"], "düzeltme")):
        d = dupes([x["id"] for x in coll])
        if d:
            print(f"yinelenen {label} id: {', '.join(d)}", file=sys.stderr)
            return 1
    for ph in doc["phases"]:
        d = dupes([s["id"] for s in ph["steps"]])
        if d:
            print(f"Faz {ph['id']} içinde yinelenen adım id: {', '.join(d)}", file=sys.stderr)
            return 1
    for dec_ in doc["decisions"]:
        d = dupes([o["id"] for o in dec_["options"]])
        if d:
            print(f"{dec_['id']} içinde yinelenen seçenek id: {', '.join(d)}", file=sys.stderr)
            return 1

    sb = doc["sandboxRun"]
    print(f"şema geçti — {len(doc['decisions'])} karar, "
          f"{sum(len(p['steps']) for p in doc['phases'])} adım, "
          f"{inv['sketchCommands']['count']} komut, {keysum} ayar, "
          f"{len(inv['symCatalogue']['products'])} SYM kalemi, "
          f"{len(doc['blindSpots'])} kör nokta, sandbox {sb['passed']}/{sb['total']}")
    return 0

sys.exit(main())
