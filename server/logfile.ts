// server/logfile.ts — persistent, size-rotated plain-text logging for sub-services (zero-dep).
//
// rotateIfNeeded mirrors the proven scheme in tunnel/src/logrotate.ts (kept here so server/ has no
// cross-tree coupling): when a file exceeds maxBytes, drop path.<keep>, shift path.<i>→path.<i+1>,
// path→path.1, leaving `path` for the next write. appendLogLine rotates-then-appends. Never throws
// — logging is best-effort and must never break the caller.
import { existsSync, statSync, renameSync, rmSync, appendFileSync } from "node:fs";

export interface RotateOptions { maxBytes?: number; keep?: number }
export interface RotateResult { rotated: boolean; reason: string }

/** Rotate `path` if it exceeds maxBytes (default 1 MB, keep 3). Missing/small → no-op. Never throws. */
export function rotateIfNeeded(path: string, opts: RotateOptions = {}): RotateResult {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const keep = Math.max(1, opts.keep ?? 3);
  try {
    if (!existsSync(path)) return { rotated: false, reason: "no file" };
    const size = statSync(path).size;
    if (size <= maxBytes) return { rotated: false, reason: `under cap (${size}<=${maxBytes})` };
    const oldest = `${path}.${keep}`;
    if (existsSync(oldest)) rmSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
    renameSync(path, `${path}.1`);
    return { rotated: true, reason: `rotated at ${size} bytes (keep ${keep})` };
  } catch (e) {
    return { rotated: false, reason: `rotate failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Append one line to `path` (rotating first if over cap). Best-effort: swallows IO errors. */
export function appendLogLine(path: string, line: string, opts: RotateOptions = {}): void {
  try {
    rotateIfNeeded(path, opts);
    appendFileSync(path, line.endsWith("\n") ? line : line + "\n");
  } catch { /* logging must never break the caller */ }
}

/** Redact GitHub PATs / Google API keys from a log line (defensive — ecysearch self-masks too). Pure. */
export function maskSecrets(s: string): string {
  return s.replace(/\b(gh[posu]_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[REDACTED]");
}

/** Format one structured log line: `[iso] [level] msg` (secrets masked). Pure. */
export function fmtLogLine(isoTs: string, level: string, msg: string): string {
  return `[${isoTs}] [${level}] ${maskSecrets(msg)}`;
}
