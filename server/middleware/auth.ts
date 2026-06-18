// API-key auth middleware (AGENTS.md Faz 3). Resolves a Bearer / X-API-Key token
// to a tenant + plan and attaches it as req.tenant. The gateway stays
// backward-compatible: with no key, single-user localhost access continues
// (req.tenant stays undefined) unless `required` forces 401.

import type { Request, Response, NextFunction } from "express";
import { resolveKey, type ResolvedKey } from "../store";
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

/**
 * @param required when true, a missing OR invalid key → 401. When false
 *   (default), a missing key is allowed (single-user path) but a *present*
 *   invalid key is still rejected.
 */
export function authMiddleware(required = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // RFC 9728: point unauthenticated clients at the resource-metadata document
    // so standard MCP clients can discover how to authenticate.
    const unauthorized = (msg: string) => {
      const host = (typeof req.get === "function" ? req.get("host") : (req.headers?.host as string)) || "localhost";
      const base = `${req.protocol || "http"}://${host}`;
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl(base)}"`);
      return res.status(401).json({ error: msg });
    };
    const key = extractKey(req);
    if (key) {
      const resolved = resolveKey(key);
      if (!resolved) return unauthorized("Invalid or revoked API key");
      req.tenant = resolved;
    } else if (required) {
      return unauthorized("Missing API key");
    }
    next();
  };
}
