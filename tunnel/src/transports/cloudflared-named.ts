// vT15: NAMED cloudflare tunnel — STABLE public URL (ollamas.<domain>), unlike the rotating
// quick tunnel (vT13). Two account-methods (both need a domain on Cloudflare):
//  - token (remotely-managed): `cloudflared tunnel run --token <TOKEN>`; ingress in the dash; no cert.pem.
//  - cli   (locally-managed):  login → create → route dns → local config.yml → `tunnel run <name>`.
//
// This file holds PURE parsers + argv builders (testable without the binary). The Transport class
// (up/down/probe over an injected SpawnFn, reusing vT14 auth-gate + dead-gateway guard) is in 15C.
// Adoption: cloudflare/cloudflared (Apache-2.0), binary-invoke only.

/** PURE: extract tunnel UUID + credentials-file path from `cloudflared tunnel create` stdout. */
export function parseTunnelCreate(stdout: string): { id: string; credFile: string } | null {
  const idMatch = stdout.match(/with id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const credMatch = stdout.match(/written to (.+\.json)/);
  if (!idMatch?.[1] || !credMatch?.[1]) return null;
  return { id: idMatch[1], credFile: credMatch[1].replace(/\.$/, "") };
}

/** PURE: run a remotely-managed (token) tunnel — no cert.pem, ingress lives in the dash. */
export function tokenRunArgs(token: string): string[] {
  return ["tunnel", "run", "--token", token];
}

/** PURE: run a locally-managed tunnel by name (uses local config.yml). */
export function namedRunArgs(name: string): string[] {
  return ["tunnel", "run", name];
}

/** PURE: create a locally-managed tunnel (emits UUID + credentials json). */
export function createArgs(name: string): string[] {
  return ["tunnel", "create", name];
}

/** PURE: bind a DNS hostname to the tunnel (auto-creates the CNAME → <UUID>.cfargotunnel.com). */
export function routeDnsArgs(name: string, hostname: string): string[] {
  return ["tunnel", "route", "dns", name, hostname];
}

/** PURE: interactive browser login that writes ~/.cloudflared/cert.pem (pick a zone). */
export function loginArgs(): string[] {
  return ["tunnel", "login"];
}
