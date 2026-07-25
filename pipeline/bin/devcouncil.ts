#!/usr/bin/env -S npx tsx
// devcouncil (bin) — scaffold + drive the two-session Obsidian collaboration protocol.
//   init        scaffold vault orchestra/dev-council/ + repo pipeline/dev-council/, seed the pool
//   next <role> print the next claimable card for a role (code|bench|review|bug|research)
//   claim <id> <A|B>   claim a card (writes owner+status, appends LOG with a reason)
//   status      print pool stats
//   --verify    substrate integrity (dirs, non-empty pool, no double-claims)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseCard, renderCard, claim, logLine, seedFromBacklog, nextForRole, poolStats,
  type Card, type Role, type Session,
} from "../lib/devcouncil";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const DC = join(VAULT, "orchestra", "dev-council");
const POOL = join(DC, "TASK-POOL");
const REPO_DC = join(REPO, "pipeline", "dev-council");

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

const ROLES_MD = `---
cssclasses: [brain, system-orchestra]
tags: [orchestra, dev-council, roles]
---

# Roles — dev-council (OPERATOR-EDITABLE)

Two peer Claude Code sessions collaborate through this vault. Edit freely.

| Actor | Identity | Role(s) | Owns (writes) | Never |
|---|---|---|---|---|
| **SESSION-A** | terminal.app Claude | **Coder** + **Efficiency-measurer** | code, verify.sh, tests, benchmarks, git, both render targets | reviews its own diff |
| **SESSION-B** | claude.app Claude (dispatched) | **Reviewer** + **Bug-hunter** + **Researcher** | FINDINGS.md, SUGGESTIONS.md, review notes, inbox | code/commits/gates |
| **ollamas** | :3000 ($0) | LLM worker + council seat | bench, classification, votes | (invoked) |
| **eCym** | ecym / ecy-cmd | command execution + routing | command runs, ecy-selftest | (invoked) |
| **obsidian** | this vault | coordination substrate + memory | pool, LOG, inbox, findings | — |
| **chair** | claudecode (A holds it) | decide ROI, resolve conflicts, veto red gate | decisions in LOG | override green-gate without cause |
`;

const PRINCIPLES_MD = `---
cssclasses: [brain, system-orchestra]
tags: [orchestra, dev-council, principles]
---

# Working principles — dev-council (OPERATOR-EDITABLE: add/remove numbered items)

1. **Claim-before-work** — no two sessions touch the same task; claim on the card first.
2. **Role-scoped lanes** — A owns code/commits; B owns review/research. Never write the other's files.
3. **Justify everything** — every action is one LOG line with a WHY (gerekçe) + evidence path.
4. **Communicate every cycle** — read your inbox, reply in the other's; findings/suggestions are messages.
5. **Source-truth** — nothing invented; every claim cites a real source/path (promptlint enforces).
6. **MISS ≠ PASS** — absent measurement/section/link never counts as passing; gates block.
7. **Two parallel targets** — every help artifact lands in repo web/help/ AND vault _help/.
8. **Benchmark before you suggest** — a suggestion carries a measured number, not a vibe.
9. **No conflict, teammates** — on collision the later claimant yields; chair breaks ties to lower risk.
10. **Safety** — no delete outside _sandbox/; never touch com.ecy*; outward-facing is Emre's call.
11. **Green-gate to ship** — commit only when verify.sh FAIL=0 + suite green; findings addressed or logged.
12. **Sustainable cadence** — small ROI cycles, each verified+logged, so the system can pause/resume.
`;

const README_MD = `---
cssclasses: [brain, system-orchestra]
tags: [orchestra, dev-council]
aliases: [Dev Council]
---

# Dev-Council — two-session Claude collaboration bus

No live link between sessions — **this vault is the bus**. See [[ROLES]] · [[PRINCIPLES]].

- \`TASK-POOL/\` — one card per task ({id,title,role,owner,status,reason,evidence}). Claim before work.
- \`LOG.md\` — append-only: \`ts · session · action · WHY · evidence\`.
- \`INBOX-A.md\` / \`INBOX-B.md\` — inter-session messages.
- \`FINDINGS.md\` — SESSION-B files bugs/efficiency findings; SESSION-A fixes.
- \`SUGGESTIONS.md\` — benchmark-ranked, reference-aligned proposals.

Protocol: \`devcouncil next <role>\` → claim → build in a Terminal.app tab → \`devcouncil claim <id> <A|B>\`
(logs WHY) → A: verify+commit+push · B: file findings+suggestions → update card → next.
`;

