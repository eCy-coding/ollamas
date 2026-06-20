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

  // External known-answer anchor: the HMAC-SHA256 primitive must match the
  // RFC 4231 published constants (also used by C2SP/wycheproof). This proves
  // correctness, not just self-consistency — and the same kats[] drive the
  // Swift CryptoKit parity test, so all three implementations meet one reference.
  const RFC4231 = {
    "4231#1": "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    "4231#2": "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    "4231#3": "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    "4231#4": "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
  } as const;

  test("HMAC-SHA256 KATs match RFC 4231 published constants", () => {
    const { kats } = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(kats.length).toBe(Object.keys(RFC4231).length);
    for (const k of kats) {
      expect(k.mac).toMatch(/^[0-9a-f]{64}$/);
      expect(k.mac).toBe(RFC4231[k.rfc as keyof typeof RFC4231]);
    }
  });
});
