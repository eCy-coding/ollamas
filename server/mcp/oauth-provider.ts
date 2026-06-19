// OAuth 2.1 Authorization Server provider (Faz 19, v1.10). Implements the SDK's
// OAuthServerProvider contract; the SDK's mcpAuthRouter mounts /authorize, /token
// and /revoke around it and performs PKCE S256 validation. We supply the storage +
// auto-consent policy only — no third-party OAuth lib, no hand-rolled crypto/flow.
//
// Tokens are OPAQUE (ot_…, SHA-256 stored — same one-way handling as api_keys).
// A client is bound to a tenant at DCR time (Faz 19B); authorize() auto-consents
// for a bound client (no login UI) and refuses an unbound one.
import type { Response } from "express";
import crypto from "node:crypto";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getClient, saveAuthCode, getAuthCode, consumeAuthCode, saveOAuthToken, resolveOAuthToken, revokeOAuthToken } from "../store";

const ACCESS_TTL_SECS = 3600;
const CODE_TTL_MS = 60_000;

export class OllamasOAuthProvider implements OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId): Promise<OAuthClientInformationFull | undefined> => {
        const c = await getClient(clientId);
        if (!c) return undefined;
        return {
          client_id: c.client_id,
          redirect_uris: c.redirect_uris,
          grant_types: c.grant_types,
          token_endpoint_auth_method: c.token_endpoint_auth_method,
        } as OAuthClientInformationFull;
      },
      // No registerClient → the router does NOT mount /register; ollamas keeps its
      // own tenant-aware DCR route (Faz 19B).
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const redirect = new URL(params.redirectUri);
    if (params.state) redirect.searchParams.set("state", params.state);
    const full = await getClient(client.client_id);
    if (!full?.tenant_id) {
      // Auto-consent is only possible for a tenant-bound client (Faz 19B).
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "client is not bound to a tenant");
      res.redirect(redirect.toString());
      return;
    }
    const code = `ac_${crypto.randomBytes(24).toString("hex")}`;
    await saveAuthCode({
      code, client_id: client.client_id, tenant_id: full.tenant_id,
      code_challenge: params.codeChallenge, redirect_uri: params.redirectUri,
      scopes: (params.scopes || []).join(" "),
      resource: params.resource ? params.resource.href : null,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
    redirect.searchParams.set("code", code);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const c = await getAuthCode(authorizationCode);
    if (!c) throw new Error("invalid authorization code");
    return c.code_challenge; // SDK compares SHA256(code_verifier) against this (S256)
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull, authorizationCode: string,
    _codeVerifier?: string, redirectUri?: string, resource?: URL
  ): Promise<OAuthTokens> {
    const c = await consumeAuthCode(authorizationCode); // one-time + expiry-gated
    if (!c) throw new Error("invalid_grant: code expired or already used");
    if (c.client_id !== client.client_id) throw new Error("invalid_grant: client mismatch");
    if (redirectUri && c.redirect_uri !== redirectUri) throw new Error("invalid_grant: redirect_uri mismatch");
    const token = await saveOAuthToken({
      client_id: c.client_id, tenant_id: c.tenant_id, scopes: c.scopes,
      resource: resource ? resource.href : c.resource, ttlSecs: ACCESS_TTL_SECS,
    });
    return { access_token: token, token_type: "bearer", expires_in: ACCESS_TTL_SECS, scope: c.scopes || undefined };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    // Refresh tokens are not issued in v1.10 (single short-lived access token).
    throw new Error("unsupported_grant_type: refresh tokens are not issued");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const r = await resolveOAuthToken(token);
    if (!r) throw new Error("invalid_token");
    return {
      token, clientId: r.clientId, scopes: r.scopes, expiresAt: r.expiresAt,
      resource: r.resource ? new URL(r.resource) : undefined,
      extra: { tenantId: r.tenantId },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    if (request.token) await revokeOAuthToken(request.token);
  }
}
