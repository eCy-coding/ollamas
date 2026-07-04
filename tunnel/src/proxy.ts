// vT12: proxy gateway PURE core — routing, pxy_ auth, header rewrite, key vault ops.
// No sockets, no disk: the IO shell (proxy-server.ts) and CLI own side effects.
//
// Security invariants (errors_registry):
// - RISK-TUNNEL-025: raw keys never stored/logged — vault keeps sha256 + 8-char prefix;
//   comparison is timingSafeEqual over digests.
// - RISK-TUNNEL-026: upstreams hard-pinned to loopback; routing never derives a host
//   from the request. Inbound X-Forwarded-* / X-Proxy-Key stripped before forwarding.

import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export type Target = "ollama" | "ollamas";

/** Hard-pinned loopback upstreams (RISK-TUNNEL-026) — never request-derived. */
export const UPSTREAMS: Record<Target, string> = {
  ollamas: "http://127.0.0.1:3000",
  ollama: "http://127.0.0.1:11434",
};

/** Host header value each upstream expects (ollamas /mcp origin-allowlist is localhost-only). */
const UPSTREAM_HOST: Record<Target, string> = {
  ollamas: "localhost:3000",
  ollama: "localhost:11434",
};

export interface PxyKeyRecord {
  prefix: string; // first 8 chars of the raw key, e.g. "pxy_ab12" — safe for logs
  sha256: string; // hex digest of the full raw key
  label: string;
  createdAt: string; // ISO
  revoked?: boolean;
}

export interface PxyVault {
  keys: PxyKeyRecord[];
}

// ---------- routing ----------

/** Normalize a path: resolve ".." / "//" purely lexically. Escaping root → null. */
function normalizePath(pathname: string): string | null {
  const parts = pathname.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (out.length === 0) return null; // escaped above root
      out.pop();
      continue;
    }
    out.push(p);
  }
  return "/" + out.join("/");
}

/**
 * Gateway path allowlist → upstream target.
 * /v1/* → ollama (native OpenAI-compat); /mcp, /api/* → ollamas; anything else null (404).
 */
export function routeRequest(pathname: string): { target: Target } | null {
  const norm = normalizePath(pathname);
  if (norm === null) return null;
  if (norm === "/v1" || norm.startsWith("/v1/")) return { target: "ollama" };
  if (norm === "/mcp" || norm.startsWith("/mcp/")) return { target: "ollamas" };
  if (norm === "/api" || norm.startsWith("/api/")) return { target: "ollamas" };
  return null;
}

// ---------- auth ----------

/** SHA-256 hex of a raw key. */
export function hashKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type AuthResult = { ok: true; keyPrefix: string } | { ok: false };

/**
 * Authorize an Authorization/X-Proxy-Key header value against vault records.
 * Accepts "Bearer pxy_…" or a bare "pxy_…" value. Timing-safe digest compare.
 * Never throws on malformed input.
 */
export function authorize(headerValue: string | undefined, keys: PxyKeyRecord[]): AuthResult {
  if (!headerValue) return { ok: false };
  let raw = headerValue.trim();
  if (/^bearer$/i.test(raw)) return { ok: false }; // "Bearer" with no token
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] !== undefined) raw = m[1].trim();
  if (!raw.startsWith("pxy_")) return { ok: false };
  const digest = Buffer.from(hashKey(raw), "hex");
  for (const k of keys) {
    if (k.revoked) continue;
    const stored = Buffer.from(k.sha256, "hex");
    if (stored.length === digest.length && timingSafeEqual(stored, digest)) {
      return { ok: true, keyPrefix: k.prefix };
    }
  }
  return { ok: false };
}

// ---------- header rewrite ----------

export type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Rewrite inbound headers for upstream forwarding:
 * - host (and origin, if present) forced to the pinned upstream localhost value
 *   (ollamas /mcp DNS-rebind allowlist requires it);
 * - inbound x-forwarded-* and x-proxy-key stripped (RISK-TUNNEL-025/026);
 * - authorization forwarded untouched (upstream olm_ auth composes, not replaced);
 * - everything else (incl. accept: text/event-stream) passes through.
 */
export function rewriteHeaders(headers: HeaderBag, target: Target): HeaderBag {
  const out: HeaderBag = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("x-forwarded-")) continue;
    if (lower === "x-proxy-key") continue;
    out[lower] = value;
  }
  out["host"] = UPSTREAM_HOST[target];
  if (out["origin"] !== undefined) out["origin"] = `http://${UPSTREAM_HOST[target]}`;
  return out;
}

// ---------- vault ops (pure over injected vault) ----------

/**
 * Add a key. `randomHex` = 32 hex chars from the caller's CSPRNG (IO shell passes
 * randomBytes(16).toString("hex")) — injected so this stays pure/deterministic in tests.
 * Returns the new vault + the raw key, which is shown ONCE and never stored.
 */
export function addKey(
  vault: PxyVault,
  label: string,
  randomHex: string,
): { vault: PxyVault; raw: string } {
  if (!/^[0-9a-f]{32}$/.test(randomHex)) throw new Error("addKey: randomHex must be 32 hex chars");
  const raw = `pxy_${randomHex}`;
  const rec: PxyKeyRecord = {
    prefix: raw.slice(0, 8),
    sha256: hashKey(raw),
    label,
    createdAt: new Date().toISOString(),
  };
  return { vault: { keys: [...vault.keys, rec] }, raw };
}

/** Revoke by prefix. Unknown prefix throws — silent no-op would hide operator typos. */
export function revokeKey(vault: PxyVault, prefix: string): PxyVault {
  if (!vault.keys.some((k) => k.prefix === prefix)) {
    throw new Error(`revokeKey: no key with prefix ${prefix}`);
  }
  return {
    keys: vault.keys.map((k) => (k.prefix === prefix ? { ...k, revoked: true } : k)),
  };
}

export interface PxyKeyRow {
  prefix: string;
  label: string;
  createdAt: string;
  revoked: boolean;
}

/** Listing for CLI/status — never exposes sha256 (defense-in-depth vs offline cracking). */
export function listKeys(vault: PxyVault): PxyKeyRow[] {
  return vault.keys.map((k) => ({
    prefix: k.prefix,
    label: k.label,
    createdAt: k.createdAt,
    revoked: k.revoked === true,
  }));
}
