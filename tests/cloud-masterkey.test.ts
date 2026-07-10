/**
 * M-020 — cloud master-key fail-closed. On a cloud/container boot (isCloud) with NO master key
 * available (env / keychain / key file), the server must REFUSE to boot instead of silently
 * minting a random ephemeral key: a minted key dies with the replica, orphaning every persisted
 * secret to undecryptable ciphertext on the next restart. Local (darwin) fresh installs still
 * mint + persist to ~/.llm-mission-control unchanged.
 */
import { describe, it, test, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { decideMasterKeySource, SecureDB } from "../server/db";

describe("decideMasterKeySource — cloud fail-closed (pure)", () => {
  const key32B64 = randomBytes(32).toString("base64");

  it("cloud + no key anywhere + fresh store → fail (never mint an ephemeral key)", () => {
    const d = decideMasterKeySource({ keyFileExists: false, configExists: false, isCloud: true });
    expect(d.source).toBe("fail");
    if (d.source === "fail") expect(d.reason).toMatch(/MASTER_KEY_B64/);
  });

  it("cloud + env key → env (boots normally)", () => {
    const d = decideMasterKeySource({ envB64: key32B64, keyFileExists: false, configExists: false, isCloud: true });
    expect(d.source).toBe("env");
  });

  it("cloud + persisted key file (mounted volume) → file (boots normally)", () => {
    expect(decideMasterKeySource({ keyFileExists: true, configExists: true, isCloud: true }).source).toBe("file");
  });

  it("local fresh install still mints (darwin path unchanged)", () => {
    expect(decideMasterKeySource({ keyFileExists: false, configExists: false, isCloud: false }).source).toBe("mint");
    expect(decideMasterKeySource({ keyFileExists: false, configExists: false }).source).toBe("mint");
  });
});

describe("SecureDB end-to-end — keyless cloud boot throws, keyed cloud boot works", () => {
  let tmp: string | undefined;
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ["MISSION_CONTROL_DATA_DIR", "MASTER_KEY_B64", "K_SERVICE", "GOOGLE_CLOUD_RUN"] as const;

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function setup(): string {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    tmp = mkdtempSync(join(tmpdir(), "ollamas-cloudmk-"));
    process.env.MISSION_CONTROL_DATA_DIR = tmp;
    delete process.env.MASTER_KEY_B64;
    delete process.env.GOOGLE_CLOUD_RUN;
    return tmp;
  }

  test("cloud boot with no master key → throws (fail-closed), mints nothing", () => {
    const dir = setup();
    process.env.K_SERVICE = "test-cloud-service";
    expect(() => new SecureDB()).toThrow(/master key/i);
    expect(existsSync(join(dir, ".master_key"))).toBe(false);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("cloud boot with MASTER_KEY_B64 → boots, encrypt/decrypt round-trips", () => {
    setup();
    process.env.K_SERVICE = "test-cloud-service";
    process.env.MASTER_KEY_B64 = randomBytes(32).toString("base64");
    const db = new SecureDB();
    expect(db.decrypt(db.encrypt("cloud-secret"))).toBe("cloud-secret");
    expect(db.masterKeySource).toBe("env");
  });

  test("local (non-cloud) fresh boot still mints and persists a key file (unchanged)", () => {
    const dir = setup();
    delete process.env.K_SERVICE;
    const db = new SecureDB();
    expect(existsSync(join(dir, ".master_key"))).toBe(true);
    expect(db.decrypt(db.encrypt("local-secret"))).toBe("local-secret");
  });
});
