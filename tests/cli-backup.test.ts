import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { formatBackupConfig, summarizeReport, backupOutName } from "../cli/lib/backup";
import { GatewayClient } from "../cli/lib/client";
import { runBackup } from "../cli/commands/backup";

const ctx = { color: false } as any;

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  let out = "";
  const so = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
  const se = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    return { code: await runBackup(argv), out };
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
}

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

describe("runBackup dispatch", () => {
  it("--help exits 0, no action exits 2, unknown action exits 2", async () => {
    expect((await run(["--help"])).code).toBe(0);
    expect((await run([])).code).toBe(2);
    expect((await run(["bogus"])).code).toBe(2);
  });
  it("restore with no file → exit 2 (before any network)", async () => {
    expect((await run(["restore"])).code).toBe(2);
  });
  it("restore --yes with a missing file → exit 2 (read error, not a destructive call)", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => ((called = true), new Response("{}", { status: 200 }))) as any;
    try {
      expect((await run(["restore", "/no/such/backup.enc", "--yes"])).code).toBe(2);
      expect(called).toBe(false); // never POSTed a restore for an unreadable file
    } finally {
      globalThis.fetch = original;
    }
  });
});
