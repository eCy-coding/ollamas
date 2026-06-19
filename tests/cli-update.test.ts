import { describe, it, expect } from "vitest";
import { planUpdate } from "../cli/commands/update";
import { parseManifest } from "../cli/lib/manifest";

const manifest = parseManifest(
  JSON.stringify({
    version: "9.1.0",
    assets: [{ target: "darwin-arm64", url: "https://x/bin", sha256: "a".repeat(64) }],
  }),
);

describe("planUpdate (pure)", () => {
  it("up-to-date when current >= manifest", () => {
    expect(planUpdate(manifest, "9.1.0", "darwin-arm64").action).toBe("up-to-date");
    expect(planUpdate(manifest, "9.2.0", "darwin-arm64").action).toBe("up-to-date");
  });
  it("update when newer + asset present", () => {
    const p = planUpdate(manifest, "9.0.0", "darwin-arm64");
    expect(p.action).toBe("update");
    expect(p.asset?.url).toBe("https://x/bin");
    expect(p.latest).toBe("9.1.0");
  });
  it("no-asset when newer but no matching target", () => {
    const p = planUpdate(manifest, "9.0.0", "linux-x64");
    expect(p.action).toBe("no-asset");
    expect(p.asset).toBeUndefined();
  });
});
