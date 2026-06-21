// Private-host guard — PURE, no I/O. Defends the switch against DNS-rebinding / poisoned
// endpoints: the autopilot must only probe + select hosts that resolve to private/sovereign
// ranges (loopback, RFC1918, CGNAT 100.64/10, link-local, *.local). A rebind-poisoned public
// IP is refused before any probe (GitHub Blog / Palo Alto / pfSense exactMatch+private practice).

/** True if `host` (no port) is a private/sovereign target we are willing to probe. */
export function isPrivateHost(host: string): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  // strip IPv6 brackets
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);

  if (h === "localhost") return true;
  if (h.endsWith(".local")) return true; // mDNS / Bonjour
  if (h === "::1") return true; // IPv6 loopback
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 link-local / ULA

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false; // not an IPv4 literal and not an allowed name → refuse
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o as [number, number, number, number];

  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // RFC1918 10/8
  if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10 (Tailscale/Headscale mesh)
  return false; // public / anything else
}

/** True if the URL's host is private (parse-safe; malformed URL → false = refuse). */
export function assertPrivateUrl(url: string): boolean {
  try {
    return isPrivateHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
