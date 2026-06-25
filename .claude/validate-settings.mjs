#!/usr/bin/env node
// Settings schema guard — prevents the hallucinated-key class of bug (a wrong key name is
// silently ignored by Claude Code, so a "set" feature does nothing). Zero-dep: checks the
// top-level keys of .claude/settings.json against the canonical valid set derived from
// schemastore.org/claude-code-settings.json (embedded — no network at runtime).
// exit 0 = clean, exit 1 = unknown/known-bad key found. Run in apply-harness + pre-commit + CI.
//
// MAINTENANCE: if Claude Code adds a settings key, add it here (source: schemastore schema).

import { readFileSync } from "node:fs";

const VALID_TOP_LEVEL = new Set([
  "$schema", "$comment",
  "permissions", "hooks", "env", "model", "fallbackModel", "availableModels",
  "statusLine", "subagentStatusLine", "outputStyle", "effortLevel",
  "alwaysThinkingEnabled", "autoCompactEnabled", "autoMemoryEnabled", "autoMemoryDirectory",
  "fileCheckpointingEnabled", "sandbox", "enabledMcpjsonServers", "disabledMcpjsonServers",
  "enableAllProjectMcpServers", "cleanupPeriodDays", "includeCoAuthoredBy", "attribution",
  "apiKeyHelper", "forceLoginMethod", "disableAllHooks", "allowManagedHooksOnly",
  "additionalDirectories", "telemetry", "ultracode",
]);

// Keys proven WRONG (hallucinated / silently-ignored) — flag explicitly with the fix.
const KNOWN_BAD = { showThinkingSummaries: "not a real key — remove (thinking is via alwaysThinkingEnabled)" };

const FILE = new URL("./settings.json", import.meta.url).pathname;
let cfg;
try { cfg = JSON.parse(readFileSync(FILE, "utf8")); }
catch (e) { console.error(`✗ cannot parse ${FILE}: ${e.message}`); process.exit(1); }

let bad = 0;
for (const k of Object.keys(cfg)) {
  if (k in KNOWN_BAD) { console.error(`✗ KNOWN-BAD key "${k}": ${KNOWN_BAD[k]}`); bad++; }
  else if (!VALID_TOP_LEVEL.has(k)) { console.error(`✗ UNKNOWN key "${k}" — not in schema; likely silently ignored. Verify against schemastore.`); bad++; }
}

if (bad) { console.error(`settings validation FAILED: ${bad} bad key(s).`); process.exit(1); }
console.error(`✓ settings.json: ${Object.keys(cfg).length} top-level keys all valid.`);
process.exit(0);
