#!/usr/bin/env node
// ollamas — unified CLI for the LLM Mission Control gateway.
// Subcommands grow per cli/ROADMAP.md.
// The CLI is a thin HTTP/MCP client; all tool side effects cross the gateway
// choke-point (AGENTS.md §4). It never imports server/tool-registry.
import { runChat } from "./commands/chat";
import { runDoctor } from "./commands/doctor";
import { runAgent } from "./commands/agent";
import { runSaas } from "./commands/saas";
import { runBench } from "./commands/bench";
import { runMcp } from "./commands/mcp";
import { runShortcuts } from "./commands/shortcuts";
import { runTop } from "./commands/top";
import { complete, completionScript } from "./lib/completion";
import { runUpdate } from "./commands/update";
import { runPlugin } from "./commands/plugin";
import { loadRegistry, findPlugin, verifyPluginFile, isValidPluginName } from "./lib/plugins";
import { spawnSync } from "node:child_process";
import { loadConfig, saveConfig, configPath, profilePath, setActiveProfile, listProfiles, type CliConfig } from "./lib/config";
import { describeKeystore, migrateKeySource } from "./lib/keystore";

const VERSION = "11.0.0";

const HELP = `ollamas v${VERSION} — LLM Mission Control CLI

usage: ollamas [--gateway <url>] <command> [options]

commands:
  chat [prompt]      one-shot or interactive REPL against the gateway
  agent [task]       drive the ReAct agent loop (streams thought→step→done)
    agent sessions   list persisted agent sessions
    agent rm <id>    delete a session
  saas <action>      manage the SaaS layer (plans|tenants|keys|audit|usage|billing)
  mcp <action>       MCP client (info|tools|call|upstreams|add|rm) via /mcp
  bench              benchmark models (tok/s, TTFB) and pick the fastest
  top [--watch]      live metrics dashboard (requests, latency, tool calls)
  shortcuts build    generate an Apple Shortcuts pack (chat|status|bench|mcp-call)
  doctor             health of gateway + ollama + bridge + ready + agent
  config [k] [v]     show config, or set a key (gateway|model|provider|apiKey|saasAdminToken)
    config use <name>  switch active gateway profile (secrets sealed per profile)
    config profiles    list profiles
    config keystore [keychain|file]  show/migrate the master-key store (macOS Keychain)
  completion <shell> print a shell completion script (bash|zsh|fish)
  update [--check]   self-update from a release manifest (sha256-verified)
  plugin <action>    manage external subcommands (list|install|remove)
  help               this message
  version            print version

global env:
  OLLAMAS_GATEWAY    gateway base url (default http://localhost:3000)
  OLLAMAS_API_KEY    bearer key for SAAS-enforced gateways
  OLLAMAS_SAAS_ADMIN admin token (X-Admin-Token) for saas/billing commands
  OLLAMAS_MODEL      default model (default qwen3:8b)
  NO_COLOR           disable color
global flags:
  --gateway <url>    override gateway for this invocation
  --profile <name>   use a named gateway profile (config use <name> to set default)
  --insecure-storage force the file keystore (skip the macOS Keychain) for this run
common flags:
  --json             machine-readable output      --timeout <ms>  stream timeout
  -m, --model        override model               -p, --provider  override provider
run 'ollamas <command> --help' for per-command options.
`;

// Pull global flags (--gateway <url>, --profile <name>) out of argv. Pure → testable.
export function extractGlobalFlags(argv: string[]): { gateway?: string; profile?: string; insecureStorage?: boolean; rest: string[] } {
  const rest: string[] = [];
  let gateway: string | undefined;
  let profile: string | undefined;
  let insecureStorage: boolean | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--gateway" && i + 1 < argv.length) {
      gateway = argv[++i];
    } else if (argv[i].startsWith("--gateway=")) {
      gateway = argv[i].slice("--gateway=".length);
    } else if (argv[i] === "--profile" && i + 1 < argv.length) {
      profile = argv[++i];
    } else if (argv[i].startsWith("--profile=")) {
      profile = argv[i].slice("--profile=".length);
    } else if (argv[i] === "--insecure-storage") {
      insecureStorage = true; // force the file keystore, skip the macOS Keychain
    } else {
      rest.push(argv[i]);
    }
  }
  return { gateway, profile, insecureStorage, rest };
}

// Split argv into the command and its remaining args. Pure → unit-testable.
// Leading global flags with no subcommand map to version/help (G5).
export function route(argv: string[]): { command: string; rest: string[] } {
  const idx = argv.findIndex((a) => !a.startsWith("-"));
  if (idx === -1) {
    if (argv.includes("--version") || argv.includes("-v")) return { command: "version", rest: argv };
    return { command: "help", rest: argv };
  }
  return { command: argv[idx], rest: [...argv.slice(0, idx), ...argv.slice(idx + 1)] };
}

