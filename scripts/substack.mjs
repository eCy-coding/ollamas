#!/usr/bin/env node
// @ts-check
// substack — toolkit for doing anything on Substack. Two data paths (Substack has no
// official API + Cloudflare-gates plain fetch):
//
//   PUBLIC  (any publication/post/profile/archive) → Firecrawl bypasses Cloudflare →
//           markdown. Works headless; sub-agents can call it via macos_terminal.
//   AUTH    (the user's own subscriptions / stats / own-notes) → the logged-in browser.
//           Claude navigates `substack.com/api/v1/<endpoint>` via the Chrome MCP and reads
//           the raw JSON (the session cookie is httpOnly, so a script cannot do this).
//
// This script covers the PUBLIC path. The AUTH path is Claude-driven (Chrome MCP) and
// documented below + in memory `substack-mastery.md`.
//
// Usage:
//   node scripts/substack.mjs archive <subdomain> [count]   # recent posts of a publication
//   node scripts/substack.mjs post <post-url>               # read a post -> markdown
//   node scripts/substack.mjs profile <handle|url>          # a writer's profile page
//   node scripts/substack.mjs search "<query>"              # web search (Substack-scoped)
//   node scripts/substack.mjs help
//
// AUTH endpoints (Claude runs these via Chrome MCP, navigate + get_page_text):
//   substack.com/api/v1/subscriptions?tvOnly=false          # your subscriptions (proven)
//   substack.com/api/v1/user/<handle>/public_profile        # full profile JSON
//   <sub>.substack.com/api/v1/posts?limit=N&offset=0        # a pub's posts (also public via firecrawl)
//   <sub>.substack.com/api/v1/post/<id>/stats               # post stats (writer-only)
//   substack.com/api/v1/reader/feed/... , /api/v1/notes     # feed / notes

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(execFile);

const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.find((a) => !a.startsWith("--"));

const fc = async (fcArgs) => {
  try { const r = await pexec("node", ["scripts/firecrawl.mjs", ...fcArgs], { cwd: REPO, timeout: 90000, maxBuffer: 8 * 1024 * 1024 }); return r.stdout; }
  catch (e) { return (e.stdout || "") + (e.stderr ? `\n[err] ${e.stderr.slice(0, 120)}` : ""); }
};

const subOf = (s) => /^https?:/.test(s) ? s : `${s}.substack.com`;

if (!cmd || cmd === "help") {
  console.log(`substack toolkit — commands:
  archive <subdomain> [count]   recent posts of a publication (firecrawl)
  post <post-url>               read a post -> markdown (firecrawl)
  profile <handle|url>          a writer's profile (firecrawl)
  search "<query>"              web search (firecrawl --search)
AUTH (your own data) is Claude-driven via Chrome MCP — ask: "substack aboneliklerim / stats".
WRITE ops (publish post, comment, subscribe) require your explicit per-action confirmation.`);
  process.exit(0);
}

let out;
if (cmd === "archive") {
  if (!arg) { console.error("usage: substack.mjs archive <subdomain> [count]"); process.exit(2); }
  out = await fc([`${subOf(arg)}/archive?sort=new`]);
} else if (cmd === "post") {
  if (!arg) { console.error("usage: substack.mjs post <post-url>"); process.exit(2); }
  out = await fc([arg]);
} else if (cmd === "profile") {
  if (!arg) { console.error("usage: substack.mjs profile <handle|url>"); process.exit(2); }
  out = await fc([/^https?:/.test(arg) ? arg : `https://substack.com/@${arg.replace(/^@/, "")}`]);
} else if (cmd === "search") {
  const q = rest.filter((a) => !a.startsWith("--")).join(" ");
  out = await fc(["--search", q || arg || ""]);
} else {
  console.error(`unknown command: ${cmd} (try: help)`); process.exit(2);
}
console.log(out);
