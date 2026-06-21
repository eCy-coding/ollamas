// Release-manifest core — PURE, zero-dep (v10). A self-update reads a manifest
// `{version, assets:[{target,url,sha256}]}` (a hand-published latest.json — the
// simplest zero-dep option vs the rate-limited GitHub Releases API). Logic mirrors
// deno upgrade / tj/go-update (MIT): pick the asset for this platform, verify its
// sha256 before anything touches disk.
import { createHash } from "node:crypto";

export interface Asset {
  target: string; // e.g. "darwin-arm64"
  url: string;
  sha256: string; // lowercase hex, 64 chars
}
export interface Manifest {
  version: string;
  assets: Asset[];
  notes?: string;
}

export function parseManifest(json: string): Manifest {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("manifest is not valid JSON");
  }
  if (!raw || typeof raw.version !== "string" || !Array.isArray(raw.assets)) {
    throw new Error("manifest must have { version: string, assets: [] }");
  }
  const assets: Asset[] = raw.assets.map((a: any, i: number) => {
    if (!a || typeof a.target !== "string" || typeof a.url !== "string" || typeof a.sha256 !== "string") {
      throw new Error(`asset[${i}] must have { target, url, sha256 }`);
    }
    return { target: a.target, url: a.url, sha256: a.sha256.toLowerCase() };
  });
  return { version: raw.version, assets, notes: typeof raw.notes === "string" ? raw.notes : undefined };
}

// Normalize "v1.2.3" → [1,2,3]. Non-numeric / pre-release suffixes are dropped.
function semverParts(v: string): number[] {
  return v.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
}

// -1 if a<b, 0 if equal, 1 if a>b (numeric per-field, so 9.10 > 9.2).
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function isNewer(current: string, latest: string): boolean {
  return compareSemver(current, latest) < 0;
}

// process.platform/arch → manifest target key.
export function currentTarget(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function selectAsset(manifest: Manifest, target: string): Asset | undefined {
  return manifest.assets.find((a) => a.target === target);
}

// Lowercase hex sha256 of a byte buffer (node:crypto, zero-dep).
export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
