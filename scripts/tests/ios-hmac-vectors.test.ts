// Scripts domain v3 — drift guard for the iOS HMAC parity fixture.
// The committed bin/ios-bridge/hmac-vectors.json is the cross-language contract
// the Swift mirror tests against. If bin/host-bridge/hmac.mjs changes, the
// fixture goes stale; this fails so the fixture (and Swift side) get updated.
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildVectors } from "../../bin/ios-bridge/gen-vectors.mjs";

const FIXTURE = path.resolve(__dirname, "../../bin/ios-bridge/hmac-vectors.json");

describe("iOS HMAC vectors fixture", () => {
  test("committed fixture matches freshly generated vectors (regen drift guard)", () => {
    const committed = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const fresh = buildVectors();
    expect(committed).toEqual(fresh);
  });

  test("every vector carries a 64-hex sha256 signature", () => {
    const { vectors } = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(vectors.length).toBeGreaterThan(0);
    for (const v of vectors) {
      expect(v.signature).toMatch(/^[0-9a-f]{64}$/);
      // canonical = METHOD\nPATH\nBODY\nTS\nNONCE; BODY may itself contain
      // newlines, so assert the structural prefix rather than a field count.
      expect(v.canonical.startsWith(`${v.method.toUpperCase()}\n${v.path}\n`)).toBe(true);
      expect(v.canonical.endsWith(`\n${v.timestamp}\n${v.nonce}`)).toBe(true);
    }
  });
});
