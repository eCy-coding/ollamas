// Credential resolution for out-of-process consumers of the Obsidian Local REST API.
//
// WHY THIS EXISTS. server/obsidian-rest.ts mirrors the plugin's bearer key to
// ~/.llm-mission-control/obsidian-rest.token so a consumer that cannot parse the vault
// (eCym's ecy-io, a shell script, anything not Node) can authenticate. Measured on
// 2026-07-22, nothing read that file — and an unread credential rots unnoticed: the test
// suite overwrote it with 64 'k's and the vault answered 40101 to a mirror nobody used.
//
// The policy here is deliberately boring:
//   - the plugin's own settings win whenever they are readable (always fresh)
//   - the mirror is the fallback, and only with a certificate to pin
//   - TLS verification is never traded away to make a credential work
//   - disagreement between mirror and plugin is REPORTED, not silently papered over
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ObsidianCreds } from "./obsidian-rest";

export interface CredSources {
  /** Raw contents of the token mirror file, or null if unreadable. */
  mirror: string | null;
  /** Credentials read from the plugin's data.json, or null if unreadable. */
  file: ObsidianCreds | null;
  /** Certificate to pin when only the mirror is available. */
  ca?: string;
  /** Port to use when only the mirror is available. */
  port?: number;
}

export interface ResolvedCreds {
  creds: ObsidianCreds | null;
  source: "plugin" | "mirror" | "none";
  /** True when a mirror exists and disagrees with the plugin — the 40101 cause. */
  mirrorStale: boolean;
  reason?: string;
}

/** The exact value the test suite used to write into the operator's real HOME. */
const FIXTURE_KEY = "k".repeat(64);

/**
 * Read ONLY the pinned certificate (and port) from the plugin's settings.
 *
 * readObsidianCreds() insists on key AND cert together, which is right for the in-process
 * client but leaves the mirror fallback unusable: a consumer holding a mirrored key still
 * needs a CA, and without this it could never get one. Verified live before this existed —
 * the fallback failed with "no certificate to pin" every time.
 *
 * The private key is deliberately not read; only the public certificate is ever pinned.
 */
export function readPinnedCert(vault: string): { ca: string; port: number } | null {
  try {
    const p = join(vault, ".obsidian", "plugins", "obsidian-local-rest-api", "data.json");
    const d = JSON.parse(readFileSync(p, "utf8"));
    const ca = typeof d?.crypto?.cert === "string" ? d.crypto.cert : "";
    if (!ca) return null;
    return { ca, port: Number(d?.port) || 27124 };
  } catch { return null; }
}

const validKey = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length === 64 ? t : null;
};

export function resolveCreds(src: CredSources): ResolvedCreds {
  const mirrorKey = validKey(src.mirror);
  const fileKey = src.file?.apiKey ? validKey(src.file.apiKey) : null;
  const mirrorStale = Boolean(mirrorKey && fileKey && mirrorKey !== fileKey);

  if (src.file && fileKey && src.file.ca) {
    return { creds: src.file, source: "plugin", mirrorStale };
  }

  if (mirrorKey) {
    if (mirrorKey === FIXTURE_KEY) {
      return { creds: null, source: "none", mirrorStale, reason: "mirror holds a test fixture key" };
    }
    const ca = src.ca ?? src.file?.ca;
    if (!ca) {
      return { creds: null, source: "none", mirrorStale, reason: "no certificate to pin" };
    }
    return {
      creds: { apiKey: mirrorKey, ca, port: src.port ?? src.file?.port ?? 27124 },
      source: "mirror",
      mirrorStale,
    };
  }

  return {
    creds: null,
    source: "none",
    mirrorStale,
    reason: "obsidian local-rest-api is not configured",
  };
}