function scaffold(): void {
  for (const d of [DC, POOL, REPO_DC]) mkdirSync(d, { recursive: true });
  const w = (dir: string, f: string, body: string) => { const p = join(dir, f); if (!existsSync(p)) writeFileSync(p, body, "utf8"); };
  w(DC, "ROLES.md", ROLES_MD);
  w(DC, "PRINCIPLES.md", PRINCIPLES_MD);
  w(DC, "README.md", README_MD);
  w(DC, "LOG.md", `# Dev-Council LOG (append-only)\n\n> \`ts · session · action · WHY · evidence\`\n\n`);
  w(DC, "INBOX-A.md", "# Inbox — SESSION-A (terminal.app)\n\n");
  w(DC, "INBOX-B.md", "# Inbox — SESSION-B (claude.app)\n\n");
  w(DC, "FINDINGS.md", "# Findings (SESSION-B → SESSION-A)\n\n| id | severity | file | finding | status |\n|---|---|---|---|---|\n");
  w(DC, "SUGGESTIONS.md", "# Suggestions (benchmark-ranked, reference-aligned)\n\n| id | proposal | measured | ref | rank |\n|---|---|---|---|---|\n");
  // repo mirror of the operator-editable contract (tracked)
  w(REPO_DC, "ROLES.md", ROLES_MD);
  w(REPO_DC, "PRINCIPLES.md", PRINCIPLES_MD);
  w(REPO_DC, "README.md", README_MD);
}

function seed(): number {
  const backlog = join(REPO, "pipeline", "ECYE2EMASTERPLAN.en.md");
  if (!existsSync(backlog)) return 0;
  const cards = seedFromBacklog(readFileSync(backlog, "utf8"));
  let n = 0;
  for (const c of cards) {
    const p = join(POOL, `${c.id}.md`);
    if (!existsSync(p)) { writeFileSync(p, renderCard(c), "utf8"); n++; }
  }
  return n;
}

function readPool(): Card[] {
  if (!existsSync(POOL)) return [];
  return readdirSync(POOL).filter((f) => f.endsWith(".md")).map((f) => parseCard(readFileSync(join(POOL, f), "utf8")));
}

function appendLog(session: Session, action: string, why: string, evidence?: string): void {
  const line = logLine(now(), session, action, why, evidence);
  writeFileSync(join(DC, "LOG.md"), readFileSync(join(DC, "LOG.md"), "utf8") + line + "\n", "utf8");
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (process.argv.includes("--verify")) {
    const lines: string[] = [];
    let ok = true;
    const need = (c: boolean, m: string) => { lines.push(`${c ? "ok" : "HATA"}  ${m}`); ok = ok && c; };
    need(existsSync(DC) && existsSync(POOL), "dev-council/ + TASK-POOL/ var");
    const cards = readPool();
    need(cards.length > 0, `görev havuzu dolu (${cards.length} kart)`);
    for (const f of ["ROLES.md", "PRINCIPLES.md", "LOG.md", "FINDINGS.md", "SUGGESTIONS.md"]) need(existsSync(join(DC, f)), `${f} var`);
    // no double-claim: each card has ≤1 owner (structurally true), and owner matches its role lane
    const badLane = cards.filter((c) => c.owner && ((c.role === "code" || c.role === "bench") ? c.owner !== "A" : c.owner !== "B"));
    need(badLane.length === 0, `rol-şeridi ihlali: ${badLane.length}`);
    for (const l of lines) console.log(l);
    console.log(ok ? "devcouncil --verify: PASS" : "devcouncil --verify: FAIL");
    process.exit(ok ? 0 : 1);
    return;
  }

  if (cmd === "init") {
    scaffold();
    const n = seed();
    appendLog("A", "init", "iki-oturum işbirliği alt yapısını kur + havuzu tohumla", `TASK-POOL/ +${n} kart`);
    const st = poolStats(readPool());
    console.log(`devcouncil init: ~/ollamas-vault/orchestra/dev-council/ + pipeline/dev-council/ · havuz ${st.total} kart (+${n} yeni)`);
    return;
  }

  if (cmd === "next") {
    const role = (rest[0] ?? "code") as Role;
    const sess = (role === "code" || role === "bench" ? "A" : "B") as Session;
    const c = nextForRole(readPool(), role, sess);
    console.log(c ? `SESSION-${sess} · ${role} · ${c.id}: ${c.title} [${c.status}]\n  ${c.body}` : `(${role} için claimable kart yok)`);
    return;
  }

  if (cmd === "claim") {
    const [id, sess] = [rest[0], (rest[1] as Session)];
    const p = join(POOL, `${id}.md`);
    if (!existsSync(p)) { console.error(`kart yok: ${id}`); process.exit(1); return; }
    const r = claim(parseCard(readFileSync(p, "utf8")), sess);
    if (!r.ok) { console.error(`çakışma: ${id} zaten ${r.conflict} şeridinde/sahipliğinde`); process.exit(1); return; }
    writeFileSync(p, renderCard(r.card), "utf8");
    appendLog(sess, `claim ${id}`, r.card.title, p.replace(HOME, "~"));
    console.log(`claimed ${id} → SESSION-${sess} (in_progress)`);
    return;
  }

  if (cmd === "status") {
    const st = poolStats(readPool());
    console.log(`havuz: ${st.total} · todo ${st.todo} · in_progress ${st.inProgress} · done ${st.done} · A ${st.a} · B ${st.b}`);
    return;
  }

  console.log("devcouncil <init|next <role>|claim <id> <A|B>|status|--verify>");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { readPool, scaffold, seed };
