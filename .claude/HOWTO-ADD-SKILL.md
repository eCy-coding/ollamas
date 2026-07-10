# HOWTO — add a Claude Code skill (e2e, repeatable)

A **skill** is domain expertise the assistant loads on demand. In ollamas a skill is
a directory under `.claude/skills/<name>/` containing a `SKILL.md` with YAML
frontmatter. The wiring is frozen by a test (`tests/skills-wiring.test.ts`), so
"added a skill" means "the test still passes." This is the skill counterpart of
[`HOWTO-ADD-CLI.md`](./HOWTO-ADD-CLI.md).

## Architecture (why it's shaped this way)

- Skills live in `.claude/skills/<name>/SKILL.md`. The two shipped ones are
  `orchestra-conductor` and `fleet-orchestrator` — read either as a template.
- A skill's frontmatter carries at minimum a **`name`** and a **`description`**.
  The `description` is what the assistant matches against to decide when to load the
  skill, so make it a precise "use when…" sentence.
- A **slash command** (`.claude/commands/<cmd>.md`) is the invocation surface. Its
  frontmatter needs a `description` and, when it runs anything, an `allowed-tools`
  entry; any orchestration script it references (run via `tsx`/`bash`/`npx tsx`)
  **must exist on disk** — the wiring test enforces this.

## The format — `SKILL.md`

```markdown
---
name: my-skill
description: Use when <precise trigger> — <what it does and the outcome>. Also use to <secondary trigger>.
---

# My Skill (one-line what-it-is)

Short orientation paragraph: what this skill is for and where the full map lives.

## When to use
- Bullet the concrete situations that should load this skill.

## How it works
- The mechanism, key files, and any commands the operator runs.
```

Only `name` + `description` are structurally required (the wiring test checks for
both). Everything below the frontmatter is free-form guidance for the assistant.
If your skill drives a script, reference it with a real path
(e.g. `npx tsx orchestration/bin/foo.ts`) — the file has to exist.

## The slash command (invocation surface)

Register `/my-skill` by adding `.claude/commands/my-skill.md`:

```markdown
---
description: <argument shape + one-line what it does>
allowed-tools: Bash(npx tsx orchestration/bin/foo.ts:*)
---

Instructions the assistant follows when the user runs /my-skill.
1. Step one…
2. Step two… (show evidence — run it, print stdout)
```

`allowed-tools` is required whenever the command actually runs something. Keep the
Bash pattern as narrow as possible (see `HOWTO-ADD-CLI.md` for the permission model).

## 5 steps

1. **Create** `.claude/skills/<name>/SKILL.md` with a `name` + a precise
   "use when…" `description` (copy an existing skill's shape).
2. **Wire the command** (optional but usual): add `.claude/commands/<name>.md` with
   `description` + `allowed-tools`; make sure every script it invokes exists on disk.
3. **Test the wiring:**
   ```bash
   npx vitest run tests/skills-wiring.test.ts
   ```
   It asserts: every `SKILL.md` carries `name` + `description`; every slash command
   has valid frontmatter with a `description`; and every referenced orchestration
   script resolves on disk.
4. **Restart** the Claude Code tab so the new skill/command is picked up.
5. **Smoke test:** invoke `/my-skill` (or ask a question that should trigger the
   skill's `description`) and confirm it loads and does the right thing.

## Rules

- The `description` is a **router**, not a title — write it as "Use when X …" so the
  assistant matches it correctly.
- A slash command that runs code without an `allowed-tools` entry fails the wiring
  test — add the narrowest Bash pattern that works.
- Never reference a script path you haven't created — the wiring test will fail.
- Keep `SKILL.md` focused: orientation + when-to-use + how-it-works. Deep detail
  belongs in a linked doc, not inline.
