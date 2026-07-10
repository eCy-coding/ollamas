# Adding a Tool

ollamas runs **every** workspace tool call through one choke-point:
`ToolRegistry.execute` in [`server/tool-registry.ts`](../server/tool-registry.ts).
The ReAct loop, the MCP expose side, and the MCP consume side all dispatch here —
there is never a second dispatch path. Metering, auth, per-tenant allowlists,
rate-limiting and output-schema validation all hook this single point
(`server/tool-registry.ts:1`).

A "tool" is a named function with a JSON-schema input, a security **tier**, and an
`invoke` thunk. This guide shows the two ways to add one and how the tier you pick
maps to MCP behavior.

## 1. Pick a tier

Tiers are the `ToolTier` union at `server/tool-registry.ts:43`:

```ts
export type ToolTier = "safe" | "host" | "privileged" | "host_upstream";
```

The tier is a security contract, not a label. It gates which tenant plans and
which OAuth scopes may call the tool (`ToolRegistry.execute`, per-tenant
`allowedTiers` and `tools:<tier>` scope checks) and it drives the MCP annotations
advertised to clients.

| Tier | Use when | Blast radius | Example tools |
|------|----------|--------------|---------------|
| `safe` | Read-only workspace introspection: list files, read a file, search, count tokens, run the sandboxed test suite. **No mutation, no host reach.** | None — pure reads inside the workspace | `list_tree` (`:197`), `read_file` (`:206`), `run_tests` (`:379`) |
| `host` | Runs work on the host via the injected bridge helpers but through a **guarded/sandboxed path** (allowlist, bounded scope): revenue ops, audits, admin actions. | Host process, but constrained | `test_generate` (`:385`), `code_audit` (`:399`), `contract_admin` (`:413`) |
| `privileged` | **Unsandboxed host power** — writes host files, drives a real terminal, applies file writes to disk. No allowlist stands between the arg and the host. | Full host filesystem / shell | `macos_terminal` (`:337`), `write_host_file` (`:359`), `write_file` |
| `host_upstream` | A tool **merged from an untrusted upstream MCP server** (consume side). Never exposed by default so it cannot reach a tenant unless a plan/admin explicitly allows this tier. | Whatever the upstream server does — treat as open-world | dynamically registered upstream tools |

### Why the tiers exist (threat model)

- `safe` reads cannot exfiltrate outside the workspace or mutate anything, so they
  are the only tier a caller with no OAuth scope may run (`tool.tier !== "safe"`
  requires the `tools:<tier>` scope in `execute`).
- `privileged` tools bypass the allowlist that `host` tools sit behind — that is
  precisely why `macos_terminal`'s description says "no sandbox/allowlist — full
  host privileges." Reserve it for genuinely host-authoring tools and expect it to
  be gated hard by plan and scope.
- `host_upstream` is quarantined by default: `MCP_EXPOSE_TIERS` in `.env.example`
  ships as `safe,host,privileged` (no `host_upstream`), so an upstream tool you
  consume never silently becomes something your tenants can invoke.

**Rule of thumb:** start at the lowest tier that works. If the tool only reads the
workspace → `safe`. If it reaches the host but through a bounded/guarded helper →
`host`. Only use `privileged` when the tool must write host files or run arbitrary
host shell.

## 2. Write the `ToolDef`

The shape (`server/tool-registry.ts:106`):

```ts
interface ToolDef {
  tier: ToolTier;
  schema: ToolSchema;             // OpenAI function schema — also used as MCP inputSchema
  invoke: (args: any, ctx: ToolCtx) => Promise<any | {
    output: any; diff?: string; applied?: boolean; halt?: boolean;
  }>;
}
```

Use the `fn(name, description, parameters, outputSchema?)` helper (`:113`) to build
the schema and `NO_ARGS` (`:117`) for parameterless tools. Host power (running a
command, writing a host file) is **not** imported directly — it arrives via
`ctx.deps` (`ToolDeps`, `:46`) so the registry never circularly imports
`server.ts`.

