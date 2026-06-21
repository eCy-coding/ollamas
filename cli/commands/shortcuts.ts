// `ollamas shortcuts build` — emit an Apple Shortcuts pack (v6). The CLI stays a
// thin client: it only renders plists + cards from pure builders (lib/shortcuts)
// and writes them locally. No gateway call is required to build; the optional
// `shortcuts import` step shells out to Apple's signer on macOS only.
//
//   ollamas shortcuts build [--url <gateway>] [--embed-key] [--out <dir>] [--import] [--json]
//
// Default gateway URL = config gateway. localhost won't work from an iPhone, so
// pass --url with your tailscale/LAN URL (see cli/REMOTE_EXPOSURE.md).
//
// SECURITY: auth defaults to the placeholder __OLLAMAS_API_KEY__. --embed-key
// bakes the real config key into the plists — gated behind a TTY confirm and
// REFUSED under --json (non-interactive). Artifacts are written 0600 in a 0700
// dir outside the repo (~/.ollamas/shortcuts).
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, c, type OutputCtx } from "../lib/output";
import { confirm } from "../lib/io";
import {
  allRecipes,
  buildWorkflowPlist,
  recipeCard,
  API_KEY_PLACEHOLDER,
  type Recipe,
} from "../lib/shortcuts";

const HELP = `ollamas shortcuts build — generate an Apple Shortcuts pack

  build [options]    write chat/status/bench/mcp-call shortcuts + cards

options:
  --url <gateway>    URL baked into the shortcuts (default: config gateway;
                     localhost is unreachable from a phone — use a tailscale URL)
  --embed-key        bake the real OLLAMAS_API_KEY into the plists (TTY-confirmed,
                     refused with --json). Default leaves ${API_KEY_PLACEHOLDER}.
  --out <dir>        output dir (default ~/.ollamas/shortcuts)
  --import           on macOS, run 'shortcuts import' on each plist (re-signs)
  --json             print the artifact manifest as JSON
  --help

note: Apple's .shortcut is signed — unsigned files can't import on iOS. On macOS
'shortcuts import' re-signs locally; on iOS follow the .card.md by hand.`;

export interface Artifact {
  relPath: string;
  absPath: string;
  mode: number;
  content: string;
}

// Build the full artifact set (plist + card per recipe, plus a README index)
// for an output dir. Pure → no disk touched, unit-testable.
export function planArtifacts(recipes: Recipe[], outDir: string): Artifact[] {
  const arts: Artifact[] = [];
  for (const r of recipes) {
    arts.push({
      relPath: `${r.slug}.plist`,
      absPath: join(outDir, `${r.slug}.plist`),
      mode: 0o600,
      content: buildWorkflowPlist(r.actions),
    });
    arts.push({
      relPath: `${r.slug}.card.md`,
      absPath: join(outDir, `${r.slug}.card.md`),
      mode: 0o600,
      content: recipeCard(r),
    });
  }
  arts.push({
    relPath: "README.md",
    absPath: join(outDir, "README.md"),
    mode: 0o600,
    content: readme(recipes),
  });
  return arts;
}

function readme(recipes: Recipe[]): string {
  const lines = [
    "# ollamas Shortcuts pack",
    "",
    "macOS — import (re-signs locally), then sync to iPhone via iCloud:",
    "```",
    ...recipes.map((r) => `  shortcuts import ${r.slug}.plist`),
    "```",
    "",
    "iPhone (no Mac) — open each `*.card.md` and build the shortcut by hand.",
    "",
    "Recipes:",
    ...recipes.map((r) => `  • ${r.slug} — ${r.description}`),
    "",
    `Auth: replace ${API_KEY_PLACEHOLDER} with your OLLAMAS_API_KEY.`,
    "Remote: expose the gateway with `tailscale serve` — see cli/REMOTE_EXPOSURE.md.",
    "All requests use stream:false (Shortcuts cannot read SSE).",
  ];
  return lines.join("\n");
}

export async function runShortcuts(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      url: { type: "string" },
      out: { type: "string" },
      "embed-key": { type: "boolean" },
      import: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  if (values.help || positionals[0] !== "build") {
    process.stdout.write(HELP + "\n");
    return values.help ? 0 : 2;
  }

  const cfg = loadConfig();
  const gateway = (values.url as string) || cfg.gateway;
  const outDir = (values.out as string) || join(homedir(), ".ollamas", "shortcuts");

  // --- auth decision (HIL gate) ---
  let auth = API_KEY_PLACEHOLDER;
  if (values["embed-key"]) {
    if (ctx.json) {
      process.stderr.write("shortcuts: --embed-key cannot be combined with --json (would print a secret)\n");
      return 2;
    }
    if (!cfg.apiKey) {
      process.stderr.write("shortcuts: --embed-key needs OLLAMAS_API_KEY (none configured)\n");
      return 2;
    }
    const ok = await confirm(
      c("yellow", `embed your API key into ${gateway} shortcuts at ${outDir}? It will sit in plaintext files. [y/N] `, ctx.color),
    );
    if (!ok) {
      process.stdout.write(c("dim", "aborted — no files written", ctx.color) + "\n");
      return 0;
    }
    auth = cfg.apiKey;
  }

  if (gateway.includes("localhost") || gateway.includes("127.0.0.1")) {
    process.stderr.write(
      c("yellow", `warning: ${gateway} is local — unreachable from a phone. Pass --url <tailscale-url> (see cli/REMOTE_EXPOSURE.md).`, ctx.color) + "\n",
    );
  }

  const recipes = allRecipes(gateway, auth, cfg.model, cfg.provider);
  const arts = planArtifacts(recipes, outDir);

  // --- I/O shell: 0700 dir, 0600 files ---
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const a of arts) writeFileSync(a.absPath, a.content, { mode: a.mode });

  if (ctx.json) {
    process.stdout.write(JSON.stringify({ outDir, embedded: auth !== API_KEY_PLACEHOLDER, files: arts.map((a) => a.relPath) }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(c("green", `wrote ${arts.length} files`, ctx.color) + ` → ${outDir}\n`);
  for (const r of recipes) process.stdout.write(`  • ${c("cyan", r.slug, ctx.color)}  ${c("dim", r.description, ctx.color)}\n`);
  if (auth === API_KEY_PLACEHOLDER) {
    process.stdout.write(c("dim", `  replace ${API_KEY_PLACEHOLDER} with your key before use\n`, ctx.color));
  }

  // Optional: re-sign + register via Apple's CLI (macOS only).
  if (values.import) {
    if (process.platform !== "darwin") {
      process.stderr.write(c("yellow", "  --import skipped: 'shortcuts' CLI is macOS-only\n", ctx.color));
      return 0;
    }
    for (const r of recipes) {
      const res = spawnSync("shortcuts", ["import", join(outDir, `${r.slug}.plist`)], { encoding: "utf8" });
      // shortcuts emits a benign 'Unrecognized attribute string' to stderr; the
      // import opens a GUI consent sheet, so we log the outcome honestly rather
      // than assert success (CLI_AGENTS evidence rule).
      const note = res.status === 0 ? c("green", "imported", ctx.color) : c("yellow", `import exit=${res.status}`, ctx.color);
      process.stdout.write(`  ${c("cyan", r.slug, ctx.color)} → ${note}\n`);
    }
  }
  return 0;
}
