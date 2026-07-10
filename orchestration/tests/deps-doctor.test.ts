// deps-doctor.test.ts — behavior of the deps-doctor.ts pure pipeline: parse Brewfile → classify with a
// presence predicate → summarize → derive the boot-blocker gate. This mirrors exactly what the CLI shell
// composes (only `command -v` presence + `writeFileSync` are IO in deps-doctor.ts).
import { describe, it, expect } from "vitest";
import { parseBrewfile, binName, severityOf, classify, summarize } from "../bin/lib/deps";

const BREWFILE = `
# === TIER: core ===
brew "jq"
brew "ollama"
brew "wireguard-tools"
# === TIER: dev ===
brew "gh"
# === TIER: cask ===
cask "docker-desktop"
`;

describe("deps-doctor pipeline", () => {
  it("parses tiers, formulae vs casks, in order", () => {
    const deps = parseBrewfile(BREWFILE);
    expect(deps.map((d) => `${d.tier}:${d.name}:${d.cask ? "cask" : "brew"}`)).toEqual([
      "core:jq:brew",
      "core:ollama:brew",
      "core:wireguard-tools:brew",
      "dev:gh:brew",
      "cask:docker-desktop:cask",
    ]);
  });

  it("resolves probe binaries via overrides and maps core→BLOCK, others→WARN", () => {
    expect(binName({ name: "wireguard-tools", tier: "core", cask: false })).toBe("wg");
    expect(binName({ name: "docker-desktop", tier: "cask", cask: true })).toBe("docker");
    expect(binName({ name: "jq", tier: "core", cask: false })).toBe("jq");
    expect(severityOf("core")).toBe("BLOCK");
    expect(severityOf("dev")).toBe("WARN");
  });

  it("flags a missing CORE dep as a boot blocker; a missing non-core dep only warns", () => {
    const deps = parseBrewfile(BREWFILE);
    // present set is missing `wg` (core) and `gh` (dev)
    const present = new Set(["jq", "ollama", "docker"]);
    const statuses = classify(deps, (bin) => present.has(bin));
    const sum = summarize(statuses);
    expect(sum.total).toBe(5);
    expect(sum.present).toBe(3);
    expect(sum.missing).toBe(2);
    expect(sum.missingBlock).toBe(1);               // only wireguard-tools (core) blocks boot
    expect(sum.missingByTier).toEqual({ core: 1, dev: 1 });
  });

  it("reports zero blockers when every core dep is present", () => {
    const deps = parseBrewfile(BREWFILE);
    const statuses = classify(deps, () => true);
    expect(summarize(statuses).missingBlock).toBe(0);
  });
});
