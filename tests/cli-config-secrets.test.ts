import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { sealDisk, unsealDisk, resolveConfig } from "../cli/lib/config";

const key = randomBytes(32);

describe("sealDisk (secrets at rest)", () => {
  it("seals apiKey + saasAdminToken into *Enc, drops plaintext", () => {
    const disk = sealDisk({ gateway: "http://g", apiKey: "olm_k", saasAdminToken: "adm" }, key) as any;
    expect(disk.apiKey).toBeUndefined();
    expect(disk.saasAdminToken).toBeUndefined();
    expect(disk.apiKeyEnc).toMatch(/^[0-9a-f]+:[0-9a-f]{32}:[0-9a-f]*$/);
    expect(disk.saasAdminTokenEnc).toBeTruthy();
    expect(disk.gateway).toBe("http://g"); // non-secret passthrough
  });

  it("requires a key only when a secret is present", () => {
    expect(() => sealDisk({ gateway: "http://g" }, null)).not.toThrow();
    expect(() => sealDisk({ apiKey: "k" }, null)).toThrow(/master key required/);
  });

  it("no secret → no *Enc fields", () => {
    const disk = sealDisk({ gateway: "http://g", model: "m" }, null) as any;
    expect(disk.apiKeyEnc).toBeUndefined();
    expect("apiKey" in disk).toBe(false);
  });
});

describe("unsealDisk", () => {
  it("round-trips sealed secrets back to plaintext", () => {
    const disk = sealDisk({ gateway: "http://g", apiKey: "olm_k", saasAdminToken: "adm" }, key);
    const { fileData, legacy } = unsealDisk(disk, key);
    expect(fileData.apiKey).toBe("olm_k");
    expect(fileData.saasAdminToken).toBe("adm");
    expect(fileData.gateway).toBe("http://g");
    expect(legacy).toBe(false);
  });

  it("flags legacy plaintext + passes it through (for migration)", () => {
    const { fileData, legacy } = unsealDisk({ gateway: "http://g", apiKey: "plain_old" } as any, null);
    expect(legacy).toBe(true);
    expect(fileData.apiKey).toBe("plain_old");
  });

  it("a sealed file has no plaintext apiKey on disk", () => {
    const disk = sealDisk({ apiKey: "olm_secret" }, key);
    expect(JSON.stringify(disk)).not.toContain("olm_secret");
  });

  it("requires the key to open a sealed field", () => {
    const disk = sealDisk({ apiKey: "k" }, key);
    expect(() => unsealDisk(disk, null)).toThrow(/master key required/);
  });

  it("seal→unseal with a passphrase-derived flow is lossless across many keys", () => {
    for (let i = 0; i < 5; i++) {
      const k = randomBytes(32);
      const disk = sealDisk({ apiKey: `key-${i}` }, k);
      expect(unsealDisk(disk, k).fileData.apiKey).toBe(`key-${i}`);
    }
  });
});

describe("resolveConfig env override unchanged (secrets stay in-memory)", () => {
  it("env apiKey wins over file plaintext", () => {
    const cfg = resolveConfig({ apiKey: "from_file" }, { OLLAMAS_API_KEY: "from_env" } as any);
    expect(cfg.apiKey).toBe("from_env");
  });
  it("falls back to file then defaults", () => {
    const cfg = resolveConfig({ gateway: "http://f" }, {} as any);
    expect(cfg.gateway).toBe("http://f");
    expect(cfg.model).toBe("qwen3:8b");
    expect(cfg.provider).toBe("ollama-local");
  });
});