### Example — a `safe` tool (inline)

```ts
word_count: {
  tier: "safe",
  schema: fn("word_count", "Count words in a workspace file.", {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative file path." } },
    required: ["path"],
  }),
  invoke: async (args, { isLive, workspaceRoot, deps }) => {
    const text = await deps.FilesystemManager.readFile(isLive, workspaceRoot, String(args.path));
    return { words: text.trim().split(/\s+/).filter(Boolean).length };
  },
},
```

### Example — a `privileged` tool (reaches the host)

```ts
touch_host_file: {
  tier: "privileged",
  schema: fn("touch_host_file", "Create an empty file on the macOS host.", {
    type: "object",
    properties: { path: { type: "string", description: "Absolute host path." } },
    required: ["path"],
  }),
  // Host reach is injected — never import server.ts here.
  invoke: async (args, { deps, abortSignal }) =>
    deps.writeHostFile(String(args.path), "", abortSignal),
},
```

`invoke` returns the raw output for the normal case. For an approval flow return a
partial `ToolResult` — e.g. `{ output, diff, halt: true }` to pause the ReAct loop
for manual approval (this is how `write_file` behaves when `MCP_AUTO_APPLY=0`).
`execute` normalizes everything and **never throws**; callers read `ok`.

## 3. Inline `TOOLS` vs dynamic `register`

There are two registration paths:

| | Inline `TOOLS` map | `ToolRegistry.register` (`:852`) |
|---|---|---|
| Where | The `TOOLS: Record<string, ToolDef>` literal at `server/tool-registry.ts:195` | Called at runtime |
| For | **Built-in, first-party** tools shipped with ollamas | **Upstream MCP tools** merged in on the consume side (Faz 1) |
| Ownership | Always shared (ownerless) | Optional `owner` (tenantId) → tool is visible/invokable by that tenant only (Faz 24 isolation via the `OWNERS` map, never name-parsing) |
| Removal | Edit the source | `unregisterByPrefix(prefix)` when an upstream is deleted |

Add a first-party tool by inserting a `ToolDef` into the `TOOLS` literal. Add an
upstream/consumed tool with:

```ts
ToolRegistry.register("mcp__weather__forecast", {
  tier: "host_upstream",          // untrusted upstream → quarantined tier
  schema: fn("mcp__weather__forecast", "Upstream forecast tool.", { /* ... */ }),
  invoke: async (args, ctx) => callUpstream("weather", "forecast", args, ctx),
}, tenantId /* optional: scope to one tenant */);
```

## 4. Tier → MCP annotation mapping

`tools/list` derives the MCP annotations purely from the tier
(`server/mcp/server.ts:108`):

| Tier | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
|------|:---:|:---:|:---:|
| `safe` | `true` | `false` | `false` |
| `host` | `false` | `true` | `false` |
| `privileged` | `false` | `true` | `false` |
| `host_upstream` | `false` | `true` | `true` |

```ts
annotations: {
  readOnlyHint:    t.tier === "safe",
  destructiveHint: t.tier !== "safe",
  openWorldHint:   t.tier === "host_upstream",
}
```

Clients use these hints to decide whether to gate a call behind human approval — the
`ollamas mcp call` CLI, for instance, fires its HIL (human-in-the-loop) prompt when
`destructiveHint` or `openWorldHint` is set. Pick the tier correctly and the safety
UX downstream follows for free.

> If you author the tool against the **MCP TypeScript SDK** directly
> (`server.registerTool`), the annotations are advisory — you still enforce the tier
> in your handler. Inside ollamas, always go through `ToolRegistry` so the choke-point
> owns metering, auth and per-tenant gating.

## 5. Verify

```bash
npm run lint          # tsc --noEmit — the ToolDef must type-check
npm run test          # vitest run — full suite, including the tool contract tests
```

Then exercise it end-to-end: list it over `/mcp` (`ollamas mcp tools`) and call it
(`ollamas mcp call <name> --arg k=v`). See [`api-quickstart.md`](./api-quickstart.md).
