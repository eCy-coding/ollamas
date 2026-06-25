// SSRF guard for host tools that fetch user/agent-supplied URLs (web_search --fetch, …).
// Mirrors server/webhooks/outbound.ts: reject non-http(s) schemes and any target that
// resolves to a private/loopback/link-local/metadata/CGNAT/ULA address. net.BlockList
// normalizes IPv4-mapped IPv6 (::ffff: in dotted AND hex-compressed forms).
import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE = (() => {
  const bl = new net.BlockList();
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addSubnet("169.254.0.0", 16, "ipv4"); // link-local + cloud metadata
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
  bl.addAddress("::1", "ipv6");
  bl.addAddress("::", "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6"); // ULA
  bl.addSubnet("fe80::", 10, "ipv6"); // link-local
  return bl;
})();

function mappedIPv4(ip) {
  const x = ip.toLowerCase();
  const dotted = x.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = x.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

export function isPrivateAddress(ip) {
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (PRIVATE.check(ip, fam === 6 ? "ipv6" : "ipv4")) return true;
  if (fam === 6) {
    const m = mappedIPv4(ip);
    if (m && PRIVATE.check(m, "ipv4")) return true;
  }
  return false;
}

/** Throw if the URL is not a public http(s) target. Resolves DNS so a public name that
 *  points at an internal IP is still blocked. */
export async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("invalid url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`url scheme not allowed: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("url targets localhost");
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); }
    catch { throw new Error(`url host does not resolve: ${host}`); }
  }
  for (const ip of addrs) if (isPrivateAddress(ip)) throw new Error(`url resolves to a non-public address: ${ip}`);
}
