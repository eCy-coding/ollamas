// The mirrored bearer token existed with no consumer: it was written on every sync and read
// by nothing (grep across ~/ecy-model, ~/.local/bin, ~/.zshrc on 2026-07-22 -> zero hits).
// An unused credential is worse than none — it rots silently, which is exactly what happened
// when the test suite overwrote it and nobody noticed for as long as nobody used it.
//
// This is the credential-resolution policy for out-of-process consumers (eCym's ecy-io, the
// obsidian-query CLI). It is pure so the precedence rules can be tested without a vault.
import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCreds, readPinnedCert, type CredSources } from "../server/obsidian-consumer";

const CERT = "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n";
const FILE_KEY = "f".repeat(64);
const MIRROR_KEY = "m".repeat(64);
const fileCreds = { apiKey: FILE_KEY, ca: CERT, port: 27124 };

const src = (over: Partial<CredSources> = {}): CredSources =>
  ({ mirror: null, file: null, ...over });

describe("resolveCreds — precedence", () => {
  test("the plugin's own settings win: they are the only always-fresh source", () => {
    const r = resolveCreds(src({ mirror: MIRROR_KEY, file: fileCreds }));
    expect(r.creds?.apiKey).toBe(FILE_KEY);
    expect(r.source).toBe("plugin");
  });

  test("the mirror is used when the vault settings cannot be read", () => {
    // This is the whole point of the mirror: a consumer that cannot parse the vault.
    const r = resolveCreds(src({ mirror: MIRROR_KEY, file: null, ca: CERT, port: 27124 }));
    expect(r.creds?.apiKey).toBe(MIRROR_KEY);
    expect(r.source).toBe("mirror");
  });

  test("the mirror alone is not enough without a pinned certificate", () => {
    // TLS verification stays on; a key with no CA cannot be used, and we do not fall back
    // to an unverified connection to make it work.
    const r = resolveCreds(src({ mirror: MIRROR_KEY, file: null }));
    expect(r.creds).toBeNull();
    expect(r.reason).toBe("no certificate to pin");
  });

  test("nothing available yields a null with a reason, never a throw", () => {
    const r = resolveCreds(src());
    expect(r.creds).toBeNull();
    expect(r.source).toBe("none");
    expect(r.reason).toBe("obsidian local-rest-api is not configured");
  });
});

describe("resolveCreds — the stale-mirror failure that actually happened", () => {
  test("a mirror disagreeing with the plugin is reported, and the plugin still wins", () => {
    const r = resolveCreds(src({ mirror: MIRROR_KEY, file: fileCreds }));
    expect(r.creds?.apiKey).toBe(FILE_KEY);
    expect(r.mirrorStale).toBe(true);   // surfaces the 40101 cause instead of hiding it
  });

  test("an agreeing mirror is not flagged", () => {
    const r = resolveCreds(src({ mirror: FILE_KEY, file: fileCreds }));
    expect(r.mirrorStale).toBe(false);
  });

  test("no mirror at all is not 'stale' — it is simply absent", () => {
    const r = resolveCreds(src({ file: fileCreds }));
    expect(r.mirrorStale).toBe(false);
    expect(r.source).toBe("plugin");
  });

  test("the 64-'k' fixture key is recognised as a test artifact, not a credential", () => {
    // The exact value the suite used to write into the operator's real HOME.
    const r = resolveCreds(src({ mirror: "k".repeat(64), file: null, ca: CERT, port: 27124 }));
    expect(r.creds).toBeNull();
    expect(r.reason).toBe("mirror holds a test fixture key");
  });
});

describe("readPinnedCert — the mirror path is useless without it", () => {
  // readObsidianCreds() returns null unless BOTH key and cert are present, which meant a
  // consumer relying on the mirror could never obtain a certificate to pin and the whole
  // fallback was dead code. Measured live before this was added: "no certificate to pin".
  const vaultWith = (data: unknown): string => {
    const v = mkdtempSync(join(tmpdir(), "obs-cons-"));
    const dir = join(v, ".obsidian", "plugins", "obsidian-local-rest-api");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "data.json"), typeof data === "string" ? data : JSON.stringify(data));
    return v;
  };

  test("the certificate is readable even when the key is absent", () => {
    const v = vaultWith({ port: 27124, crypto: { cert: CERT } });
    expect(readPinnedCert(v)).toEqual({ ca: CERT, port: 27124 });
  });

  test("the private key is never returned — only the public certificate is pinned", () => {
    const v = vaultWith({ port: 27124, crypto: { cert: CERT, privateKey: "secret" } });
    expect(JSON.stringify(readPinnedCert(v))).not.toContain("secret");
  });

  test("the port falls back to the plugin default when absent", () => {
    const v = vaultWith({ crypto: { cert: CERT } });
    expect(readPinnedCert(v)?.port).toBe(27124);
  });

  test("a missing plugin, missing cert or malformed file yields null, never a throw", () => {
    expect(readPinnedCert(mkdtempSync(join(tmpdir(), "obs-empty-")))).toBeNull();
    expect(readPinnedCert(vaultWith({ crypto: {} }))).toBeNull();
    expect(readPinnedCert(vaultWith("{ not json"))).toBeNull();
  });
});

describe("resolveCreds — malformed input degrades honestly", () => {
  test("a truncated or padded mirror value is rejected rather than sent as a bearer", () => {
    for (const bad of ["", "   ", "short", "x".repeat(63), "x".repeat(65)]) {
      const r = resolveCreds(src({ mirror: bad, file: null, ca: CERT, port: 27124 }));
      expect(r.creds).toBeNull();
    }
  });

  test("surrounding whitespace in the mirror file is tolerated", () => {
    const r = resolveCreds(src({ mirror: `\n${MIRROR_KEY}\n`, file: null, ca: CERT, port: 27124 }));
    expect(r.creds?.apiKey).toBe(MIRROR_KEY);
  });
});
