// Size-based log rotation (vT8): the vT7 daemon writes decisions.jsonl + daemon.log 24/7, so they
// grow unbounded (RISK-018/020). rotateIfNeeded keeps a bounded ring of N files. Zero-dep.
// Adoption (pattern only): rogerc/file-stream-rotator + Zelgadis87/simple-file-rotator `rotate(file,N)`.
// Winston/Pino rotation pulls heavy deps → not used.
//
// Scheme: when size(path) > maxBytes → drop path.<keep>, shift path.<i>→path.<i+1>, path→path.1,
// leaving `path` to be recreated by the next write. Never throws.

import { existsSync, statSync, renameSync, rmSync } from "node:fs";

export interface RotateOptions {
  /** Rotate once the file exceeds this size. */
  maxBytes?: number;
  /** How many historical files to keep (path.1 .. path.keep). */
  keep?: number;
}

export interface RotateResult {
  rotated: boolean;
  reason: string;
}

/** Rotate `path` if it exceeds maxBytes. Missing/small file → no-op. Never throws. */
export function rotateIfNeeded(path: string, opts: RotateOptions = {}): RotateResult {
  const maxBytes = opts.maxBytes ?? 1_000_000; // 1 MB default
  const keep = Math.max(1, opts.keep ?? 3);
  try {
    if (!existsSync(path)) return { rotated: false, reason: "no file" };
    const size = statSync(path).size;
    if (size <= maxBytes) return { rotated: false, reason: `under cap (${size}<=${maxBytes})` };

    // Drop the oldest, then shift the ring up by one.
    const oldest = `${path}.${keep}`;
    if (existsSync(oldest)) rmSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
    renameSync(path, `${path}.1`); // current → .1; caller's next write recreates `path`
    return { rotated: true, reason: `rotated at ${size} bytes (keep ${keep})` };
  } catch (e) {
    // rotation is best-effort housekeeping — never break the caller.
    return { rotated: false, reason: `rotate failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
