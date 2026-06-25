---
description: $0 GitHub repo açıklama — DeepWiki MCP ile bir repo'nun mimarisini/kullanımını çıkar (adoption-research için)
---

Verilen GitHub repo'su (argüman = `owner/repo` veya URL) için DeepWiki MCP'den derin-wiki çek — ADOPTION research akışı (§3: top-star macOS repo'dan çalışan kod entegre et).

Adımlar:
1. `mcp__deepwiki__read_wiki_structure` (veya gateway eşdeğeri) → repo'nun wiki başlıkları.
2. `mcp__deepwiki__read_wiki_contents` / `mcp__deepwiki__ask_question` → mimari + ilgili modül + kullanım deseni.
3. MCP yoksa: `gh repo view owner/repo` + WebFetch README fallback.

Çıktı (ADOPTION notu formatı):
- **Ne**: 1-2 cümle.
- **Lisans**: MIT/Apache (kopya+attribution mümkün) vs GPL (yalnız fikir).
- **Alınabilir desen/kod**: hangi dosya/fonksiyon, ollamas'ın hangi ihtiyacına.
- **Risk/uyumsuzluk**: zero-dep/scope ihlali var mı.
- Kaynak: repo URL + dosya yolları.

Kural: yalnız read-only (gh repo view, deepwiki). Kod kopyalama önerisinde lisans uyumunu DOĞRULA. Evidence-first.
