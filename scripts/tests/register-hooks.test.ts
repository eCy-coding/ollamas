// v5 Registration Hooks — manifest-driven ToolRegistry.register proof.
// Verifies the scripts-owned seam: inventory.json -> zod-validated -> reconciled
// into the registry (register-if-absent, skip-if-present), idempotent, with the
// OpenAI function-call schema shape the choke-point expects.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHostScripts, buildToolDef, loadInventory, DEFAULT_INVENTORY } from "../../bin/host-bridge/register-host-scripts.mjs";
import { SCHEMAS, toJsonSchema, validateArgs } from "../../bin/host-bridge/schema.mjs";

const INVENTORY = JSON.parse(readFileSync(join(__dirname, "..", "inventory.json"), "utf8"));

// Mock registry mirroring ToolRegistry's DYNAMIC store + has() (server/tool-registry.ts).
function makeRegistry(seed: string[] = []) {
  const store: Record<string, any> = {};
  for (const n of seed) store[n] = { tier: "safe", schema: {}, invoke: async () => ({}) };
  return {
    store,
    register(name: string, def: any) { store[name] = def; },
    has(name: string) { return name in store; },
    unregisterByPrefix(prefix: string) {
      let n = 0;
      for (const k of Object.keys(store)) if (k.startsWith(prefix)) { delete store[k]; n++; }
      return n;
    },
    list() { return Object.keys(store); },
  };
}

// Mock host deps mirroring server.ts TOOL_DEPS (only what the seam touches).
function makeDeps() {
  const calls: string[] = [];
  return {
    calls,
    HOST_TOOLS_DIR: "/HOST/bin/host-bridge/tools",
    shArg: (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`,
    execOnHost: vi.fn((cmd: string, _timeout?: number) => { calls.push(cmd); return Promise.resolve({ ok: true, cmd }); }),
  };
}

describe("inventory.json manifest", () => {
  it("every tool has name/tier/entry + matching schema + builder", () => {
    expect(INVENTORY.tools.length).toBeGreaterThan(0);
    for (const t of INVENTORY.tools) {
      expect(t.name).toBeTruthy();
      expect(["safe", "host", "privileged", "host_upstream"]).toContain(t.tier);
      expect(t.entry).toMatch(/\.mjs$/);
      expect(SCHEMAS[t.name], `schema for ${t.name}`).toBeDefined();
    }
  });

  it("loadInventory accepts the real manifest (drift guard)", () => {
    expect(() => loadInventory(DEFAULT_INVENTORY)).not.toThrow();
  });
});

describe("registerHostScripts (reconciler)", () => {
  it("registers every manifest tool into an empty registry, with manifest tiers", () => {
    const reg = makeRegistry();
    const res = registerHostScripts(reg, makeDeps());
    expect(res.registered).toBe(INVENTORY.tools.length);
    expect(res.skipped).toBe(0);
    expect(reg.store["kill_process"].tier).toBe("host");
    expect(reg.store["health_probe"].tier).toBe("safe");
  });

  it("is idempotent — re-running registers nothing, skips all (no duplicates)", () => {
    const reg = makeRegistry();
    registerHostScripts(reg, makeDeps());
    const res2 = registerHostScripts(reg, makeDeps());
    expect(res2.registered).toBe(0);
    expect(res2.skipped).toBe(INVENTORY.tools.length);
    expect(reg.list().length).toBe(INVENTORY.tools.length); // stable, not doubled
  });

  it("skips tools already present (static built-ins) — non-breaking at boot", () => {
    const reg = makeRegistry(["health_probe", "run_tests"]);
    const res = registerHostScripts(reg, makeDeps());
    expect(res.skipped).toBe(2);
    expect(res.registered).toBe(INVENTORY.tools.length - 2);
    expect(res.skipped_names).toContain("health_probe");
  });

  it("exposes the OpenAI function schema shape the choke-point reads", () => {
    const reg = makeRegistry();
    registerHostScripts(reg, makeDeps());
    const s = reg.store["process_port"].schema;
    expect(s.type).toBe("function");
    expect(s.function.name).toBe("process_port");
    expect(s.function.parameters.type).toBe("object");
    expect(s.function.parameters.properties).toHaveProperty("port");
  });
});

describe("invoke — choke-point + validation", () => {
  it("routes through execOnHost with the right argv (git_commit --push)", async () => {
    const deps = makeDeps();
    const { def } = buildToolDef({ name: "git_commit", tier: "host", entry: "git_commit.mjs", description: "x" }, deps);
    await def.invoke({ message: "feat: x", push: true });
    expect(deps.calls[0]).toContain("/git_commit.mjs --push 'feat: x'");
  });

  it("apply_patch pipes the diff via stdin (printf | tool)", async () => {
    const deps = makeDeps();
    const { def } = buildToolDef({ name: "apply_patch", tier: "host", entry: "apply_patch.mjs", description: "x" }, deps);
    await def.invoke({ diff: "diff --git a b" });
    expect(deps.calls[0]).toMatch(/^printf '%s' '.*' \| node .*\/apply_patch\.mjs$/);
  });

  it("logbook tail uses default n=20", async () => {
    const deps = makeDeps();
    const { def } = buildToolDef({ name: "logbook", tier: "safe", entry: "logbook.mjs", description: "x" }, deps);
    await def.invoke({ action: "tail" });
    expect(deps.calls[0]).toContain("/logbook.mjs tail 20");
  });

  it("rejects invalid args before reaching the host (zod)", async () => {
    const deps = makeDeps();
    const { def } = buildToolDef({ name: "git_commit", tier: "host", entry: "git_commit.mjs", description: "x" }, deps);
    await expect(def.invoke({ push: true })).rejects.toThrow(); // missing required message
    expect(deps.execOnHost).not.toHaveBeenCalled();
  });

  it("strips unknown args (strict schema)", () => {
    expect(() => validateArgs("health_probe", { sneaky: 1 })).toThrow();
  });
});

describe("toJsonSchema", () => {
  it("drops $schema wrapper, keeps object body", () => {
    const js = toJsonSchema(SCHEMAS.kill_process) as any;
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe("object");
    expect(js.properties).toHaveProperty("target");
  });
});
