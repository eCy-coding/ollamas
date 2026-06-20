// Backup helpers — pure render/format for `ollamas backup` (v15). The gateway's
// /api/backup/* group manages an encrypted (AES-GCM) config backup to an S3-like
// destination; the CLI is a thin client over it (choke-point HTTP, no registry
// import). The downloaded blob is opaque ciphertext — never decrypted or dumped
// here. Pure → unit-testable; the I/O lives in lib/client.ts.
import { c, type OutputCtx } from "./output";

export interface BackupConfig {
  type?: string;
  endpoint?: string;
  bucket?: string;
  accessKey?: string; // the gateway returns this masked ("sk-***") — we print as-is
  intervalMinutes?: number;
  enabled?: boolean;
}

// Render the backup config as aligned key/value lines. accessKey is already masked
// by the gateway; secretKey is never returned, so it never appears here.
export function formatBackupConfig(cfg: BackupConfig, ctx: OutputCtx): string {
  const rows: [string, string][] = [
    ["enabled", cfg.enabled ? c("green", "yes", ctx.color) : c("dim", "no", ctx.color)],
    ["type", cfg.type || "-"],
    ["endpoint", cfg.endpoint || "-"],
    ["bucket", cfg.bucket || "-"],
    ["accessKey", cfg.accessKey || "-"],
    ["interval", cfg.intervalMinutes ? `${cfg.intervalMinutes}m` : "-"],
  ];
  return rows.map(([k, v]) => `  ${k.padEnd(10)} ${v}`).join("\n");
}

// One-line summary of a trigger/restore report ({success, ...}).
export function summarizeReport(report: Record<string, any>): string {
  const head = report.success ? "✓ ok" : "✗ failed";
  const extra = Object.entries(report)
    .filter(([k]) => k !== "success")
    .map(([k, v]) => `${k}=${v && typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("  ");
  return extra ? `${head}  ${extra}` : head;
}

// Safe local filename for a downloaded backup — the gateway names it by time, but
// `:` and `.` are awkward in paths, so normalize to `-`.
export function backupOutName(time: string): string {
  return `backup-${time.replace(/[:.]/g, "-")}.enc`;
}
