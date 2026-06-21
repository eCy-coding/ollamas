import { describe, it, expect } from "vitest";
import { parsePluginRegistry, findPlugin, isValidPluginName, type PluginEntry } from "../cli/lib/plugins";

describe("parsePluginRegistry", () => {
  it("parses a registry object or array", () => {
    const json = JSON.stringify({ plugins: [{ name: "lint", path: "/p/lint", sha256: "a".repeat(64) }] });
    const e = parsePluginRegistry(json);
    expect(e.length).toBe(1);
    expect(e[0]).toMatchObject({ name: "lint", path: "/p/lint" });
  });
  it("tolerates missing/blank file → empty list", () => {
    expect(parsePluginRegistry("")).toEqual([]);
    expect(parsePluginRegistry("not json")).toEqual([]);
    expect(parsePluginRegistry("{}")).toEqual([]);
  });
  it("drops malformed entries", () => {
    const json = JSON.stringify({ plugins: [{ name: "ok", path: "/p", sha256: "a".repeat(64) }, { name: "bad" }] });
    expect(parsePluginRegistry(json).map((e) => e.name)).toEqual(["ok"]);
  });
});

describe("findPlugin", () => {
  const entries: PluginEntry[] = [
    { name: "lint", path: "/p/lint", sha256: "a".repeat(64) },
    { name: "deploy", path: "/p/deploy", sha256: "b".repeat(64) },
  ];
  it("finds by exact name", () => {
    expect(findPlugin(entries, "deploy")?.path).toBe("/p/deploy");
  });
  it("returns undefined for an unknown name", () => {
    expect(findPlugin(entries, "nope")).toBeUndefined();
  });
});

describe("isValidPluginName (path-traversal guard)", () => {
  it("accepts kebab/alnum names", () => {
    expect(isValidPluginName("lint")).toBe(true);
    expect(isValidPluginName("my-tool2")).toBe(true);
  });
  it("rejects traversal / separators / empty", () => {
    expect(isValidPluginName("../etc")).toBe(false);
    expect(isValidPluginName("a/b")).toBe(false);
    expect(isValidPluginName("a b")).toBe(false);
    expect(isValidPluginName("")).toBe(false);
    expect(isValidPluginName("UPPER")).toBe(false);
  });
});
