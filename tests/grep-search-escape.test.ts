import { describe, test, expect, vi } from "vitest";
import { ToolRegistry, type ToolCtx, type ToolDeps } from "../server/tool-registry";

// H5: grep_search interpolated the query raw into `grep -rnI "${query}" .`, so a query
// with a double-quote broke the command (no matches in LIVE mode) and shell metachars
// could inject. The fix shArg-quotes the query + uses -F (literal) + `--`.
const shArg = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function depsCapturing(sink: { cmd: string }): ToolDeps {
  return {
    FilesystemManager: {} as any,
    TerminalManager: { execute: async (_l: boolean, _w: string, c: string) => { sink.cmd = c; return "ok"; } },
    runOnHostTerminal: async () => "term",
    writeHostFile: async () => "wrote",
    execOnHost: async () => "exec",
    HOST_TOOLS_DIR: "/tmp/tools",
    shArg,
    db: { logSecurity: vi.fn() },
  } as unknown as ToolDeps;
}
const ctx = (deps: ToolDeps): ToolCtx => ({ isLive: true, workspaceRoot: "/ws", autoApply: false, allowedTiers: ["safe"], deps } as any);

describe("grep_search shell-safety (H5)", () => {
  test("query is shArg-escaped + -F literal + -- guarded (no injection)", async () => {
    const sink = { cmd: "" };
    const r = await ToolRegistry.execute("grep_search", { query: `foo"; rm -rf / #` }, ctx(depsCapturing(sink)));
    expect(r.ok).toBe(true);
    expect(sink.cmd).toContain("-rnIF -- "); // -F literal match + `--` end-of-options
    expect(sink.cmd).toContain(`'foo"; rm -rf / #'`); // single-quoted → shell-inert
    expect(sink.cmd).not.toContain(`"foo`); // no raw double-quote interpolation remains
  });

  test("a single-quote in the query is POSIX-escaped, not a break-out", async () => {
    const sink = { cmd: "" };
    await ToolRegistry.execute("grep_search", { query: `it's` }, ctx(depsCapturing(sink)));
    expect(sink.cmd).toContain(`'it'\\''s'`);
  });
});
