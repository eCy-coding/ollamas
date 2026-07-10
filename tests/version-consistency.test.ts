import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// tests/ lives at the repo root; step up one level to reach package.json + VERSION.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("version consistency", () => {
  it("package.json version equals the VERSION file (single source of truth)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const versionFile = readFileSync(join(root, "VERSION"), "utf8").trim();
    expect(pkg.version).toBe(versionFile);
  });

  it("package.json carries a real name and semver (not the react-example placeholder)", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe("ollamas");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).not.toBe("0.0.0");
  });
});
