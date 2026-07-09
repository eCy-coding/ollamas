#!/usr/bin/env node
// @ts-check
// Settings schema guard — prevents the hallucinated-key class of bug (a wrong key name is
// silently ignored by Claude Code, so a "set" feature does nothing). Zero-dep: checks the
// top-level keys of .claude/settings.json against the canonical valid set derived from
// schemastore.org/claude-code-settings.json (embedded — no network at runtime).
// exit 0 = clean, exit 1 = unknown/known-bad key found. Run in apply-harness + pre-commit + CI.
//
// MAINTENANCE: if Claude Code adds a settings key, add it here (source: schemastore schema).

import { readFileSync } from "node:fs";

const VALID_TOP_LEVEL = new Set([
  // Authoritative — synced from live schemastore.org/claude-code-settings.json (2026-06-27, Chrome-verified).
  "$schema", "$comment",
  "apiKeyHelper", "autoMemoryEnabled", "autoUpdatesChannel", "awsCredentialExport", "awsAuthRefresh",
  "claudeMdExcludes", "cleanupPeriodDays", "env", "attribution", "includeGitInstructions",
  "includeCoAuthoredBy", "plansDirectory", "respectGitignore", "permissions", "language",
  "model", "availableModels", "modelOverrides", "effortLevel", "fastMode", "fastModePerSessionOptIn",
  "feedbackSurveyRate", "enableAllProjectMcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers",
  "allowedMcpServers", "deniedMcpServers", "httpHookAllowedEnvVars", "hooks", "disableAllHooks",
  "allowedChannelPlugins", "allowedHttpHookUrls", "allowManagedHooksOnly", "allowManagedPermissionRulesOnly",
  "statusLine", "fileSuggestion", "enabledPlugins", "extraKnownMarketplaces", "strictKnownMarketplaces",
  "skippedMarketplaces", "skippedPlugins", "forceLoginMethod", "forceLoginOrgUUID", "otelHeadersHelper",
  "outputStyle", "skipWebFetchPreflight", "sandbox", "spinnerVerbs", "spinnerTipsEnabled",
  "spinnerTipsOverride", "terminalProgressBarEnabled", "showTurnDuration", "skillOverrides",
  "prefersReducedMotion", "prUrlTemplate", "alwaysThinkingEnabled", "companyAnnouncements",
]);

// Keys proven WRONG (hallucinated / silently-ignored by Claude Code) — flag + auto-prune.
// Verified absent in live schema (Chrome, 2026-06-27).
const KNOWN_BAD = {
  showThinkingSummaries: "not a real key — thinking is via alwaysThinkingEnabled",
  autoCompactEnabled: "not in schema — auto-compact is always-on default, no settings key",
  fileCheckpointingEnabled: "not in schema — checkpointing/rewind is default, no settings key",
  subagentStatusLine: "not in schema — only statusLine exists",
};

const FILE = new URL("./settings.json", import.meta.url).pathname;
let cfg;
try { cfg = JSON.parse(readFileSync(FILE, "utf8")); }
catch (e) { console.error(`✗ cannot parse ${FILE}: ${e.message}`); process.exit(1); }

let bad = 0;
for (const k of Object.keys(cfg)) {
  if (k in KNOWN_BAD) { console.error(`✗ KNOWN-BAD key "${k}": ${KNOWN_BAD[k]}`); bad++; }
  else if (!VALID_TOP_LEVEL.has(k)) { console.error(`✗ UNKNOWN key "${k}" — not in schema; likely silently ignored. Verify against schemastore.`); bad++; }
}

// cli-extensions.json (add-cli output) — validate shape if present (malformed = silently-dropped perms).
import { existsSync } from "node:fs";
const EXT = new URL("./cli-extensions.json", import.meta.url).pathname;
if (existsSync(EXT)) {
  try {
    const ext = JSON.parse(readFileSync(EXT, "utf8"));
    for (const tier of ["allow", "ask"]) {
      if (ext[tier] !== undefined) {
        if (!Array.isArray(ext[tier])) { console.error(`✗ cli-extensions.${tier} must be an array`); bad++; }
        else for (const r of ext[tier]) if (typeof r !== "string" || !r.startsWith("Bash(")) { console.error(`✗ cli-extensions.${tier} bad rule (must be "Bash(...)"): ${JSON.stringify(r)}`); bad++; }
      }
    }
  } catch (e) { console.error(`✗ cli-extensions.json malformed: ${e.message}`); bad++; }
}

if (bad) { console.error(`settings validation FAILED: ${bad} bad key(s).`); process.exit(1); }
console.error(`✓ settings.json: ${Object.keys(cfg).length} top-level keys all valid.`);
process.exit(0);
