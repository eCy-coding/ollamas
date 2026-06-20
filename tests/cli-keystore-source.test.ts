import { describe, it, expect } from "vitest";
import { resolveKeySource } from "../cli/lib/keystore";

// Pure precedence matrix — no I/O, no real keychain/keyfile. The whole safety of v11
// rests on this function being unambiguous: a wrong source silently orphans every
// sealed *Enc secret. Order under test:
//   passphrase > explicit-env > marker > existing-keyfile(back-compat) > keychain-default > file
const E = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({ ...over }) as NodeJS.ProcessEnv;

describe("resolveKeySource precedence", () => {
  it("OLLAMAS_PASSPHRASE wins over everything", () => {
    expect(resolveKeySource(E({ OLLAMAS_PASSPHRASE: "p", OLLAMAS_KEYSTORE: "keychain" }), true, true, "file")).toBe("passphrase");
  });

  it("explicit env OLLAMAS_KEYSTORE=file forces file", () => {
    expect(resolveKeySource(E({ OLLAMAS_KEYSTORE: "file" }), false, true, "keychain")).toBe("file");
  });

  it("explicit env keychain → keychain when available", () => {
    expect(resolveKeySource(E({ OLLAMAS_KEYSTORE: "keychain" }), false, true, null)).toBe("keychain");
  });

  it("explicit env keychain → DOWNGRADES to file when keychain unavailable", () => {
    expect(resolveKeySource(E({ OLLAMAS_KEYSTORE: "keychain" }), false, false, null)).toBe("file");
  });

  it("marker=keychain → keychain (available), beats a lingering keyfile", () => {
    expect(resolveKeySource(E(), true, true, "keychain")).toBe("keychain");
  });

  it("marker=keychain → file when keychain unavailable", () => {
    expect(resolveKeySource(E(), false, false, "keychain")).toBe("file");
  });

  it("marker=file → file", () => {
    expect(resolveKeySource(E(), false, true, "file")).toBe("file");
  });

  it("BACK-COMPAT: existing keyfile + no marker/env → file (never silently move a v7 user)", () => {
    expect(resolveKeySource(E(), true, true, null)).toBe("file");
  });

  it("NEW macOS user: no keyfile/marker/env, keychain available → keychain default", () => {
    expect(resolveKeySource(E(), false, true, null)).toBe("keychain");
  });

  it("no keychain, no keyfile → file", () => {
    expect(resolveKeySource(E(), false, false, null)).toBe("file");
  });

  it("explicit env beats an existing keyfile (opt-in switch)", () => {
    expect(resolveKeySource(E({ OLLAMAS_KEYSTORE: "keychain" }), true, true, null)).toBe("keychain");
  });

  it("ignores a garbage env value, falls through to keyfile back-compat", () => {
    expect(resolveKeySource(E({ OLLAMAS_KEYSTORE: "bogus" }), true, true, null)).toBe("file");
  });
});
