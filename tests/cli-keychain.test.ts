import { describe, it, expect } from "vitest";
import { buildSecurityArgs, keychainAvailable, SERVICE, ACCOUNT } from "../cli/lib/keychain";

// Pure-fn tests only — no /usr/bin/security call, no real keychain item touched.
// The live write→read→delete round-trip is a separate macOS-guarded probe (Phase 4)
// that uses a TEST service, never the real master key.

describe("buildSecurityArgs (pure, structure assertable without leaking the secret)", () => {
  it("read → find-generic-password with -w, service+account, NO secret slot", () => {
    const a = buildSecurityArgs("read", "svc", "acct");
    expect(a[0]).toBe("find-generic-password");
    expect(a).toContain("-s");
    expect(a).toContain("svc");
    expect(a).toContain("-a");
    expect(a).toContain("acct");
    expect(a).toContain("-w"); // -w → emit the password to stdout
    expect(a.length).toBe(6);
  });

  it("delete → delete-generic-password, service+account, no -w", () => {
    const a = buildSecurityArgs("delete", "svc", "acct");
    expect(a[0]).toBe("delete-generic-password");
    expect(a).toContain("svc");
    expect(a).toContain("acct");
    expect(a).not.toContain("-w");
  });

  it("write → add-generic-password with -U (upsert); secret is the LAST element only", () => {
    const a = buildSecurityArgs("write", "svc", "acct", "QkFTRTY0");
    expect(a[0]).toBe("add-generic-password");
    expect(a).toContain("-U"); // update-if-present, so a re-write never errors
    expect(a[a.length - 1]).toBe("QkFTRTY0"); // secret last
    // the secret must NOT appear anywhere but the final slot
    expect(a.slice(0, -1)).not.toContain("QkFTRTY0");
  });

  it("write secret defaults to empty string when omitted", () => {
    const a = buildSecurityArgs("write", "svc", "acct");
    expect(a[a.length - 1]).toBe("");
  });

  it("exposes the real default SERVICE/ACCOUNT constants", () => {
    expect(SERVICE).toBe("ollamas");
    expect(ACCOUNT).toBe("master-key");
    // a build with the real constants still places the service/account explicitly
    const a = buildSecurityArgs("read", SERVICE, ACCOUNT);
    expect(a).toContain("ollamas");
    expect(a).toContain("master-key");
  });
});

describe("keychainAvailable (darwin-only — every other platform degrades to keyfile)", () => {
  it("false on linux", () => expect(keychainAvailable("linux")).toBe(false));
  it("false on win32", () => expect(keychainAvailable("win32")).toBe(false));
  it("true on darwin", () => expect(keychainAvailable("darwin")).toBe(true));
});
