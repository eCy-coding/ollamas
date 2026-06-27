import { describe, it, expect } from "vitest";
import { decideSigGate } from "../cli/commands/update";
import { parseManifest } from "../cli/lib/manifest";

// --- decideSigGate matrix ---
describe("decideSigGate (pure)", () => {
  it("pinned + sig present + ok → proceed", () => {
    const r = decideSigGate({ hasPinned: true, hasMinisig: true, verifyOk: true });
    expect(r.proceed).toBe(true);
    expect(r.reason).toBe("signature ok");
  });

  it("pinned + sig present + bad → abort", () => {
    const r = decideSigGate({ hasPinned: true, hasMinisig: true, verifyOk: false });
    expect(r.proceed).toBe(false);
    expect(r.reason).toMatch(/signature verification failed/);
  });

  it("pinned + NO sig → abort (fail-closed: unsigned asset refused)", () => {
    const r = decideSigGate({ hasPinned: true, hasMinisig: false, verifyOk: false });
    expect(r.proceed).toBe(false);
    expect(r.reason).toMatch(/unsigned asset/);
  });

  it("no pinned keys (bootstrap) → warn-proceed regardless of sig presence", () => {
    const r1 = decideSigGate({ hasPinned: false, hasMinisig: false, verifyOk: false });
    expect(r1.proceed).toBe(true);
    expect(r1.reason).toMatch(/bootstrap/);

    const r2 = decideSigGate({ hasPinned: false, hasMinisig: true, verifyOk: false });
    expect(r2.proceed).toBe(true);
  });
});

// --- parseManifest backward-compat: minisig field is optional ---
describe("parseManifest minisig back-compat", () => {
  it("parses old manifest without minisig (field absent)", () => {
    const m = parseManifest(
      JSON.stringify({
        version: "1.0.0",
        assets: [{ target: "darwin-arm64", url: "https://x/b", sha256: "a".repeat(64) }],
      }),
    );
    expect(m.assets[0].minisig).toBeUndefined();
    expect(m.assets[0].keyId).toBeUndefined();
  });

  it("parses new manifest with minisig body", () => {
    const m = parseManifest(
      JSON.stringify({
        version: "1.1.0",
        assets: [
          {
            target: "darwin-arm64",
            url: "https://x/b",
            sha256: "a".repeat(64),
            minisig: "untrusted comment: sig\nRWS...",
            keyId: "AABBCCDDEEFF0011",
          },
        ],
      }),
    );
    expect(m.assets[0].minisig).toBe("untrusted comment: sig\nRWS...");
    expect(m.assets[0].keyId).toBe("AABBCCDDEEFF0011");
  });

  it("parses new manifest with minisig as URL", () => {
    const m = parseManifest(
      JSON.stringify({
        version: "1.2.0",
        assets: [
          {
            target: "linux-x64",
            url: "https://x/b",
            sha256: "b".repeat(64),
            minisig: "https://releases.example.com/b.minisig",
          },
        ],
      }),
    );
    expect(m.assets[0].minisig).toMatch(/^https:/);
  });
});
