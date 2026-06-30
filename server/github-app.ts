// GitHub App auth + Checks API (zero-dep — node:crypto for RS256 JWT + HMAC). The Checks API is
// App-only, so the per-PR pass/fail audit tier needs an App (not a PAT). App creds live in the
// AES-256-GCM vault; everything degrades gracefully (skip-with-reason) when they are absent.
// Choke-point-safe: server-side only.
import crypto from "node:crypto";
import { db } from "./db";

const GH_API = "https://api.github.com";
const GH_HEADERS = (auth: string): Record<string, string> => ({
  Authorization: `Bearer ${auth}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ollamas-audit-service",
  "Content-Type": "application/json",
});

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Pure: build + RS256-sign a GitHub App JWT (iss=appId, iat=-60s clock-skew, 10-min exp).
 *  Throws on an invalid private key — callers surface it as a graceful error. */
export function buildAppJwt(appId: string, privateKeyPem: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 600, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${sig}`;
}

/** Pure: verify a GitHub webhook signature (header "sha256=<hex>") over the RAW body, constant-time. */
export function verifyWebhookSignature(secret: string, rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface AppCreds {
  appId: string;
  privateKey: string;
  installationId: string;
  webhookSecret: string;
}

/** Read the App creds from the vault (operator pastes them after registering the App). */
export function getAppCreds(): AppCreds | null {
  const keys = (db.data.keys || {}) as Record<string, string>;
  const appId = db.decrypt(keys["github-app-id"] || "");
  const privateKey = db.decrypt(keys["github-app-key"] || "");
  const installationId = db.decrypt(keys["github-app-installation"] || "");
  if (!appId || !privateKey || !installationId) return null;
  return { appId, privateKey, installationId, webhookSecret: db.decrypt(keys["github-webhook-secret"] || "") };
}

let tokenCache: { token: string; exp: number } | null = null;
export function _resetAppTokenCache(): void {
  tokenCache = null;
}

/** Exchange the App JWT for a short-lived installation access token (cached to ~expiry). */
export async function getInstallationToken(creds: AppCreds, nowSec: number): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (tokenCache && tokenCache.exp - 60 > nowSec) return { ok: true, token: tokenCache.token };
  let jwt: string;
  try {
    jwt = buildAppJwt(creds.appId, creds.privateKey, nowSec);
  } catch (e) {
    return { ok: false, error: `bad App private key: ${(e as Error).message}` };
  }
  try {
    const res = await fetch(`${GH_API}/app/installations/${creds.installationId}/access_tokens`, {
      method: "POST",
      headers: GH_HEADERS(jwt),
    });
    const text = await res.text();
    let data: { token?: string; expires_at?: string; message?: string } = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, error: `GitHub ${res.status}: ${data.message || text.slice(0, 160)}` };
    // Validate before caching — a 200 without token/expires_at must not yield `Bearer undefined` + NaN exp.
    const expMs = data.expires_at ? new Date(data.expires_at).getTime() : NaN;
    if (!data.token || Number.isNaN(expMs)) return { ok: false, error: "GitHub returned no usable installation token" };
    tokenCache = { token: data.token, exp: Math.floor(expMs / 1000) };
    return { ok: true, token: data.token };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}

/** Post a Check run (pass/fail) on a commit — requires an installation token (App auth). */
export async function createCheckRun(
  owner: string,
  repo: string,
  token: string,
  input: { headSha: string; conclusion: "success" | "failure" | "neutral"; title: string; summary: string },
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}/check-runs`, {
      method: "POST",
      headers: GH_HEADERS(token),
      body: JSON.stringify({
        name: "ollamas audit",
        head_sha: input.headSha,
        status: "completed",
        conclusion: input.conclusion,
        output: { title: input.title, summary: input.summary },
      }),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) return { ok: false, error: `GitHub ${res.status}: ${data.message || text.slice(0, 160)}` };
    return { ok: true, url: data.html_url };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}
