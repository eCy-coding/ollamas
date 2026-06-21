// Auth middleware (Faz 3 + 9B + 25). Resolves a Bearer / X-API-Key credential to a
// tenant + plan + scopes and attaches it as req.tenant. Paths:
//   1. Opaque API key (`olm_...`) → SHA-256 lookup in the SaaS store (always on).
//   2. Locally-issued opaque OAuth token (`ot_...`) → store lookup; when the token
//      carries a `resource` (RFC 8707 audience) it MUST match this resource server
//      or the token is rejected (Faz 25 — no cross-resource token reuse).
//   3. OAuth 2.1 Bearer JWT → verified via JWKS (jose) when OAUTH_ISSUER is set;
//      audience (RFC 8707) + scope claim enforced. Inert without OAUTH_ISSUER.
// Backward-compatible: with no credential, single-user localhost access continues
// (req.tenant undefined) unless `required` forces 401.

import type { Request, Response, NextFunction } from "express";
import { resolveKey, resolveOAuthToken, getTenant, getPlan, type ResolvedKey } from "../store";
import { resourceMetadataUrl } from "../mcp/oauth-metadata";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: ResolvedKey;
    }
  }
}

function extractKey(req: Request): string | undefined {
  const hdr = req.headers["authorization"];
  const m = typeof hdr === "string" ? hdr.match(/^Bearer\s+(.+)$/i) : null;
  if (m) return m[1].trim();
  const x = req.headers["x-api-key"];
  return typeof x === "string" ? x.trim() : undefined;
}

// Lazy JWKS — only constructed when OAuth is configured, so `jose` (and a network
// fetch to the IdP) never load in the API-key-only/offline path.
let jwksFn: any = null;
async function getJwks() {
  if (!jwksFn) {
    const { createRemoteJWKSet } = await import("jose");
    const uri = process.env.OAUTH_JWKS_URI
      || `${(process.env.OAUTH_ISSUER || "").replace(/\/$/, "")}/.well-known/jwks.json`;
    jwksFn = createRemoteJWKSet(new URL(uri));
  }
  return jwksFn;
}

/** Normalize a resource URI for RFC 8707 audience comparison: drop a trailing
 *  slash so `https://h/mcp` and `https://h/mcp/` compare equal. Non-URL → as-is. */
function canonicalResource(u: string): string {
  let s = u.trim();
  try { s = new URL(s).href; } catch { /* not an absolute URL — compare raw */ }
  return s.replace(/\/+$/, "");
}

/** Resolve a locally-issued opaque OAuth access token (`ot_`, Faz 19) → ResolvedKey.
 *  Mirrors the API-key path: token → tenant → plan, scopes from the token grant.
 *  Faz 25 (RFC 8707): when the token is bound to a `resource` (audience), it is
 *  rejected unless that resource matches `expectedResource` — a token minted for
 *  one MCP resource server cannot be replayed against another. A token with no
 *  resource is unrestricted (backward-compatible). */
async function resolveOAuth(token: string, expectedResource?: string): Promise<ResolvedKey | null> {
  const r = await resolveOAuthToken(token);
  if (!r) return null;
  if (r.resource && (!expectedResource || canonicalResource(r.resource) !== canonicalResource(expectedResource))) {
    return null; // audience mismatch → invalid_token
  }
  const tenant = await getTenant(r.tenantId);
  if (!tenant) return null;
  const plan = await getPlan(tenant.plan_id);
  if (!plan) return null;
  return { tenantId: tenant.id, keyId: `oauth:${r.clientId}`, plan, scopes: r.scopes };
}

/** Verify an OAuth JWT → ResolvedKey, or null. Maps `tenantId`/`sub` claim → tenant. */
async function verifyJwt(token: string, audience: string): Promise<ResolvedKey | null> {
  if (!process.env.OAUTH_ISSUER) return null;
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: process.env.OAUTH_ISSUER,
      audience: process.env.OAUTH_AUDIENCE || audience, // RFC 8707 resource binding
    });
    const tenantId = String((payload as any).tenantId || payload.sub || "");
    const tenant = tenantId ? await getTenant(tenantId) : null;
    if (!tenant) return null;
    const plan = await getPlan(tenant.plan_id);
    if (!plan) return null;
    const scopes = String((payload as any).scope || "").split(/\s+/).filter(Boolean);
    return { tenantId: tenant.id, keyId: `jwt:${payload.jti || "?"}`, plan, scopes };
  } catch {
    return null;
  }
}

/**
 * @param required when true, a missing OR invalid credential → 401. When false
 *   (default), a missing credential is allowed (single-user path) but a *present*
 *   invalid one is still rejected.
 */
export function authMiddleware(required = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const host = (typeof req.get === "function" ? req.get("host") : (req.headers?.host as string)) || "localhost";
    const base = `${req.protocol || "http"}://${host}`;
    const unauthorized = (msg: string) => {
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl(base)}"`);
      return res.status(401).json({ error: msg });
    };

    const key = extractKey(req);
    if (key) {
      // Opaque API keys: `olm_`. Locally-issued OAuth access tokens: `ot_` (Faz 19).
      // Everything else is treated as an external JWT (OAUTH_ISSUER path).
      const resolved = key.startsWith("olm_")
        ? await resolveKey(key)
        : key.startsWith("ot_")
          ? await resolveOAuth(key, process.env.OAUTH_AUDIENCE || `${base}/mcp`)
          : await verifyJwt(key, `${base}/mcp`);
      if (!resolved) return unauthorized("Invalid, expired, or unverifiable credential");
      req.tenant = resolved;
    } else if (required) {
      return unauthorized("Missing API key");
    }
    next();
  };
}
