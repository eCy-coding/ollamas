// Obsidian Local REST API client (L26) — the surface that lets the orchestra READ the vault.
//
// WHY: until now the vault was strictly write-only. ollamas, eCym, odysseus and claudecode
// all pushed notes into it; not one of them could ask it a question. The obsidian-local-rest-api
// plugin exposes the live vault over authenticated HTTPS (and an MCP server at /mcp/) with
// things the filesystem alone cannot give: resolved backlinks, the tag index, the active file,
// periodic-note paths, and the command palette.
//
// Two properties this module refuses to trade away:
//
//  1. TLS verification stays ON. The plugin mints a self-signed cert, but it also stores that
//     cert in its own data.json — so we pin it as a CA instead of setting rejectUnauthorized
//     false or opening the plaintext port. Encrypted AND authenticated, no new listener.
//  2. Every call degrades honestly. Obsidian is a desktop app; it can be closed. A closed
//     vault yields ok:false, never a throw and never invented data — callers fall back to the
//     brain's own recall, which is authoritative anyway.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

export interface ObsidianCreds {
  apiKey: string;
  /** PEM of the plugin's self-signed cert — pinned as the CA for every request. */
  ca: string;
  port: number;
}

export const defaultVault = (): string => process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`;

const dataJsonPath = (vault: string) =>
  join(vault, ".obsidian", "plugins", "obsidian-local-rest-api", "data.json");

/** Where the key is mirrored for out-of-process consumers (eCym's ecy-io, L30). */
export const tokenMirrorPath = (): string => `${process.env.HOME}/.llm-mission-control/obsidian-rest.token`;

/**
 * Read credentials from the plugin's own settings file. The plugin generates the key and cert
 * on first load, so there is nothing for a human to copy anywhere — this is what makes the
 * whole surface zero-touch.
 */
export function readObsidianCreds(vault = defaultVault()): ObsidianCreds | null {
  try {
    const d = JSON.parse(readFileSync(dataJsonPath(vault), "utf8"));
    const apiKey = typeof d?.apiKey === "string" ? d.apiKey : "";
    const ca = typeof d?.crypto?.cert === "string" ? d.crypto.cert : "";
    const port = Number(d?.port) || 27124;
    if (!apiKey || !ca) return null;
    return { apiKey, ca, port };
  } catch { return null; }
}

/** Mirror the key (0600) so a non-node consumer can authenticate without parsing the vault. */
export function mirrorToken(creds: ObsidianCreds): void {
  try { writeFileSync(tokenMirrorPath(), creds.apiKey, { mode: 0o600 }); } catch { /* best-effort */ }
}

// One dispatcher per cert so we are not rebuilding a TLS context on every call.
const dispatchers = new Map<string, Agent>();
function dispatcherFor(ca: string): Agent {
  let a = dispatchers.get(ca);
  if (!a) { a = new Agent({ connect: { ca } }); dispatchers.set(ca, a); }
  return a;
}

let warned = false;
/** Warn once. A 5-minute sync tick against a closed Obsidian must not become a log storm. */
function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[obsidian-rest] ${msg}`);
}

export interface RestOpts { vault?: string; timeoutMs?: number; creds?: ObsidianCreds | null }

