# Adding an `ollamas` CLI subcommand

The `ollamas` CLI is **zero-dependency TypeScript**: only Node built-ins, no npm
runtime deps. It is a client of the gateway — it speaks HTTP `/api/*` + `/mcp` and
**never imports `server/tool-registry`** (Scope Law, verified by grep). A subcommand
is a `run<Name>(argv)` function in `cli/commands/<name>.ts` wired into the dispatcher
in `cli/index.ts`.

For the checksum-gated *external* subcommand path (no source edit), see
`ollamas plugin --help` — this doc is for **first-party** subcommands.

## The pattern (from a real command)

Every command follows the same skeleton. `cli/commands/plugin.ts` is a clean example:

```ts
import { parseArgs } from "node:util";
import { resolveOutputCtx, c, formatTable } from "../lib/output";

const HELP = `ollamas mytool — one-line summary

  mytool list            do the read
  mytool run <arg>       do the thing

Longer note about behavior / gotchas.`;

export async function runMytool(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean" },
      // your flags…
    },
  });

  // TTY/NO_COLOR/--json aware output context.
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP + "\n");
    return values.help ? 0 : 2;      // 0 when help was asked for, 2 on misuse
  }

  const [action, arg1] = positionals;
  switch (action) {
    case "list": return listThings(ctx);
    case "run":  return runThing(arg1, ctx);
  }
  process.stderr.write(`mytool: unknown action '${action}' (list|run)\n`);
  return 2;
}
```

Key conventions:

- **`parseArgs` from `node:util`** — the only arg parser (no `commander`, no `yargs`).
- **Return an exit code** (`number`). `0` = success, `2` = usage error. `cli/index.ts`
  passes it straight to `process.exit`.
- **`--help`** prints the command's `HELP` string and returns `0`; a bare/invalid
  invocation prints help and returns `2`.

## Output: TTY / `--json` / color

Build an `OutputCtx` with `resolveOutputCtx(env, isTTY, json)` from `cli/lib/output.ts`
and route **all** output through it. It resolves color (respects `NO_COLOR`,
non-TTY, and `--json`) so the command behaves correctly when piped or scripted.

```ts
function listThings(ctx: { color: boolean; json: boolean }): number {
  const rows = load();                              // pure — no IO
  if (ctx.json) {                                   // machine-readable path first
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(formatTable(["name", "status"],                 // human path
    rows.map((r) => [r.name, c("green", r.status, ctx.color)]), ctx) + "\n");
  return 0;
}
```

Use the shared renderers in `cli/lib/output.ts`: `formatTable`, `formatDiff`,
`sparkline`, `bar`, `compactNum`, `c(code, s, enabled)` for color. Always gate color
on `ctx.color` — never emit raw ANSI unconditionally.

## Pure core + thin IO

Keep parsing/formatting/crypto in **pure functions** (no socket, no disk) so they are
unit-testable without a server, and keep IO (fetch, fs, stdout) in a thin outer shell.
This is the rule that lets the CLI ship with fast, socket-free tests.

## Register the command (3 edits in `cli/index.ts`)

1. **Import** the runner near the other command imports:
   ```ts
   import { runMytool } from "./commands/mytool";
   ```
2. **Dispatch** it in the `switch (command)` block:
   ```ts
   case "mytool":
     return runMytool(rest);
   ```
3. **Document** it — add a line to the top-level `HELP` string and an entry to
   `COMMAND_DESCRIPTIONS` (the one-liner used by the generated man page):
   ```ts
   mytool: "one-line description for the man page",
   ```

If the command takes completions, also extend `COMMAND_TREE` in `cli/lib/completion.ts`.

## Rules

- **Zero-dep:** only `node:*` built-ins (`node:util`, `node:readline`, `fetch`,
  `node:crypto`, `node:fs`, `node:child_process`). No npm runtime dependency.
- **Scope Law:** the CLI touches only `cli/**` and reaches the server only via
  `/api/*` + `/mcp`. Verify no leak:
  ```bash
  grep -rn --include="*.ts" "tool-registry" cli/    # must be empty
  ```
- **Quality gate (pre-ship):**
  ```bash
  npm run lint      # tsc --noEmit
  npm run test      # vitest run (fresh)
  ```
  Green before commit. Evidence-first: to claim it works, run it and show stdout.
