import { describe, it, expect } from "vitest";
import { formatBackupConfig, summarizeReport, backupOutName } from "../cli/lib/backup";
import { GatewayClient } from "../cli/lib/client";

const ctx = { color: false } as any;

describe("formatBackupConfig", () => {
  it("renders enabled + masked accessKey (as returned by the gateway)", () => {
    const out = formatBackupConfig({ enabled: true, type: "s3", bucket: "b", accessKey: "sk-***", intervalMinutes: 60 }, ctx);
    expect(out).toContain("enabled");
    expect(out).toContain("yes");
    expect(out).toContain("sk-***");
    expect(out).toContain("60m");
  });
  it("shows '-' for missing fields and 'no' when disabled", () => {
    const out = formatBackupConfig({ enabled: false }, ctx);
    expect(out).toContain("no");
    expect(out).toContain("type       -");
  });
});

describe("summarizeReport", () => {
  it("✓ ok with extra fields", () => {
    expect(summarizeReport({ success: true, bytes: 1024, dest: "s3://b" })).toBe("✓ ok  bytes=1024  dest=s3://b");
  });
  it("✗ failed with no extras", () => {
    expect(summarizeReport({ success: false })).toBe("✗ failed");
  });
});

describe("backupOutName", () => {
  it("normalizes : and . in the timestamp", () => {
    expect(backupOutName("2026-06-20T14:30:00.123Z")).toBe("backup-2026-06-20T14-30-00-123Z.enc");
  });
});

describe("GatewayClient backup (mock fetch)", () => {
  it("getBackupConfig GETs /api/backup/config", async () => {
    const original = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ enabled: true, type: "s3" }), { status: 200 });
    }) as any;
    try {
      const cfg = await new GatewayClient("http://x").getBackupConfig();
      expect(url).toContain("/api/backup/config");
      expect(cfg.type).toBe("s3");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("restoreBackup POSTs { hexBlob }", async () => {
    const original = globalThis.fetch;
    let sent: any;
    globalThis.fetch = (async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as any;
    try {
      const r = await new GatewayClient("http://x").restoreBackup("deadbeef");
      expect(sent).toEqual({ hexBlob: "deadbeef" });
      expect(r.success).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("downloadBackup returns the raw encrypted blob (text, not JSON)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ENCRYPTEDBLOB==", { status: 200 })) as any;
    try {
      expect(await new GatewayClient("http://x").downloadBackup()).toBe("ENCRYPTEDBLOB==");
    } finally {
      globalThis.fetch = original;
    }
  });
});
