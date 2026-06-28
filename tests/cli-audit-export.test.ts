import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import {
  csvField,
  toCsv,
  toJsonl,
  filterByDate,
  formatAudit,
  auditExportName,
  isAuditFormat,
  type AuditEvent,
} from "../cli/lib/audit";
import { GatewayClient } from "../cli/lib/client";
import { runSaas } from "../cli/commands/saas";
import { readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EVENTS: AuditEvent[] = [
  { id: 3, ts: "2026-06-28T12:00:00.000Z", tenant_id: "tnt_a", tool: "list_tree", tier: "safe", ok: 1 },
  { id: 2, ts: "2026-06-27T09:30:00.000Z", tenant_id: "tnt_a", tool: "shell,exec", tier: "host", ok: 0 },
  { id: 1, ts: "2026-06-26T00:00:00.000Z", tenant_id: "tnt_b", tool: 'say "hi"', tier: "safe", ok: true },
];

describe("csvField (RFC-4180)", () => {
  it("leaves plain values bare", () => {
    expect(csvField("list_tree")).toBe("list_tree");
  });
  it("quotes + escapes commas, quotes, newlines", () => {
    expect(csvField("shell,exec")).toBe('"shell,exec"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });
  it("renders null/undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("emits a stable header + one row per event, ok normalized to boolean", () => {
    const csv = toCsv(EVENTS);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("ts,tenant_id,tool,tier,ok");
    expect(lines).toHaveLength(4); // header + 3
    expect(lines[1]).toContain("true"); // ok:1 → true
    expect(lines[2]).toContain('"shell,exec"'); // comma quoted → no column shift
    expect(lines[2]).toContain("false"); // ok:0 → false
  });
  it("empty events → header-only (graceful)", () => {
    expect(toCsv([])).toBe("ts,tenant_id,tool,tier,ok\n");
  });
});

describe("toJsonl", () => {
  it("one JSON object per line, trailing newline", () => {
    const out = toJsonl(EVENTS);
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).tool).toBe("list_tree");
    expect(out.endsWith("\n")).toBe(true);
  });
  it("empty events → empty string (no stray newline)", () => {
    expect(toJsonl([])).toBe("");
  });
});

describe("filterByDate (inclusive)", () => {
  it("no bounds → passthrough", () => {
    expect(filterByDate(EVENTS)).toHaveLength(3);
  });
  it("since is inclusive at the exact ts", () => {
    const r = filterByDate(EVENTS, "2026-06-27T09:30:00.000Z");
    expect(r.map((e) => e.id)).toEqual([3, 2]);
  });
  it("until bare date includes the whole day", () => {
    const r = filterByDate(EVENTS, undefined, "2026-06-27");
    expect(r.map((e) => e.id)).toEqual([2, 1]);
  });
  it("since + until window narrows correctly", () => {
    const r = filterByDate(EVENTS, "2026-06-27", "2026-06-27");
    expect(r.map((e) => e.id)).toEqual([2]);
  });
});

describe("formatAudit dispatch", () => {
  it("routes to csv / jsonl / json", () => {
    expect(formatAudit(EVENTS, "csv").startsWith("ts,tenant_id")).toBe(true);
    expect(formatAudit(EVENTS, "jsonl").split("\n").filter(Boolean)).toHaveLength(3);
    expect(JSON.parse(formatAudit(EVENTS, "json"))).toHaveLength(3);
  });
});

describe("auditExportName", () => {
  it("sanitizes colons/dots and tenant, picks extension", () => {
    expect(auditExportName("2026-06-28T12:00:00.000Z", "csv", "tnt_a")).toBe(
      "audit-tnt_a-2026-06-28T12-00-00-000Z.csv",
    );
    expect(auditExportName("2026-06-28T12:00:00.000Z", "jsonl")).toBe(
      "audit-all-2026-06-28T12-00-00-000Z.jsonl",
    );
  });
  it("strips unsafe chars from tenant", () => {
    expect(auditExportName("t", "json", "../evil/id")).toBe("audit----evil-id-t.json");
  });
});

describe("isAuditFormat", () => {
  it("accepts known formats only", () => {
    expect(isAuditFormat("csv")).toBe(true);
    expect(isAuditFormat("jsonl")).toBe(true);
    expect(isAuditFormat("xml")).toBe(false);
  });
});

// --- thin-IO command: `saas audit export` (mock-fetch round-trip + 0600 file) ---
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const so = vi.spyOn(process.stdout, "write").mockImplementation((c: any) => ((out += c), true));
  const se = vi.spyOn(process.stderr, "write").mockImplementation((c: any) => ((err += c), true));
  try {
    return { code: await runSaas(argv), out, err };
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
}

describe("saas audit export (command)", () => {
  it("writes CSV to a 0600 file via the gateway client", async () => {
    const spy = vi.spyOn(GatewayClient.prototype, "listAudit").mockResolvedValue(EVENTS as any);
    const out = join(tmpdir(), `ollamas-audit-test-${process.pid}.csv`);
    try {
      const r = await run(["audit", "export", "--tenant", "tnt_a", "--format", "csv", "-o", out]);
      expect(r.code).toBe(0);
      const body = readFileSync(out, "utf8");
      expect(body.startsWith("ts,tenant_id,tool,tier,ok")).toBe(true);
      // 0600 hygiene (owner rw only) — same as backup download.
      expect(statSync(out).mode & 0o777).toBe(0o600);
    } finally {
      spy.mockRestore();
      rmSync(out, { force: true });
    }
  });

  it("streams JSONL to stdout when no -o given, applying date filter", async () => {
    const spy = vi.spyOn(GatewayClient.prototype, "listAudit").mockResolvedValue(EVENTS as any);
    try {
      const r = await run(["audit", "export", "--format", "jsonl", "--since", "2026-06-28"]);
      expect(r.code).toBe(0);
      const lines = r.out.trimEnd().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1); // only the 2026-06-28 event survives
      expect(JSON.parse(lines[0]).id).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects an unknown --format with exit 2", async () => {
    const r = await run(["audit", "export", "--format", "xml"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("format");
  });
});
