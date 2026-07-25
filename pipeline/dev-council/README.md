---
cssclasses: [brain, system-orchestra]
tags: [orchestra, dev-council]
aliases: [Dev Council]
---

# Dev-Council — two-session Claude collaboration bus

No live link between sessions — **this vault is the bus**. See [[ROLES]] · [[PRINCIPLES]].

- `TASK-POOL/` — one card per task ({id,title,role,owner,status,reason,evidence}). Claim before work.
- `LOG.md` — append-only: `ts · session · action · WHY · evidence`.
- `INBOX-A.md` / `INBOX-B.md` — inter-session messages.
- `FINDINGS.md` — SESSION-B files bugs/efficiency findings; SESSION-A fixes.
- `SUGGESTIONS.md` — benchmark-ranked, reference-aligned proposals.

Protocol: `devcouncil next <role>` → claim → build in a Terminal.app tab → `devcouncil claim <id> <A|B>`
(logs WHY) → A: verify+commit+push · B: file findings+suggestions → update card → next.
