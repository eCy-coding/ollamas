#!/usr/bin/env -S npx tsx
// supervise — thin alias for `watch --raw`.
//
// WHY THIS EXISTS AS A SHIM
// v5 shipped `supervise.ts` (raw stream). v6 added `watch.ts` (readable stream) tailing the
// SAME logs, and left both — two surfaces, two maintenance points, drifting apart. v7 folds
// the raw mode into `watch --raw`, so there is one implementation. This file is NOT deleted,
// because anything that already invokes `pipeline/bin/supervise.ts` (docs, muscle memory, a
// launchd wrapper) must keep working — a removed entry point is a broken link, not a cleanup.
// It simply forwards to the single implementation.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
// `--raw` is implied; pass through everything else (--only, --source, --max, --plain).
const passthrough = argv.filter((a) => a !== "--raw");

const child = spawn("npx", ["tsx", join(here, "watch.ts"), "--raw", ...passthrough], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
