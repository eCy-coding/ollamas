# Role card — obsidian

> The knowledge vault: durable memory, published docs, and the collaboration bus.

- **Mandate:** be the single source of durable memory and the async coordination substrate between
  the two Claude sessions — the vault IS the bus.
- **Identity/path:** `~/ollamas-vault/` · `_bin/cckb` (219 capsules, offline, ~1KB/answer) + ~30
  `cc-*` tools · `_help/` (coded-site mirror) · `orchestra/dev-council/` (task pool, LOG, inbox,
  findings) · canvases/bases · brain⇄vault mirror.
- **Owns (writes):** the dev-council substrate (both sessions write per role-lane), the `_help/`
  markdown mirror, `site.canvas`, memory notes, `cc-capsules`.
- **Interfaces:** `cckb ask|get|cat|map` (knowledge) · Local REST API `:27124` (write/delete 204) ·
  `[[wikilink]]` + `.base` graph channels · `devcouncil` protocol (`TASK-POOL/`, `LOG.md`, inboxes).
- **In the dev-council:** the **coordination substrate + durable memory** — holds the task pool, the
  justified LOG, the inboxes, FINDINGS and SUGGESTIONS; a council seat.
- **Boundaries:** local-only git (no remote); protected by git + tar backups + a `_sandbox/`-only
  deletion barrier; brain strips custom frontmatter/H1/callouts (anchors must be in-body prose).
- **Backlog phase:** 4 (Vault Brain & Gateway). Source: `docs/obsidian/`, `~/ollamas-vault/_bin/`.
