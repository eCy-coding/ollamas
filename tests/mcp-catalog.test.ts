import { describe, test, expect, beforeEach } from "vitest";
import path from "node:path";
import {
  CATALOG, FS_DIR_TEMPLATE, catalogFsDir, resolveArgs,
  checkAvailable, clearAvailabilityCache, decorateCatalog,
} from "../server/mcp/catalog";

// Servers moved to modelcontextprotocol/servers-archived — must never ship in the catalog.
const ARCHIVED = ["sqlite", "github", "slack", "brave", "postgres"];

describe("MCP catalog invariants (dalga-2)", () => {
  test("entries are unique, MIT, stdio, and never archived servers", () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG) {
      expect(e.license).toBe("MIT");
      expect(e.transport).toBe("stdio");
      expect(["npx", "uvx"]).toContain(e.requires);
      expect(e.command).toBe(e.requires); // command is the runtime itself
      expect(ARCHIVED).not.toContain(e.id);
      expect(e.args.length).toBeGreaterThan(0);
    }
  });

  test("outbound-capable entries are labeled (privacy transparency)", () => {
    const fetch = CATALOG.find((e) => e.id === "fetch")!;
    expect(fetch.tags).toContain("outbound-web");
    // Everything else in the catalog is local-only.
    for (const e of CATALOG.filter((x) => x.id !== "fetch")) {
      expect(e.tags).not.toContain("outbound-web");
    }
  });
});

describe("resolveArgs — filesystem sandbox", () => {
  test("expands the template to a dir under home and mkdirs it", () => {
    const made: string[] = [];
    const fsEntry = CATALOG.find((e) => e.id === "filesystem")!;
    const args = resolveArgs(fsEntry, "/fake/home", (p) => made.push(p));
    const dir = path.join("/fake/home", ".llm-mission-control", "mcp-fs");
    expect(args).toContain(dir);
    expect(args.join(" ")).not.toContain(FS_DIR_TEMPLATE);
    expect(made).toEqual([dir]);
    expect(catalogFsDir("/fake/home")).toBe(dir);
  });

  test("template-free entries pass through unchanged and never mkdir", () => {
    const made: string[] = [];
    const mem = CATALOG.find((e) => e.id === "memory")!;
    expect(resolveArgs(mem, "/fake/home", (p) => made.push(p))).toEqual(mem.args);
    expect(made).toEqual([]);
  });

  test("mkdir failure is fail-soft (args still resolve)", () => {
    const fsEntry = CATALOG.find((e) => e.id === "filesystem")!;
    const args = resolveArgs(fsEntry, "/fake/home", () => { throw new Error("disk full"); });
    expect(args.join(" ")).not.toContain(FS_DIR_TEMPLATE);
  });
});

describe("checkAvailable — injectable + cached", () => {
  beforeEach(() => clearAvailabilityCache());

  test("found → true; which-throw → false", () => {
    expect(checkAvailable("npx", () => "ok")).toBe(true);
    expect(checkAvailable("uvx", () => { throw new Error("not found"); })).toBe(false);
  });

  test("result is cached per command until cleared", () => {
    let calls = 0;
    const exec = () => { calls++; return "ok"; };
    checkAvailable("npx", exec);
    checkAvailable("npx", exec);
    expect(calls).toBe(1);
    clearAvailabilityCache();
    checkAvailable("npx", exec);
    expect(calls).toBe(2);
  });
});

describe("decorateCatalog — API shape", () => {
  beforeEach(() => clearAvailabilityCache());

  test("marks installed by id and availability by runtime", () => {
    const out = decorateCatalog(new Set(["memory"]), (cmd) => cmd === "npx", "/fake/home");
    const mem = out.find((e) => e.id === "memory")!;
    const git = out.find((e) => e.id === "git")!;
    expect(mem.installed).toBe(true);
    expect(mem.available).toBe(true);
    expect(git.installed).toBe(false);
    expect(git.available).toBe(false); // uvx missing
    // Args are concrete — no template leaks to the API.
    for (const e of out) expect(e.args.join(" ")).not.toContain(FS_DIR_TEMPLATE);
  });
});
