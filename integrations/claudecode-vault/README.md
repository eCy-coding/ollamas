# claudecode-vault — Obsidian Claude Code KB + model E2E entegrasyonu

Obsidian kasasında (`~/ollamas-vault`) eksiksiz Claude Code bilgi sistemi; eCym + ollamas + alt-modeller uçtan uca kullanır.

## Ne var
- **KB:** 205+ not (172 doc-sayfa + 20 destek + 12 TR-özet + 3 çapa) + 25 kategori-MOC + 1169 inter-doc kenar. `system/claudecode` tag → graph kırmızı küme. 4 kaynağa çapalı: code.claude.com/docs · claude.com/product · support.claude.com · anthropic.com.
- **bin/**
  - `cc-e2e` — görev → `:3000/api/brain/recall` (KB) → alt-model (`:3000/v1` cerebras/groq/gemini/sambanova) → vault yaz (`orchestra/reports/`, REST `:27124` + brain remember). Obsidian E2E pipeline.
  - `ecy-cc` — eCym doc-Q&A: soru → recall → claude-code notundan cevap+kaynak ($0 local).
  - `claude-here` — dizinde `claude` başlat.
- **vault/**
  - `cc-refresh.py` — launchd haftalık: 4 URL + llms.txt + whats-new curl → yeni/stub not + drift.
  - `obsidian-e2e-workflow.json` — makine-okunur E2E spec (aktörler/portlar/adımlar).
  - `launchClaude.js` — Templater launcher. `Claude-Code.command` — çift-tık Terminal launcher.
- **launchd/** `com.ollamas.cc-refresh.plist` (Pzt 09:00).
- **workflows/** `cc_specs.json` (172 doc katalog) · `batches.json` · `cc-e2e.jsonprompt.json`.

## Kanallar
| | endpoint |
|---|---|
| brain recall | `POST :3000/api/brain/recall {query,k}` |
| ask-shared | `POST :3000/api/brain/ask-shared {question}` |
| chat (alt-model) | `POST :3000/v1/chat/completions` |
| Obsidian REST | `:27124` (Local REST, key `.obsidian/plugins/obsidian-local-rest-api/data.json`) |
| brain write | `POST :3000/api/brain/remember {id,content,ns:default,tier,source}` |

## Kullanım
```bash
cc-e2e "claude code hooks ile rm engelle"
cc-e2e --model groq "worktree paralel oturum"
ecy-cc "hooks exit kodları"
ecym "claude code başlat"
```

## Kurulum
`bin/*` → `~/.local/bin/` · `vault/*` → `~/ollamas-vault/_bin/` · `launchd/*.plist` → `~/Library/LaunchAgents/` + `launchctl load`.

## GOTCHA (brain re-materialize)
Custom frontmatter (`source_url`, `cc/*` tag) + hand-Related SİLİNİR → graph-wiring + URL çapası GÖVDEDE olmalı (`**Kategori:**/**Hub:**/**🔗 Kaynak:**` footer). ns=default şart (recall ns-filtreli). Silme yalnız `_sandbox/`.
