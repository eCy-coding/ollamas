// cli/commands/gemini.ts — `ollamas gemini` : bridge to Google's Gemini CLI.
//
// Subcommands:
//   ollamas gemini "<prompt>" [--json|--stream] [--model m] [--yolo] [--vertex] [--include <dir>]
//   ollamas gemini setup-mcp [--scope user|project] [--url <gw>/mcp]   register ollamas tools INTO Gemini CLI
//   ollamas gemini status [--json]                                     binary? auth mode? ollamas MCP registered?
//
// Choke-point safe (N-012): shells out to the external `gemini` binary; no server import.
// Zero-dep: node built-ins only. Research/plan: docs/GEMINI_CLI_{RESEARCH,PLAN}.md.
import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  spawnGemini, detectGemini, detectAuthMode,
  parseGeminiJson, foldStreamJson, mapExitCode, exitHint,
} from "../lib/gemini";

const USAGE = `ollamas gemini — bridge to Google's Gemini CLI

usage:
  ollamas gemini "<prompt>" [options]      run Gemini headless, print the answer
  ollamas gemini setup-mcp [options]       register the ollamas MCP server into Gemini CLI
  ollamas gemini status [--json]           show binary / auth mode / MCP registration

run options:
  --json              print the raw Gemini JSON ({response,stats,error})
  --stream            stream-json (JSONL) events live
  -m, --model <m>     model (e.g. gemini-3-pro, gemini-3-flash)
  --yolo              auto-approve ALL tool calls (sandboxed; trusted input ONLY)
  --vertex            use Vertex AI auth (GOOGLE_GENAI_USE_VERTEXAI=true)
  --include <dir>     add a context directory (repeatable)
setup-mcp options:
  --scope user|project   settings scope (default user)
  --url <url>            ollamas MCP url (default <gateway>/mcp)

auth: OAuth 'Sign in with Google' (default, free tier) · GEMINI_API_KEY · Vertex (--vertex).
prereq: npm i -g @google/gemini-cli
`;

function flagVal(argv: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(n + "="));
    if (eq) return eq.slice(n.length + 1);
  }
  return undefined;
}
function allVals(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && i + 1 < argv.length) out.push(argv[i + 1]);
  return out;
}

function gatewayUrl(): string {
  return (process.env.OLLAMAS_GATEWAY || "http://localhost:3000").replace(/\/$/, "");
}

// Thin: run `gemini <args>` and buffer the result (for mcp add / version-y subcalls).
function geminiExec(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("gemini", args, { timeout: 20000 }, (err: any, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || err?.message || "") });
    });
  });
}

const ABSENT = `gemini CLI not found on PATH.\ninstall: npm i -g @google/gemini-cli\nthen authenticate: run 'gemini' once (Sign in with Google), or set GEMINI_API_KEY.`;

export async function runGemini(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE); return 0; }
  const positional = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && isFlagValue(argv, i)));
  const sub = positional[0];
  if (sub === "setup-mcp") return setupMcp(argv);
  if (sub === "status") return status(argv);
  return runPrompt(argv, positional);
}

// True when argv[i] is the VALUE of a preceding value-flag (so it isn't a positional).
function isFlagValue(argv: string[], i: number): boolean {
  const prev = argv[i - 1];
  return prev === "-m" || prev === "--model" || prev === "--include" || prev === "--scope" || prev === "--url";
}

