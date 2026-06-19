// v6 ERR-SCR-003 — bridge-client REPO must not be a hardcoded home path.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(__dirname, "..", "..");
const CLIENT = join(ROOT, "bin", "host-bridge", "tools", "lib", "bridge-client.mjs");

// Resolve REPO in a fresh node process (real isolation; avoids vitest module cache).
function resolveRepo(env: Record<string, string> = {}): string {
  return execFileSync("node", ["-e", "import('./bin/host-bridge/tools/lib/bridge-client.mjs').then(m=>process.stdout.write(m.REPO))"],
    { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
}

describe("ERR-SCR-003: bridge-client REPO portability", () => {
  it("source has no hardcoded absolute home path", () => {
    const src = readFileSync(CLIENT, "utf8");
    expect(src).not.toMatch(/["']\/Users\/[^"']+["']/); // no "/Users/.../..." literal
    expect(src).toContain("OLLAMAS_REPO");
    expect(src).toContain("import.meta.url");
  });

  it("respects OLLAMAS_REPO env override", () => {
    expect(resolveRepo({ OLLAMAS_REPO: "/tmp/custom-repo" })).toBe("/tmp/custom-repo");
  });

  it("default derives an absolute path (repo root), not a hardcoded literal", () => {
    const repo = resolveRepo({ OLLAMAS_REPO: "" });
    expect(repo.startsWith("/")).toBe(true);
    expect(repo).toMatch(/ollamas/); // derived from this checkout's location
  });
});
