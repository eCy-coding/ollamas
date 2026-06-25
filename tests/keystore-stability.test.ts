import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// H10: when the key source is 'keychain' but the keychain WRITE fails (SSH / locked /
// no GUI), loadMasterKey used to write a FRESH random key to the keyfile on EVERY call,
// so a second call minted a different key and orphaned secrets sealed with the first.
// The fix falls back to loadOrCreateKeyfile() (stable). We simulate a failing keychain
// via a module mock so the real keychain is never touched.
vi.mock("../cli/lib/keychain", () => ({
  keychainAvailable: () => true, // route resolves to the "keychain" source
  readMasterKey: () => null,     // keychain has no stored key (miss)
  writeMasterKey: () => false,   // keychain WRITE fails (the SSH/locked case)
  deleteMasterKey: () => {},
  SERVICE: "test-service",
  ACCOUNT: "test-account",
}));

let HOME: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-ks-"));
  process.env.HOME = HOME; // os.homedir() → temp; keyfile lands under $HOME/.ollamas
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe("loadMasterKey keychain-write-fail fallback (H10)", () => {
  test("returns a STABLE key across calls when the keychain write fails", async () => {
    const ks = await import("../cli/lib/keystore");
    const k1 = ks.loadMasterKey({} as any);
    const k2 = ks.loadMasterKey({} as any);
    expect(k1.length).toBe(32);
    expect(Buffer.compare(k1, k2)).toBe(0); // same key both times (pre-fix: different randoms)
  });
});