/** Authenticated, CA-pinned request. Returns null when the vault is unreachable or unconfigured. */
export async function obsidianRequest(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  opts: RestOpts = {},
): Promise<{ status: number; text: string } | null> {
  const creds = opts.creds !== undefined ? opts.creds : readObsidianCreds(opts.vault ?? defaultVault());
  if (!creds) { warnOnce("no credentials — is the Local REST API plugin installed and Obsidian launched once?"); return null; }
  try {
    const res = await undiciFetch(`https://127.0.0.1:${creds.port}${path}`, {
      method: init.method || "GET",
      body: init.body,
      headers: { authorization: `Bearer ${creds.apiKey}`, ...(init.headers || {}) },
      dispatcher: dispatcherFor(creds.ca),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    return { status: res.status, text: await res.text() };
  } catch (e: any) {
    // Obsidian closed, plugin disabled, cert rotated — all "offline", none fatal.
    warnOnce(`vault offline (${e?.cause?.code || e?.name || "error"}) — falling back to brain-only recall`);
    return null;
  }
}

export interface ObsidianHealth {
  ok: boolean;
  port?: number;
  service?: string;
  pluginVersion?: string;
  obsidianVersion?: string;
  authenticated?: boolean;
  error?: string;
}

/** Liveness + identity. Distinguishes "not running" from "running but rejecting our key". */
export async function obsidianHealth(opts: RestOpts = {}): Promise<ObsidianHealth> {
  const creds = opts.creds !== undefined ? opts.creds : readObsidianCreds(opts.vault ?? defaultVault());
  if (!creds) return { ok: false, error: "not configured" };
  const r = await obsidianRequest("/", {}, { ...opts, creds });
  if (!r) return { ok: false, port: creds.port, error: "offline" };
  if (r.status === 401) return { ok: false, port: creds.port, authenticated: false, error: "api key rejected" };
  try {
    const j = JSON.parse(r.text);
    return {
      ok: j?.status === "OK", port: creds.port, authenticated: true,
      service: j?.manifest?.name, pluginVersion: j?.versions?.self, obsidianVersion: j?.versions?.obsidian,
    };
  } catch { return { ok: false, port: creds.port, error: `unparseable response (HTTP ${r.status})` }; }
}

export interface VaultHit { path: string; score: number; context: string }

/**
 * Obsidian's own lexical search. Deliberately NOT a replacement for brain recall — the brain
 * is semantic (MRR 0.877) and authoritative. This is the complementary lexical channel:
 * it finds exact strings and note-local context the embedding space blurs over.
 */
export async function vaultSearch(query: string, limit = 8, opts: RestOpts = {}): Promise<VaultHit[]> {
  const r = await obsidianRequest(
    `/search/simple/?query=${encodeURIComponent(query)}&contextLength=120`,
    { method: "POST" }, opts);
  if (!r || r.status !== 200) return [];
  try {
    const rows = JSON.parse(r.text);
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, limit).map((x: any) => ({
      path: String(x?.filename ?? ""),
      score: Number(x?.score ?? 0),
      context: String(x?.matches?.[0]?.context ?? "").replace(/\s+/g, " ").trim(),
    })).filter((h) => h.path);
  } catch { return []; }
}

export interface VaultNote {
  path: string;
  content: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  /** Resolved by Obsidian's link index — the filesystem cannot produce these. */
  links: string[];
  backlinks: string[];
}

export async function vaultRead(path: string, opts: RestOpts = {}): Promise<VaultNote | null> {
  const r = await obsidianRequest(`/vault/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { accept: "application/vnd.olrapi.note+json" } }, opts);
  if (!r || r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    return {
      path, content: String(j?.content ?? ""),
      tags: Array.isArray(j?.tags) ? j.tags.map(String) : [],
      frontmatter: j?.frontmatter && typeof j.frontmatter === "object" ? j.frontmatter : {},
      links: Array.isArray(j?.links) ? j.links.map(String) : [],
      backlinks: Array.isArray(j?.backlinks) ? j.backlinks.map(String) : [],
    };
  } catch { return null; }
}

export async function vaultList(dir = "", opts: RestOpts = {}): Promise<string[]> {
  const r = await obsidianRequest(`/vault/${dir ? dir.replace(/\/?$/, "/") : ""}`, {}, opts);
  if (!r || r.status !== 200) return [];
  try { const j = JSON.parse(r.text); return Array.isArray(j?.files) ? j.files.map(String) : []; }
  catch { return []; }
}

/**
 * Upstream registration for the MCP gateway (server/mcp/client.ts). The plugin runs a real MCP
 * server at /mcp/, so registering it turns the live vault into `mcp__obsidian__vault_read`
 * and friends — callable by every expert, not just by this module.
 * Returns null when the vault is unconfigured, so callers can skip it silently.
 */
export function obsidianUpstreamConfig(vault = defaultVault()): {
  name: string; transport: "http"; url: string; headers: Record<string, string>; ca: string;
} | null {
  const creds = readObsidianCreds(vault);
  if (!creds) return null;
  return {
    name: "obsidian",
    transport: "http",
    url: `https://127.0.0.1:${creds.port}/mcp/`,
    headers: { authorization: `Bearer ${creds.apiKey}` },
    ca: creds.ca,
  };
}

/** Reset memoized state — tests only. */
export function __resetObsidianRest(): void { dispatchers.clear(); warned = false; }
