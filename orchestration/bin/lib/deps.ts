/**
 * orchestration/bin/lib/deps.ts — PURE Brewfile parser + dependency classifier (iter-10).
 *
 * Parses the root `Brewfile` into typed deps with their tier (from `# === TIER: <name> ===` headers), the CLI
 * name to probe (`command -v`), and whether a missing one BLOCKs (core) or just WARNs (everything else). No IO
 * here → unit-tested; `deps-doctor.ts` does the presence check + brew install.
 */

export type Tier = "core" | "dev" | "asset" | "tunnel" | "packaging" | "ai" | "cask";

export interface Dep {
  name: string;   // brew formula/cask name
  tier: string;   // tier from the section header
  cask: boolean;  // true for `cask "..."`
}

/** Formula name → the binary that `command -v` should find (differs when the formula name ≠ the CLI). */
const BIN_OVERRIDE: Record<string, string> = {
  librsvg: "rsvg-convert",
  imagemagick: "magick",
  "wireguard-tools": "wg",
};

/** The command to probe for a dep's presence. */
export function binName(dep: Dep): string {
  return BIN_OVERRIDE[dep.name] ?? dep.name;
}

/** Missing a `core` dep blocks boot; anything else is advisory. */
export function severityOf(tier: string): "BLOCK" | "WARN" {
  return tier === "core" ? "BLOCK" : "WARN";
}

/** Parse a Brewfile: track the current tier from `# === TIER: x ===` headers; collect brew/cask lines. */
export function parseBrewfile(text: string): Dep[] {
  const out: Dep[] = [];
  let tier = "core";
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    const t = line.match(/^#\s*===\s*TIER:\s*([a-z]+)\s*===/i);
    if (t) { tier = t[1].toLowerCase(); continue; }
    if (line.startsWith("#") || !line) continue;
    const m = line.match(/^(brew|cask)\s+"([^"]+)"/);
    if (m) out.push({ name: m[2], tier, cask: m[1] === "cask" });
  }
  return out;
}

export interface DepStatus extends Dep { present: boolean; bin: string; severity: "BLOCK" | "WARN"; }

/** Combine parsed deps with a presence-predicate (injected by the IO shell) into full statuses. */
export function classify(deps: Dep[], isPresent: (bin: string) => boolean): DepStatus[] {
  return deps.map((d) => {
    const bin = binName(d);
    return { ...d, bin, present: isPresent(bin), severity: severityOf(d.tier) };
  });
}

export interface DepSummary { total: number; present: number; missing: number; missingBlock: number; missingByTier: Record<string, number>; }

export function summarize(statuses: DepStatus[]): DepSummary {
  const missing = statuses.filter((s) => !s.present);
  const missingByTier: Record<string, number> = {};
  for (const s of missing) missingByTier[s.tier] = (missingByTier[s.tier] || 0) + 1;
  return {
    total: statuses.length,
    present: statuses.length - missing.length,
    missing: missing.length,
    missingBlock: missing.filter((s) => s.severity === "BLOCK").length,
    missingByTier,
  };
}
