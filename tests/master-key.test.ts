/**
 * Master-key fail-closed lifecycle: a missing key with an EXISTING encrypted store must never
 * silently mint a new key (which would orphan every secret to undecryptable ciphertext). An
 * env-injected MASTER_KEY_B64 is stable across restarts/replicas.
 */
import { describe, it, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { decideMasterKeySource, SecureDB } from "../server/db";

describe("decideMasterKeySource (pure)", () => {
  const key32B64 = randomBytes(32).toString("base64");

  it("valid 32-byte env key → source env + decoded key", () => {
    const d = decideMasterKeySource({ envB64: key32B64, keyFileExists: false, configExists: true });
    expect(d.source).toBe("env");
    if (d.source === "env") expect(d.key.length).toBe(32);
  });
  it("wrong-length env key → fail", () => {
    const d = decideMasterKeySource({ envB64: Buffer.from("short").toString("base64"), keyFileExists: false, configExists: false });
    expect(d.source).toBe("fail");
  });
  it("no env + key file present → file", () => {
    expect(decideMasterKeySource({ keyFileExists: true, configExists: true }).source).toBe("file");
  });
  it("no env + no key file + existing store → fail-closed (never orphan ciphertext)", () => {
    expect(decideMasterKeySource({ keyFileExists: false, configExists: true }).source).toBe("fail");
  });
  it("no env + no key file + no store → mint (fresh install)", () => {
    expect(decideMasterKeySource({ keyFileExists: false, configExists: false }).source).toBe("mint");
  });
});

describe("SecureDB end-to-end — env key survives a restart, fail-closed without it", () => {
  let tmp: string | undefined;
  const savedDir = process.env.MISSION_CONTROL_DATA_DIR;
  const savedKey = process.env.MASTER_KEY_B64;

  afterEach(() => {
    if (savedDir === undefined) delete process.env.MISSION_CONTROL_DATA_DIR; else process.env.MISSION_CONTROL_DATA_DIR = savedDir;
    if (savedKey === undefined) delete process.env.MASTER_KEY_B64; else process.env.MASTER_KEY_B64 = savedKey;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("MASTER_KEY_B64 decrypts a prior boot's ciphertext; removing it fails closed", () => {
    tmp = mkdtempSync(join(tmpdir(), "ollamas-mk-"));
    process.env.MISSION_CONTROL_DATA_DIR = tmp;
    process.env.MASTER_KEY_B64 = randomBytes(32).toString("base64");

    const db1 = new SecureDB();
    db1.data.keys.t = db1.encrypt("secret-value");
    db1.save();

    // Simulated restart, same injected key (env mode writes NO .master_key file).
    const db2 = new SecureDB();
    expect(existsSync(join(tmp, ".master_key"))).toBe(false);
    expect(db2.decrypt(db2.data.keys.t)).toBe("secret-value");

    // Restart WITHOUT the key but with the existing store → must throw, not mint a wrong key.
    delete process.env.MASTER_KEY_B64;
    expect(() => new SecureDB()).toThrow(/master key/i);
  });
});
