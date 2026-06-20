import { describe, it, expect } from "vitest";
import {
  parseManifest,
  compareSemver,
  isNewer,
  currentTarget,
  selectAsset,
  sha256Hex,
  type Manifest,
} from "../cli/lib/manifest";

const GOOD = {
  version: "9.1.0",
  assets: [
    { target: "darwin-arm64", url: "https://x/ollamas-darwin-arm64", sha256: "a".repeat(64) },
    { target: "linux-x64", url: "https://x/ollamas-linux-x64", sha256: "b".repeat(64) },
  ],
};

describe("parseManifest", () => {
  it("accepts a well-formed manifest", () => {
    const m = parseManifest(JSON.stringify(GOOD));
    expect(m.version).toBe("9.1.0");
    expect(m.assets.length).toBe(2);
  });
  it("throws on bad shape", () => {
    expect(() => parseManifest("{}")).toThrow();
    expect(() => parseManifest(JSON.stringify({ version: "1.0.0" }))).toThrow(); // no assets
    expect(() => parseManifest(JSON.stringify({ version: "1.0.0", assets: [{ target: "x" }] }))).toThrow(); // asset missing url/sha
    expect(() => parseManifest("not json")).toThrow();
  });
});

describe("compareSemver / isNewer", () => {
  it("orders versions", () => {
    expect(compareSemver("9.0.0", "9.1.0")).toBe(-1);
    expect(compareSemver("10.0.0", "9.9.9")).toBe(1);
    expect(compareSemver("9.0.0", "9.0.0")).toBe(0);
    expect(compareSemver("9.2.0", "9.10.0")).toBe(-1); // numeric, not lexical
  });
  it("isNewer is strict greater", () => {
    expect(isNewer("9.0.0", "9.1.0")).toBe(true);
    expect(isNewer("9.1.0", "9.0.0")).toBe(false);
    expect(isNewer("9.1.0", "9.1.0")).toBe(false);
  });
  it("tolerates a leading v", () => {
    expect(isNewer("v9.0.0", "v9.1.0")).toBe(true);
  });
});

describe("currentTarget", () => {
  it("maps platform/arch to a target string", () => {
    expect(currentTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentTarget("linux", "x64")).toBe("linux-x64");
  });
});

describe("selectAsset", () => {
  const m: Manifest = parseManifest(JSON.stringify(GOOD));
  it("finds the asset for a target", () => {
    expect(selectAsset(m, "darwin-arm64")?.url).toContain("darwin-arm64");
  });
  it("returns undefined for a missing target", () => {
    expect(selectAsset(m, "windows-x64")).toBeUndefined();
  });
});

describe("sha256Hex", () => {
  it("hashes bytes deterministically (known vector)", () => {
    // sha256("") = e3b0c442...
    expect(sha256Hex(Buffer.from(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
