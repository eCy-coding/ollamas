// `ollamas update` — self-update from a release manifest (v10). SECURITY-SENSITIVE:
// the new asset is sha256-verified against the manifest BEFORE anything touches
// the live binary; a mismatch aborts and the running binary is never modified.
// The manifest/asset are fetched with a standalone `fetch` — a release download is
// NOT a tool call, so it legitimately bypasses the gateway /mcp choke-point (it
// never goes through GatewayClient). The manifest URL is explicit (--manifest /
// OLLAMAS_UPDATE_MANIFEST) — nothing hardcoded, no network on startup.
//
// Atomic-replace recipe (deno upgrade / tj/go-update, MIT): write to a temp file
// in the TARGET's directory (same filesystem — cross-device rename fails), verify,
// chmod +x, drop macOS quarantine, then renameSync over the target. Replacing a
// running executable works because the open inode survives the rename.
import { parseArgs } from "node:util";
import { writeFileSync, renameSync, unlinkSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveOutputCtx, c, type OutputCtx } from "../lib/output";
import { confirm } from "../lib/io";
import { parseManifest, selectAsset, isNewer, currentTarget, sha256Hex, type Manifest, type Asset } from "../lib/manifest";

const HELP = `ollamas update — self-update from a release manifest

  update [--check] [--manifest <url>] [--yes]

  --check          show current/latest + the asset, do NOT download
  --manifest <url> manifest URL (else \$OLLAMAS_UPDATE_MANIFEST)
  --yes            skip the confirm prompt

The downloaded asset is sha256-verified against the manifest before it replaces
the running binary; a mismatch aborts without touching it.`;

export type UpdateAction = "up-to-date" | "update" | "no-asset";

// PURE: decide what an update would do, given the manifest + current version +
// this machine's target. No I/O.
export function planUpdate(
  manifest: Manifest,
  currentVersion: string,
  target: string,
): { action: UpdateAction; latest: string; asset?: Asset } {
  if (!isNewer(currentVersion, manifest.version)) return { action: "up-to-date", latest: manifest.version };
  const asset = selectAsset(manifest, target);
  if (!asset) return { action: "no-asset", latest: manifest.version };
  return { action: "update", latest: manifest.version, asset };
}

export async function runUpdate(argv: string[], currentVersion: string): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      check: { type: "boolean" },
      manifest: { type: "string" },
      target: { type: "string" }, // internal/test override for the replace target
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const manifestUrl = (values.manifest as string) || process.env.OLLAMAS_UPDATE_MANIFEST;
  if (!manifestUrl) {
    process.stderr.write(
      "update: no manifest configured — pass --manifest <url> or set OLLAMAS_UPDATE_MANIFEST (see cli/UPDATE.md)\n",
    );
    return 2;
  }

  let manifest: Manifest;
  try {
    const r = await fetch(manifestUrl, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`manifest ${manifestUrl} → ${r.status}`);
    manifest = parseManifest(await r.text());
  } catch (e: any) {
    process.stderr.write(c("red", `update: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 1;
  }

  const target = (values.target as string) || process.argv[1] || "";
  const plan = planUpdate(manifest, currentVersion, currentTarget());

  if (ctx.json) {
    process.stdout.write(JSON.stringify({ current: currentVersion, ...plan }, null, 2) + "\n");
    return 0;
  }
  if (plan.action === "up-to-date") {
    process.stdout.write(c("green", `already up to date (${currentVersion})`, ctx.color) + "\n");
    return 0;
  }
  if (plan.action === "no-asset") {
    process.stderr.write(c("yellow", `update: ${plan.latest} available but no asset for ${currentTarget()}`, ctx.color) + "\n");
    return 1;
  }

  const asset = plan.asset!;
  process.stdout.write(`${c("cyan", currentVersion, ctx.color)} → ${c("green", plan.latest, ctx.color)}  (${asset.target})\n`);
  if (values.check) return 0;

  // Running via `node …index.cjs` (npm-linked) — don't binary-swap a JS file.
  if (/\.(cjs|mjs|js|ts)$/.test(target)) {
    process.stderr.write(
      c("yellow", "update: this is a node-run install — update via your package manager (npm) instead of self-replace.", ctx.color) + "\n",
    );
    return 2;
  }

  if (!values.yes && process.stdout.isTTY) {
    const ok = await confirm(c("yellow", `replace ${target} with ${plan.latest}? [y/N] `, ctx.color));
    if (!ok) {
      process.stdout.write(c("dim", "aborted", ctx.color) + "\n");
      return 0;
    }
  }

  try {
    await applyUpdate(asset, target, ctx);
    process.stdout.write(c("green", `updated to ${plan.latest}`, ctx.color) + "\n");
    return 0;
  } catch (e: any) {
    process.stderr.write(c("red", `update: ${String(e?.message || e)}`, ctx.color) + "\n");
    return 1;
  }
}

// Download → sha256-verify → atomic replace. THROWS (leaving the live binary
// untouched) if the hash doesn't match.
async function applyUpdate(asset: Asset, target: string, ctx: OutputCtx): Promise<void> {
  const r = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`asset ${asset.url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());

  const got = sha256Hex(buf);
  if (got !== asset.sha256) {
    throw new Error(`sha256 mismatch — refusing to install (expected ${asset.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…)`);
  }

  // Temp in the TARGET's dir → same filesystem for an atomic rename.
  const tmp = join(dirname(target), `.ollamas-update-${got.slice(0, 8)}.tmp`);
  try {
    writeFileSync(tmp, buf, { mode: 0o755 });
    chmodSync(tmp, 0o755);
    if (process.platform === "darwin") {
      try {
        execFileSync("xattr", ["-d", "com.apple.quarantine", tmp], { stdio: "ignore" });
      } catch {
        /* no quarantine attr — fine */
      }
    }
    renameSync(tmp, target); // atomic; running binary's inode stays open
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp already gone */
    }
    void ctx;
    throw e;
  }
}
