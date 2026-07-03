// SSRF host classification for tenant-supplied http upstream URLs (security-critical).
// A tenant (≠ host owner under SAAS_ENFORCE=1) must not make the gateway connect to
// internal targets (169.254.169.254 cloud metadata, loopback internal ports, RFC1918).
//
// Bypass-resistant by construction: Node's URL does NOT canonicalize alternate IPv4
// encodings (decimal 2130706433, hex 0x7f000001, octal 0177.0.0.1, short 127.1), so
// any numeric-looking host that is not a strict dotted-quad is REJECTED outright.
// IPv4-mapped IPv6 (::ffff:169.254.169.254) is unwrapped to its embedded v4 and
// re-classified. Hostnames are resolved (injectable lookup) and every returned
// address is classified — one internal answer blocks the whole host.
import { lookup as dnsLookup } from "node:dns/promises";

export type Verdict = "linklocal" | "loopback" | "rfc1918" | "cgnat" | "ula" | "wildcard" | "public";

export type LookupFn = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: LookupFn = (h) => dnsLookup(h, { all: true });

const octet = /^(0|[1-9]\d{0,2})$/; // no leading zeros (blocks octal), ≤3 digits

function classifyV4(parts: number[]): Verdict {
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return "wildcard";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 10) return "rfc1918";
  if (a === 172 && b >= 16 && b <= 31) return "rfc1918";
  if (a === 192 && b === 168) return "rfc1918";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  return "public";
}

// Parse a STRICT dotted-quad only. Anything else numeric-looking → caller rejects.
function parseStrictV4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!octet.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

// Looks like an IP attempt (all-numeric/hex/dotted-digits) but is not a strict quad.
function looksNumeric(host: string): boolean {
  return /^[0-9]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || (/^[0-9.]+$/.test(host) && host.includes("."));
}

/** Classify an IP literal. Returns a Verdict, "reject" (ambiguous/encoded numeric),
 *  or null (not an IP literal — a hostname needing DNS resolution). */
export function classifyIp(rawHost: string): Verdict | "reject" | null {
  let host = rawHost.trim().toLowerCase();
  if (!host) return "reject";

  // IPv6 literal: strip [] brackets and any %zone id.
  const isBracketed = host.startsWith("[") && host.endsWith("]");
  if (isBracketed) host = host.slice(1, -1);
  host = host.replace(/%.*$/, "");

  if (host.includes(":")) {
    // IPv4-mapped / -embedded IPv6: ::ffff:a.b.c.d  or  ::ffff:hhhh:hhhh
    const mapped = host.match(/::ffff:(.+)$/i);
    if (mapped) {
      const tail = mapped[1]!;
      if (tail.includes(".")) {
        const v4 = parseStrictV4(tail);
        return v4 ? classifyV4(v4) : "reject";
      }
      const hx = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (hx) {
        const hi = parseInt(hx[1]!, 16), lo = parseInt(hx[2]!, 16);
        return classifyV4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
      }
    }
    if (host === "::1") return "loopback";
    if (host === "::" || host === "::0") return "wildcard";
    if (/^fe80:/.test(host)) return "linklocal";
    if (/^(fc|fd)[0-9a-f]{2}:/.test(host)) return "ula";
    return "public"; // a global IPv6 address
  }

  const v4 = parseStrictV4(host);
  if (v4) return classifyV4(v4);
  // Not a strict quad. If it still looks like an encoded IP, reject (bypass defense).
  if (looksNumeric(host)) return "reject";
  return null; // a real hostname
}

// linklocal is ALWAYS blocked (metadata/fe80). Local single-user allows everything else
// (localhost/private upstreams are legit). Multi-tenant (saas) blocks all non-public.
function blockedVerdict(v: Verdict, saas: boolean): boolean {
  if (v === "linklocal") return true;
  if (!saas) return false;
  return v !== "public";
}

export interface HostCheckResult { ok: boolean; error?: string }

/** Resolve + classify a URL hostname. `saas` = multi-tenant enforcement on.
 *  `lookup` is injectable for deterministic tests. */
export async function classifyHost(
  rawHostname: string,
  opts: { saas: boolean; lookup?: LookupFn },
): Promise<HostCheckResult> {
  const lookup = opts.lookup ?? defaultLookup;
  let host = rawHostname.trim().toLowerCase().replace(/\.$/, ""); // drop one trailing dot
  if (!host) return { ok: false, error: "empty host" };
  if (host === "localhost") return blockedVerdict("loopback", opts.saas) ? { ok: false, error: "host not allowed: localhost (loopback)" } : { ok: true };

  const lit = classifyIp(host);
  if (lit === "reject") return { ok: false, error: `ambiguous/encoded IP host rejected: ${rawHostname}` };
  if (lit !== null) return blockedVerdict(lit, opts.saas) ? { ok: false, error: `host not allowed: ${host} (${lit})` } : { ok: true };

  // Hostname → resolve and classify every address; any internal answer blocks it.
  let addrs: { address: string }[];
  try { addrs = await lookup(host); }
  catch { return opts.saas ? { ok: false, error: `host resolution failed: ${host}` } : { ok: true }; }
  if (!addrs.length) return opts.saas ? { ok: false, error: `host did not resolve: ${host}` } : { ok: true };
  for (const { address } of addrs) {
    const v = classifyIp(address);
    if (v === "reject" || v === null) continue; // a resolved address should classify; be lenient
    if (blockedVerdict(v, opts.saas)) return { ok: false, error: `host ${host} resolves to blocked address ${address} (${v})` };
  }
  return { ok: true };
}
