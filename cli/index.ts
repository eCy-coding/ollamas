#!/usr/bin/env node
// ollamas — unified CLI for the LLM Mission Control gateway.
// v1: chat, doctor, config. Subcommands grow per cli/ROADMAP.md.
// The CLI is a thin HTTP/MCP client; all tool side effects cross the gateway
// choke-point (AGENTS.md §4). It never imports server/tool-registry.
import { runChat } from "./commands/chat";
import { runDoctor } from "./commands/doctor";
import { loadConfig, saveConfig, configPath, type CliConfig } from "./lib/config";

const VERSION = "1.0.0";

const HELP = `ollamas v${VERSION} — LLM Mission Control CLI

usage: ollamas <command> [options]

commands:
  chat [prompt]      one-shot or interactive REPL against the gateway
  doctor             health of gateway + ollama + host-bridge
  config [k] [v]     show config, or set a key (gateway|model|provider|apiKey|profile)
  help               this message
  version            print version

global env:
  OLLAMAS_GATEWAY    gateway base url (default http://localhost:3000)
  OLLAMAS_API_KEY    bearer key for SAAS-enforced gateways
  OLLAMAS_MODEL      default model (default qwen3:8b)
  NO_COLOR           disable color
common flags:
  --json             machine-readable output
  -m, --model        override model        -p, --provider   override provider
`;

// Split argv into the command and its remaining args. Pure → unit-testable.
export function route(argv: string[]): { command: string; rest: string[] } {
  const idx = argv.findIndex((a) => !a.startsWith("-"));
  if (idx === -1) return { command: argv.length ? "help" : "help", rest: argv };
  return { command: argv[idx], rest: [...argv.slice(0, idx), ...argv.slice(idx + 1)] };
}

function runConfig(rest: string[]): number {
  const [key, value] = rest.filter((a) => !a.startsWith("-"));
  if (!key) {
    const cfg = loadConfig();
    const redacted = { ...cfg, apiKey: cfg.apiKey ? "***set***" : undefined };
    process.stdout.write(JSON.stringify({ path: configPath(), ...redacted }, null, 2) + "\n");
    return 0;
  }
  const allowed = ["gateway", "model", "provider", "apiKey", "profile"];
  if (!allowed.includes(key)) {
    process.stderr.write(`config: unknown key '${key}' (allowed: ${allowed.join(", ")})\n`);
    return 2;
  }
  if (value === undefined) {
    process.stdout.write(String((loadConfig() as any)[key] ?? "") + "\n");
    return 0;
  }
  saveConfig({ [key]: value } as Partial<CliConfig>);
  process.stdout.write(`config: ${key} updated → ${configPath()}\n`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { command, rest } = route(argv);
  switch (command) {
    case "chat":
      return runChat(rest);
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
    default:
      process.stderr.write(`ollamas: unknown command '${command}'\nrun 'ollamas help'\n`);
      return 2;
  }
}

// Only run when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && /(?:^|[\\/])(?:index\.(?:ts|cjs|js)|ollamas)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`fatal: ${e?.message || e}\n`);
      process.exit(1);
    });
}
