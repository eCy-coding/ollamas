// server/lib/keychain-scan.ts — read-only macOS Keychain lookup for key-doctor discovery.
// Server-side twin of the cli/lib/keychain.ts pattern (Scope Law: server never imports
// cli/**). READ-ONLY by design: key-doctor discovers, it never writes to the keychain.
// Lookups are limited to KNOWN service names (provider env-key names) — never a broad
// dump — and each read uses `find-generic-password -w` so the value goes to stdout only.
import { execFileSync } from "node:child_process";

const SECURITY = "/usr/bin/security";
const TIMEOUT_MS = 5000; // a hung keychain prompt must never block the doctor

/** Pure argv builder (service-only lookup — any account under that service matches). */
export function buildFindArgs(service: string): string[] {
  return ["find-generic-password", "-s", service, "-w"];
}

export function keychainAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

/** Read one generic password by service name. Returns null on ANY failure (not-found,
 *  non-darwin, locked keychain, denied prompt, timeout) — discovery treats null as absent. */
export function readGenericPassword(service: string): string | null {
  if (!keychainAvailable()) return null;
  try {
    const out = execFileSync(SECURITY, buildFindArgs(service), {
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}
