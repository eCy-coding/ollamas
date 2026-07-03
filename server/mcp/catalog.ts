// Curated MCP upstream catalog (dalga-2). One-click add of vetted, free,
// MIT-licensed reference servers as per-tenant stdio upstreams. Pure data +
// small injectable helpers — no side effects at import time.
//
// Curation rules: official modelcontextprotocol/servers only, MIT, stdio,
// zero-account. Archived servers (sqlite/github/slack/brave/postgres) are
// deliberately excluded. Adoption is binary-invoke (npx/uvx spawn, no source
// copy) — same discipline as caddy/mkcert/gemini-cli.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CatalogEntry {
  id: string;
  title: string;
  desc: string;
  license: "MIT";
  transport: "stdio";
  command: string;
  args: string[];
  /** Runtime the entry needs on the host: node's npx or Python's uvx. */
  requires: "npx" | "uvx";
  tags: string[];
  note?: string;
}

// Placeholder expanded by resolveArgs() so the CATALOG constant stays pure.
export const FS_DIR_TEMPLATE = "${MCP_FS_DIR}";

const NPX_NOTE = "First launch downloads the package (~10-30s); the supervisor retries until it connects.";

export const CATALOG: CatalogEntry[] = [
  {
    id: "memory",
    title: "Memory (knowledge graph)",
    desc: "Persistent local knowledge graph — entities, relations, observations. Agent memory that never leaves the machine.",
    license: "MIT",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    requires: "npx",
    tags: ["local", "zero-account"],
    note: NPX_NOTE,
  },
  {
    id: "filesystem",
    title: "Filesystem (sandboxed)",
    desc: `File tools scoped to a dedicated sandbox dir (${FS_DIR_TEMPLATE}) — tenants never see workspace source, secrets, or the store.`,
    license: "MIT",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", FS_DIR_TEMPLATE],
    requires: "npx",
    tags: ["local", "zero-account", "sandboxed"],
    note: NPX_NOTE,
  },
  {
    id: "everything",
    title: "Everything (demo/test)",
    desc: "Canonical MCP exerciser — echo, add, sampling, prompts. Useful to smoke-test the gateway pipeline.",
    license: "MIT",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    requires: "npx",
    tags: ["local", "demo"],
    note: NPX_NOTE,
  },
  {
    id: "git",
    title: "Git",
    desc: "Read, search and inspect local Git repositories.",
    license: "MIT",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git"],
    requires: "uvx",
    tags: ["local", "zero-account"],
    note: "Requires Python uvx (brew install uv). " + NPX_NOTE,
  },
  {
    id: "fetch",
    title: "Fetch (web)",
    desc: "Fetches a URL and converts it to LLM-friendly markdown. NOTE: makes outbound web requests.",
    license: "MIT",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requires: "uvx",
    tags: ["outbound-web"],
    note: "Requires Python uvx (brew install uv). Outbound network access — add only if that is acceptable.",
  },
  {
    id: "time",
    title: "Time",
    desc: "Time and timezone conversion tools. Fully local.",
    license: "MIT",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time"],
    requires: "uvx",
    tags: ["local", "zero-account"],
    note: "Requires Python uvx (brew install uv).",
  },
  {
    id: "sequential-thinking",
    title: "Sequential Thinking",
    desc: "Structured, reflective step-by-step reasoning aid — the 7th official reference server. Fully local.",
    license: "MIT",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    requires: "npx",
    tags: ["local", "zero-account"],
    note: NPX_NOTE,
  },
  {
    id: "playwright",
    title: "Playwright (browser)",
    desc: "Microsoft's browser automation via accessibility snapshots (Chromium/Firefox/WebKit). Runs locally — pages never leave the machine.",
    license: "MIT",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    requires: "npx",
    tags: ["local"],
    note: "First launch downloads the browser engines (~large). Local automation.",
  },
];

/** Dedicated filesystem sandbox for the catalog's filesystem entry. */
export function catalogFsDir(home: string = os.homedir()): string {
  return path.join(home, ".llm-mission-control", "mcp-fs");
}

/**
 * Expand templates to concrete host paths. Creates the filesystem sandbox dir
 * (idempotent) so the spawned server doesn't fail on a missing root. mkdir is
 * injectable for tests.
 */
export function resolveArgs(
  entry: CatalogEntry,
  home: string = os.homedir(),
  mkdir: (p: string) => void = (p) => fs.mkdirSync(p, { recursive: true }),
): string[] {
  return entry.args.map((a) => {
    if (!a.includes(FS_DIR_TEMPLATE)) return a;
    const dir = catalogFsDir(home);
    try { mkdir(dir); } catch { /* fail-soft: server surfaces the real error on spawn */ }
    return a.replaceAll(FS_DIR_TEMPLATE, dir);
  });
}

// Runtime presence won't change mid-process; cache per command.
const availability = new Map<string, boolean>();
export function clearAvailabilityCache(): void { availability.clear(); }

export function checkAvailable(
  cmd: string,
  exec: (file: string, args: string[]) => unknown = (f, a) => execFileSync(f, a, { stdio: "ignore" }),
): boolean {
  const hit = availability.get(cmd);
  if (hit !== undefined) return hit;
  let ok = false;
  try { exec("which", [cmd]); ok = true; } catch { ok = false; }
  availability.set(cmd, ok);
  return ok;
}

/**
 * Shape the catalog for the API: concrete args + host availability + whether
 * the tenant already installed each entry. Pure given its inputs.
 */
export function decorateCatalog(
  installedNames: Set<string>,
  isAvailable: (cmd: string) => boolean = checkAvailable,
  home: string = os.homedir(),
): Array<CatalogEntry & { available: boolean; installed: boolean }> {
  return CATALOG.map((e) => ({
    ...e,
    args: resolveArgs(e, home),
    available: isAvailable(e.requires),
    installed: installedNames.has(e.id),
  }));
}
