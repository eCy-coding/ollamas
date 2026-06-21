import fs from "node:fs";
import path from "node:path";

// Canonical artifacts/ binary-folder architecture. ARTIFACTS_DIR points at the
// build-output root (artifacts/); the gateway discovers every compiled native
// binary, the JS bundles, and the host-bridge tools from one manifest instead
// of hard-coding scattered bin/ + dist/ paths. Populated by `make build-all`.
export const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "artifacts");
const REPO_ROOT = path.dirname(ARTIFACTS_DIR);
const MANIFEST_PATH = path.join(ARTIFACTS_DIR, "manifest.json");

export interface ArtifactBinary {
  name: string;
  lang: string;
  src: string;
  role: string;
  file: string | null;
  built: boolean;
  sha256: string | null;
  size: number;
}

export interface ArtifactManifest {
  schema: string;
  generatedAt: string;
  binaries: ArtifactBinary[];
  hostTools: { dir: string };
  dist: { dir: string; server: string; mcpStdio: string };
}

let cache: ArtifactManifest | null | undefined;

/** Read artifacts/manifest.json once (cached). null when not built yet. */
export function loadManifest(): ArtifactManifest | null {
  if (cache !== undefined) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as ArtifactManifest;
  } catch {
    cache = null;
  }
  return cache;
}

/**
 * Absolute path of a built native binary by name, or null if absent. Falls
 * back to artifacts/bin/<name> when the manifest is stale or missing so a
 * fresh `make build-all` is discoverable even before manifest regeneration.
 */
export function resolveBinary(name: string): string | null {
  const b = loadManifest()?.binaries.find((x) => x.name === name && x.built);
  if (b?.file) return path.join(REPO_ROOT, b.file);
  const guess = path.join(ARTIFACTS_DIR, "bin", name);
  return fs.existsSync(guess) ? guess : null;
}

/** Discovery summary for health / tools_doctor: which binaries are built. */
export function discoverBinaries(): { total: number; built: number; names: string[] } {
  const bins = loadManifest()?.binaries ?? [];
  const built = bins.filter((b) => b.built);
  return { total: bins.length, built: built.length, names: built.map((b) => b.name) };
}
