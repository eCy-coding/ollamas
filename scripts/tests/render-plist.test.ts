// Scripts domain v16 — LaunchAgent plist render. Inject machine values, reject any
// surviving REPLACE_WITH_ placeholder (integrity), require absolute paths + token.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderPlist, TEMPLATE_PATH, PLIST_LABEL } from "../../bin/host-bridge/render-plist.mjs";

const TEMPLATE = readFileSync(TEMPLATE_PATH, "utf8");
const ok = { repoPath: "/Users/x/ollamas-scripts-wt", token: "abc123", nodePath: "/opt/homebrew/bin/node", port: 7345 };

describe("renderPlist", () => {
  test("injects node path, repo path, token; no placeholder remains", () => {
    const out = renderPlist(TEMPLATE, ok);
    expect(out).not.toContain("REPLACE_WITH");
    expect(out).not.toContain("/usr/local/bin/node");
    expect(out).toContain("/opt/homebrew/bin/node");
    expect(out).toContain("/Users/x/ollamas-scripts-wt/bin/host-bridge/terminal-bridge.mjs");
    expect(out).toContain("<string>abc123</string>");
    expect(out).toContain(`<string>${PLIST_LABEL}</string>`);
  });

  test("custom port is injected into EnvironmentVariables", () => {
    const out = renderPlist(TEMPLATE, { ...ok, port: 7400 });
    expect(out).toMatch(/<key>PORT<\/key>\s*<string>7400<\/string>/);
  });

  test("deterministic / idempotent", () => {
    expect(renderPlist(TEMPLATE, ok)).toBe(renderPlist(TEMPLATE, ok));
  });

  test("rejects missing token", () => {
    expect(() => renderPlist(TEMPLATE, { ...ok, token: "" })).toThrow(/token required/);
  });

  test("rejects relative repo/node paths", () => {
    expect(() => renderPlist(TEMPLATE, { ...ok, repoPath: "rel/path" })).toThrow(/absolute/);
    expect(() => renderPlist(TEMPLATE, { ...ok, nodePath: "node" })).toThrow(/absolute/);
  });

  test("guards against an unresolved placeholder (corrupt template)", () => {
    const corrupt = TEMPLATE + "\n<!-- REPLACE_WITH_SOMETHING_NEW -->";
    expect(() => renderPlist(corrupt, ok)).toThrow(/unresolved REPLACE_WITH/);
  });
});
