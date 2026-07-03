// 0-manual GitHub connect (dalga-11). The owner is almost always already
// authenticated to GitHub via the `gh` CLI; pull that token into the encrypted
// vault so every GitHub feature (Actions writes, code search, job logs,
// dispatch, Search-Standard 30/min) lights up without pasting a PAT.
//
// Same trust model as server/key-doctor.ts: local-owner only, execFile with NO
// shell, encrypted at rest, and the token is NEVER returned or logged.
import { execFile } from "node:child_process";
import { db } from "./db";

export type ExecTokenFn = () => Promise<string>;
const defaultGhToken: ExecTokenFn = () =>
  new Promise((resolve) => execFile("gh", ["auth", "token"], { timeout: 5000 }, (err, stdout) => resolve(err ? "" : String(stdout).trim())));

const defaultGhScopes: ExecTokenFn = () =>
  new Promise((resolve) => execFile("gh", ["auth", "status"], { timeout: 5000 }, (err, stdout, stderr) => resolve(err ? "" : String(stdout || stderr))));

/** A GitHub token is gho_ (OAuth/gh-cli) or ghp_ (PAT), base62, ≥36 chars after the prefix. */
export function parseGhToken(raw: string): string | null {
  const t = (raw || "").trim();
  return /^gh[po]_[A-Za-z0-9]{36,}$/.test(t) ? t : null;
}

// Extract the "Token scopes: 'a', 'b'" line from `gh auth status` output.
export function parseScopes(statusOut: string): string[] {
  const line = statusOut.match(/Token scopes:\s*(.+)/i)?.[1];
  if (!line) return [];
  const toks = line.match(/[a-z:_]+/gi);
  return toks ? toks.filter((s) => s.length > 1) : [];
}

export interface AutoConnectResult { ok: boolean; source?: string; scopes?: string[]; hint?: string; last4?: string }

/** Read the gh CLI token and store it as the `github` vault key. Idempotent. */
export async function autoconnectGitHub(readToken: ExecTokenFn = defaultGhToken, readStatus: ExecTokenFn = defaultGhScopes): Promise<AutoConnectResult> {
  const token = parseGhToken(await readToken());
  if (!token) return { ok: false, hint: "gh CLI'da oturum yok — `gh auth login` çalıştır, veya bir PAT yapıştır." };
  db.data.keys = db.data.keys || {};
  db.data.keys["github"] = db.encrypt(token);
  db.save();
  const scopes = parseScopes(await readStatus().catch(() => ""));
  return { ok: true, source: "gh-cli", scopes, last4: token.slice(-4) }; // token itself never leaves
}
