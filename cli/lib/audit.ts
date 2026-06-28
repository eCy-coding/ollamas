// `ollamas saas audit export` — pure formatters that turn gateway audit events
// (GET /api/saas/audit) into compliance-friendly artifacts for log-shipping into
// a SIEM / S3 audit trail. No socket or disk here: every I/O lives in the
// command (thin-IO), so these stay unit-testable without a server.

export type AuditEvent = Record<string, unknown>;
export type AuditFormat = "csv" | "jsonl" | "json";

// Fixed column set for CSV — the gateway returns `SELECT *` so extra columns may
// appear over time, but compliance exports need a stable schema. JSONL/JSON keep
// the full row verbatim.
const CSV_COLUMNS = ["ts", "tenant_id", "tool", "tier", "ok"] as const;

export function isAuditFormat(s: string): s is AuditFormat {
  return s === "csv" || s === "jsonl" || s === "json";
}

// RFC-4180: wrap a field in double quotes when it contains a comma, quote, CR or
// LF; escape embedded quotes by doubling them. Guards against a tool name with a
// comma silently shifting columns (CSV-injection of structure).
export function csvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `ok` arrives as 1/0 (sqlite) or boolean (pg). Normalize to a stable true/false
// so a CSV consumer never has to guess the driver's encoding.
function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

export function toCsv(events: AuditEvent[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = events.map((e) =>
    CSV_COLUMNS.map((col) => csvField(col === "ok" ? toBool(e[col]) : e[col])).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export function toJsonl(events: AuditEvent[]): string {
  if (events.length === 0) return "";
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function formatAudit(events: AuditEvent[], format: AuditFormat): string {
  switch (format) {
    case "jsonl":
      return toJsonl(events);
    case "json":
      return JSON.stringify(events, null, 2) + "\n";
    case "csv":
    default:
      return toCsv(events);
  }
}

function isBareDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Inclusive ISO-8601 date-range filter on the event `ts`. Bounds may be a bare
// `YYYY-MM-DD`; lexicographic compare is correct for ISO timestamps. A bare
// `until` is widened to the end of that day so the whole day is included.
export function filterByDate(events: AuditEvent[], since?: string, until?: string): AuditEvent[] {
  if (!since && !until) return events;
  const lo = since || "";
  const hi = until ? (isBareDate(until) ? until + "T23:59:59.999Z" : until) : "";
  return events.filter((e) => {
    const ts = typeof e.ts === "string" ? e.ts : "";
    if (lo && ts < lo) return false;
    if (hi && ts > hi) return false;
    return true;
  });
}

// Safe default filename: audit-<tenant|all>-<utc>.<ext>, with `:`/`.` → `-`
// (same reasoning as backupOutName: those chars are awkward in paths). The
// tenant segment is stripped of anything non-filename-safe.
export function auditExportName(time: string, format: AuditFormat, tenantId?: string): string {
  const who = (tenantId || "all").replace(/[^A-Za-z0-9_-]/g, "-");
  const stamp = time.replace(/[:.]/g, "-");
  return `audit-${who}-${stamp}.${format}`;
}
