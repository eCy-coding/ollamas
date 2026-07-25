---
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