async function runPrompt(argv: string[], positional: string[]): Promise<number> {
  const prompt = positional[0];
  if (!prompt) { process.stderr.write("ollamas gemini: missing <prompt>\n" + USAGE); return 2; }

  const { present } = await detectGemini();
  if (!present) { process.stderr.write(ABSENT + "\n"); return 2; }

  const wantJson = argv.includes("--json");
  const wantStream = argv.includes("--stream");
  const format = wantJson ? "json" : wantStream ? "stream-json" : undefined;
  const env = { ...process.env };
  if (argv.includes("--vertex")) env.GOOGLE_GENAI_USE_VERTEXAI = "true";

  const opts = {
    prompt,
    model: flagVal(argv, "-m", "--model"),
    format: format as "json" | "stream-json" | undefined,
    yolo: argv.includes("--yolo"),
    includeDirs: allVals(argv, "--include"),
  };

  const res = await spawnGemini(opts, {
    env,
    // Stream JSONL straight through when --stream (caller pipes/parses).
    onChunk: wantStream && !process.stdout.isTTY ? (s) => process.stdout.write(s) : undefined,
  });
  const verdict = mapExitCode(res.code);

  if (wantStream) {
    if (process.stdout.isTTY) {
      const { response, toolCalls } = foldStreamJson(res.stdout);
      if (response) process.stdout.write(response + "\n");
      process.stderr.write(`— ${toolCalls} tool call(s), exit ${res.code} (${exitHint(verdict.kind)})\n`);
    }
    if (!verdict.ok && res.stderr) process.stderr.write(res.stderr + "\n");
    return verdict.ok ? 0 : 1;
  }

  if (wantJson) {
    // Pass the raw Gemini JSON straight through (already machine-readable).
    process.stdout.write(res.stdout.trim() + "\n");
    return verdict.ok ? 0 : 1;
  }

  // text mode: prefer a clean response if Gemini returned JSON, else raw stdout.
  const parsed = parseGeminiJson(res.stdout);
  process.stdout.write(((parsed?.response ?? res.stdout) || "").trimEnd() + "\n");
  if (!verdict.ok) process.stderr.write(`gemini: ${exitHint(verdict.kind)}${res.stderr ? ` — ${res.stderr.trim()}` : ""}\n`);
  return verdict.ok ? 0 : 1;
}

async function setupMcp(argv: string[]): Promise<number> {
  const { present } = await detectGemini();
  if (!present) { process.stderr.write(ABSENT + "\n"); return 2; }
  const scope = flagVal(argv, "--scope") === "project" ? "project" : "user";
  const url = flagVal(argv, "--url") || `${gatewayUrl()}/mcp`;
  const res = await geminiExec(["mcp", "add", "--transport", "http", "-s", scope, "ollamas", url]);
  if (res.code !== 0) {
    process.stderr.write(`gemini mcp add failed (exit ${res.code}): ${(res.stderr || res.stdout).trim()}\n`);
    return 1;
  }
  process.stdout.write(`registered ollamas MCP → Gemini CLI (${scope} scope): ${url}\n`);
  // Known bug (v0.22.2): mcp add may write an invalid "type":"http" key. Warn so the user
  // can fix ~/.gemini/settings.json if Gemini later refuses to load it.
  process.stdout.write("verify with: gemini mcp list   (if it errors on 'type', edit ~/.gemini/settings.json)\n");
  return 0;
}

async function status(argv: string[]): Promise<number> {
  const { present, version } = await detectGemini();
  const auth = detectAuthMode();
  const settingsPath = join(homedir(), ".gemini", "settings.json");
  let mcpRegistered = false;
  try {
    if (existsSync(settingsPath)) {
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      mcpRegistered = !!(s?.mcpServers && s.mcpServers.ollamas);
    }
  } catch { /* unreadable/invalid settings → not registered */ }

  const info = { present, version: version ?? null, authMode: auth.mode, authDetail: auth.detail, ollamasMcpRegistered: mcpRegistered, gateway: gatewayUrl() };
  if (argv.includes("--json")) { process.stdout.write(JSON.stringify(info, null, 2) + "\n"); return 0; }
  process.stdout.write(
    `gemini binary : ${present ? `✓ ${version}` : "✗ not found (npm i -g @google/gemini-cli)"}\n` +
    `auth mode     : ${auth.mode} (${auth.detail})\n` +
    `ollamas MCP   : ${mcpRegistered ? "✓ registered in ~/.gemini/settings.json" : "✗ not registered (run: ollamas gemini setup-mcp)"}\n` +
    `gateway       : ${gatewayUrl()}\n`,
  );
  return present ? 0 : 2;
}
