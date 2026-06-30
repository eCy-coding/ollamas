#!/usr/bin/env node
// scripts/council.mjs — open a NEW Terminal.app window and run the live council debate inside it
// (so the operator SEES the local models argue interactively). Zero-dep.
//
//   node scripts/council.mjs "is binary search O(log n)? prove it" [--models a,b,c] [--rounds 2] [--here]
//
// --here (or a non-macOS host / no osascript) runs the debate inline in the current terminal.
import { spawn, execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const here = argv.includes("--here");
const passed = argv.filter((a) => a !== "--here");

// POSIX single-quote a string for embedding in a shell command.
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function runInline() {
  const child = spawn(process.execPath, [resolve(REPO, "scripts/council-debate.mjs"), ...passed], { cwd: REPO, stdio: "inherit" });
  child.on("exit", (c) => process.exit(c ?? 0));
}

function hasOsascript() {
  try { execFileSync("which", ["osascript"], { stdio: "ignore" }); return true; } catch { return false; }
}

if (here || platform() !== "darwin" || !hasOsascript()) {
  if (!here && platform() !== "darwin") process.stderr.write("[council] non-macOS host → running inline (Terminal.app is macOS-only)\n");
  runInline();
} else {
  // Build the shell command the Terminal window will run, then the AppleScript that opens a NEW
  // window and runs it. Escape for the AppleScript string literal (\\ then ").
  const inner = `cd ${shq(REPO)} && ${shq(process.execPath)} scripts/council-debate.mjs ${passed.map(shq).join(" ")}`;
  const forApple = inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "Terminal"\n  activate\n  do script "${forApple}"\nend tell`;
  try {
    execFileSync("osascript", ["-e", script], { timeout: 15000 });
    process.stdout.write("[council] opened a new Terminal.app window — the debate is live there.\n");
  } catch (e) {
    process.stderr.write(`[council] could not open Terminal.app (${(e && e.message) || e}) → running inline\n`);
    runInline();
  }
}
