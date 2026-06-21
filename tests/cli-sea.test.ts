import { describe, it, expect } from "vitest";
import { seaConfigObject, postjectArgs, seaOutName, SEA_FUSE } from "../cli/lib/sea";

// Pure SEA build-helper tests — no node/postject/codesign call. The actual build
// runs in cli/build-sea.sh; here we lock the config + argv shape (mirrors keychain
// buildSecurityArgs: structure assertable without executing anything).

describe("seaConfigObject", () => {
  it("produces the Node SEA config with the warning disabled", () => {
    expect(seaConfigObject("dist/cli/index.cjs", "dist/sea-prep.blob")).toEqual({
      main: "dist/cli/index.cjs",
      output: "dist/sea-prep.blob",
      disableExperimentalSEAWarning: true,
    });
  });
});

describe("SEA_FUSE", () => {
  it("is the official Node sentinel fuse", () => {
    expect(SEA_FUSE).toBe("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
  });
});

describe("postjectArgs", () => {
  it("base argv: binary, NODE_SEA_BLOB resource, blob path, sentinel-fuse", () => {
    const a = postjectArgs("dist/ollamas-darwin-arm64", "dist/sea-prep.blob");
    expect(a[0]).toBe("dist/ollamas-darwin-arm64");
    expect(a[1]).toBe("NODE_SEA_BLOB"); // resource name Node looks up at runtime
    expect(a[2]).toBe("dist/sea-prep.blob");
    expect(a).toContain("--sentinel-fuse");
    expect(a).toContain(SEA_FUSE);
    expect(a).not.toContain("--macho-segment-name"); // omitted off-macOS
  });
  it("adds the Mach-O segment flag only when requested (macOS)", () => {
    const a = postjectArgs("dist/ollamas-darwin-arm64", "dist/sea-prep.blob", "NODE_SEA");
    expect(a).toContain("--macho-segment-name");
    expect(a[a.indexOf("--macho-segment-name") + 1]).toBe("NODE_SEA");
  });
});

describe("seaOutName (matches build-binary.sh naming → release matrix parity)", () => {
  it("darwin/arm64 → ollamas-darwin-arm64", () => {
    expect(seaOutName("darwin", "arm64")).toBe("ollamas-darwin-arm64");
  });
  it("linux/x64 → ollamas-linux-x64", () => {
    expect(seaOutName("linux", "x64")).toBe("ollamas-linux-x64");
  });
  it("normalizes aarch64 → arm64", () => {
    expect(seaOutName("linux", "aarch64")).toBe("ollamas-linux-arm64");
  });
});
