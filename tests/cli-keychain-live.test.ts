import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readMasterKey, writeMasterKey, deleteMasterKey, keychainAvailable } from "../cli/lib/keychain";

// Live macOS keychain probe — OPT-IN (OLLAMAS_LIVE_KEYCHAIN=1) so the default
// `npm test` never triggers a keychain access prompt. It uses a clearly-named TEST
// service/account; the real `ollamas/master-key` item is NEVER touched. The login
// keychain is per-USER (not HOME-scoped), so a temp HOME can't isolate the real
// service — a dedicated, always-cleaned-up test item is the safe boundary.
//
//   OLLAMAS_LIVE_KEYCHAIN=1 npx vitest run tests/cli-keychain-live.test.ts
const live = process.platform === "darwin" && process.env.OLLAMAS_LIVE_KEYCHAIN === "1";
const SVC = "ollamas-test-probe";
const ACCT = "v11-live";

// gated: OLLAMAS_LIVE_KEYCHAIN=1 (macOS) — round-trips a REAL Keychain TEST item; opt-in so CI never triggers a keychain prompt.
describe.skipIf(!live)("live keychain round-trip (macOS, opt-in, TEST item only)", () => {
  afterAll(() => {
    deleteMasterKey(SVC, ACCT); // belt-and-suspenders cleanup, even on failure
  });

  it("keychainAvailable() is true on this darwin host", () => {
    expect(keychainAvailable()).toBe(true);
  });

  it("write → read recovers the exact 32 bytes; delete → miss (null)", () => {
    const key = randomBytes(32);
    expect(writeMasterKey(key, SVC, ACCT)).toBe(true);
    const back = readMasterKey(SVC, ACCT);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(32);
    expect(back!.equals(key)).toBe(true); // exact byte fidelity through base64 round-trip
    expect(deleteMasterKey(SVC, ACCT)).toBe(true);
    expect(readMasterKey(SVC, ACCT)).toBeNull(); // gone after delete
  });

  it("-U upsert: a second write overwrites the item without an 'already exists' error", () => {
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    expect(writeMasterKey(k1, SVC, ACCT)).toBe(true);
    expect(writeMasterKey(k2, SVC, ACCT)).toBe(true); // upsert
    expect(readMasterKey(SVC, ACCT)!.equals(k2)).toBe(true);
    deleteMasterKey(SVC, ACCT);
  });
});
