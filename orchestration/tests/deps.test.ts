import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrewfile, binName, severityOf, classify, summarize } from "../bin/lib/deps";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const SAMPLE = `
# header
# === TIER: core ===
brew "jq"
brew "ollama"
# === TIER: dev ===
brew "gh"
# === TIER: tunnel ===
brew "wireguard-tools"
# === TIER: cask ===
cask "docker"
`;

describe("parseBrewfile", () => {
  const deps = parseBrewfile(SAMPLE);
  it("parses brew + cask with the right tier", () => {
    expect(deps).toEqual([
      { name: "jq", tier: "core", cask: false },
      { name: "ollama", tier: "core", cask: false },
      { name: "gh", tier: "dev", cask: false },
      { name: "wireguard-tools", tier: "tunnel", cask: false },
      { name: "docker", tier: "cask", cask: true },
    ]);
  });
  it("ignores comments/blank lines", () => { expect(parseBrewfile("# x\n\n").length).toBe(0); });
});

describe("binName / severityOf", () => {
  it("overrides formula→binary where they differ", () => {
    expect(binName({ name: "wireguard-tools", tier: "tunnel", cask: false })).toBe("wg");
    expect(binName({ name: "librsvg", tier: "asset", cask: false })).toBe("rsvg-convert");
    expect(binName({ name: "imagemagick", tier: "asset", cask: false })).toBe("magick");
    expect(binName({ name: "jq", tier: "core", cask: false })).toBe("jq");
  });
  it("core missing blocks; else warns", () => {
    expect(severityOf("core")).toBe("BLOCK");
    expect(severityOf("tunnel")).toBe("WARN");
  });
});

describe("classify / summarize", () => {
  const deps = parseBrewfile(SAMPLE);
  const present = (bin: string) => bin === "jq" || bin === "ollama"; // only core present
  const st = classify(deps, present);
  it("marks presence + severity", () => {
    expect(st.find((s) => s.name === "gh")!.present).toBe(false);
    expect(st.find((s) => s.name === "jq")!.present).toBe(true);
  });
  it("summary counts missing + core-blocks", () => {
    const s = summarize(st);
    expect(s.total).toBe(5);
    expect(s.present).toBe(2);
    expect(s.missing).toBe(3);
    expect(s.missingBlock).toBe(0); // gh/wireguard/docker are non-core
  });
});

describe("real Brewfile integrity", () => {
  it("parses the repo Brewfile with a core tier present", () => {
    const bf = join(REPO, "Brewfile");
    expect(existsSync(bf)).toBe(true);
    const deps = parseBrewfile(readFileSync(bf, "utf8"));
    expect(deps.length).toBeGreaterThan(10);
    expect(deps.some((d) => d.tier === "core")).toBe(true);
    expect(deps.every((d) => d.name.length > 0)).toBe(true);
  });
});
