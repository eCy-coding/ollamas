// server/lib/keychain-scan.ts — macOS Keychain access for key-doctor discovery + the
// Secure-Enclave-backed hardware vault (the master-key store).
// Server-side twin of the cli/lib/keychain.ts pattern (Scope Law: server never imports
// cli/**). Reads are limited to KNOWN service names (provider env-key names, the master-key
// service) — never a broad dump — and each read uses `find-generic-password -w` so the value
// goes to stdout only. WRITES are guarded (known services only) and used solely to persist the
// vault master key + discovered keys into the hardware keychain (opt-in, see db.ts).
import { execFileSync } from "node:child_process";

const SECURITY = "/usr/bin/security";
const TIMEOUT_MS = 5000; // a hung keychain prompt must never block the doctor

/** Pure argv builder (service-only lookup — any account under that service matches). */
export function buildFindArgs(service: string): string[] {
  return ["find-generic-password", "-s", service, "-w"];
}

/** Pure argv builder for a guarded write. `-U` updates an existing item in place instead of
 *  erroring on a duplicate; service+account scope the item. NOTE: the value travels in argv
 *  (briefly visible to `ps` on the local host) — `security` offers no stdin path for
 *  add-generic-password; an honest, accepted trade-off for a personal-Mac hardware vault. */
export function buildAddArgs(service: string, account: string, value: string): string[] {
  return ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value];
}

/** Write one generic password (guarded: caller passes only KNOWN service names). Returns
 *  false on ANY failure (non-darwin, denied, timeout) — persistence is best-effort and must
 *  never block boot. */
export function writeGenericPassword(service: string, value: string, account = "ollamas"): boolean {
  if (!keychainAvailable() || !value) return false;
  try {
    execFileSync(SECURITY, buildAddArgs(service, account, value), {
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
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