function runConfig(rest: string[]): number {
  const [key, value] = rest.filter((a) => !a.startsWith("-"));

  // config use <name> — switch the active gateway profile (creates it if new).
  if (key === "use") {
    if (!value) {
      process.stderr.write("config use: missing <name>  (try 'ollamas config profiles')\n");
      return 2;
    }
    try {
      setActiveProfile(value);
    } catch (e: any) {
      process.stderr.write(`config use: ${String(e?.message || e)}\n`);
      return 2;
    }
    process.stdout.write(`config: active profile → ${value}  (${profilePath(value)})\n`);
    return 0;
  }

  // config profiles — list every profile, mark the active one.
  if (key === "profiles") {
    for (const p of listProfiles()) {
      process.stdout.write(`${p.active ? "*" : " "} ${p.name.padEnd(14)} ${p.gateway.padEnd(28)} key:${p.hasKey ? "set" : "unset"}\n`);
    }
    return 0;
  }

  // config keystore [keychain|file] — show or migrate the master-key store (v11).
  // Migration carries the SAME key bytes so sealed secrets stay openable.
  if (key === "keystore") {
    if (!value) {
      const { source, detail } = describeKeystore();
      process.stdout.write(`keystore: ${source}  (${detail})\n`);
      return 0;
    }
    if (value !== "keychain" && value !== "file") {
      process.stderr.write("config keystore: expected <keychain|file>\n");
      return 2;
    }
    try {
      const { from, to } = migrateKeySource(value);
      process.stdout.write(`keystore: migrated ${from} → ${to} (same key bytes; sealed secrets intact)\n`);
      return 0;
    } catch (e: any) {
      process.stderr.write(`config keystore: ${String(e?.message || e)}\n`);
      return 2;
    }
  }

  const activeProfile = listProfiles().find((p) => p.active)?.name ?? "default";

  if (!key) {
    const cfg = loadConfig();
    const redacted = {
      ...cfg,
      apiKey: cfg.apiKey ? "***set***" : undefined,
      saasAdminToken: cfg.saasAdminToken ? "***set***" : undefined,
    };
    process.stdout.write(
      JSON.stringify({ path: profilePath(activeProfile), activeProfile, secretsEncryptedAtRest: true, ...redacted }, null, 2) + "\n",
    );
    return 0;
  }
  const allowed = ["gateway", "model", "provider", "apiKey", "saasAdminToken", "mcpGuardAllow", "mcpGuardDeny", "profile"];
  if (!allowed.includes(key)) {
    process.stderr.write(`config: unknown key '${key}' (allowed: ${allowed.join(", ")}; or 'use <name>' | 'profiles')\n`);
    return 2;
  }
  if (value === undefined) {
    process.stdout.write(String((loadConfig() as any)[key] ?? "") + "\n");
    return 0;
  }
  saveConfig({ [key]: value } as Partial<CliConfig>);
  const sealed = key === "apiKey" || key === "saasAdminToken" ? " (sealed)" : "";
  process.stdout.write(`config: ${key} updated${sealed} → [${activeProfile}] ${profilePath(activeProfile)}\n`);
  return 0;
}

function runCompletion(rest: string[]): number {
  const shell = rest.filter((a) => !a.startsWith("-"))[0];
  if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
    process.stderr.write("usage: ollamas completion <bash|zsh|fish>\n");
    return 2;
  }
  process.stdout.write(completionScript(shell));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const g = extractGlobalFlags(argv);
  if (g.gateway) process.env.OLLAMAS_GATEWAY = g.gateway; // env wins in loadConfig (G10)
  if (g.profile) process.env.OLLAMAS_PROFILE = g.profile; // --profile selects the active profile (v7)
  if (g.insecureStorage) process.env.OLLAMAS_KEYSTORE = "file"; // opt out of the keychain (v11)
  const { command, rest } = route(g.rest);
  switch (command) {
    case "chat":
      return runChat(rest);
    case "agent":
      return runAgent(rest);
    case "saas":
      return runSaas(rest);
    case "bench":
      return runBench(rest);
    case "mcp":
      return runMcp(rest);
    case "shortcuts":
      return runShortcuts(rest);
    case "top":
      return runTop(rest);
    case "completion":
      return runCompletion(rest);
    case "update":
      return runUpdate(rest, VERSION);
    case "plugin":
      return runPlugin(rest);
    case "__complete": {
      // Hidden — emitted on every TAB. Pure tree lookup, no I/O.
      const cands = complete(rest);
      if (cands.length) process.stdout.write(cands.join("\n") + "\n");
      return 0;
    }
    case "doctor":
      return runDoctor(rest);
    case "config":
      return runConfig(rest);
    case "version":
    case "--version":
      process.stdout.write(VERSION + "\n");
      return 0;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return 0;
    default: {
      // Plugin fallback (v10): an unknown command may be a registered plugin.
      // It runs ONLY if its file still matches the recorded sha256 — a tampered
      // or unregistered command falls through to the error below. Never exec
      // arbitrary $PATH binaries.
      if (isValidPluginName(command)) {
        const entry = findPlugin(loadRegistry(), command);
        if (entry) {
          if (!verifyPluginFile(entry.path, entry.sha256)) {
            process.stderr.write(`ollamas: plugin '${command}' failed checksum verification — refusing to run (reinstall with 'ollamas plugin install')\n`);
            return 1;
          }
          const r = spawnSync(entry.path, rest, { stdio: "inherit" });
          return r.status ?? 1;
        }
      }
      process.stderr.write(`ollamas: unknown command '${command}'\nrun 'ollamas help'\n`);
      return 2;
    }
  }
}

// Only run when invoked directly (not when imported by tests).
// Run when launched directly (node/tsx) OR as a compiled binary named ollamas*
// (Bun --compile output is ollamas-darwin-arm64 etc.). Importing in tests does
// not match (argv[1] is the test runner).
const invokedDirectly = process.argv[1] && /(?:^|[\\/])(?:index\.(?:ts|cjs|js)|ollamas[\w.\-]*)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`fatal: ${e?.message || e}\n`);
      process.exit(1);
    });
}
