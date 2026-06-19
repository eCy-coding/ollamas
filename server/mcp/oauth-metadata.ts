// RFC 9728 — OAuth 2.0 Protected Resource Metadata (AGENTS.md Faz 6A).
// The MCP Authorization spec (2025-06-18) has clients discover how to authenticate
// by reading /.well-known/oauth-protected-resource (pointed to by the
// WWW-Authenticate header on a 401). ollamas authenticates with opaque API keys
// rather than running a full OAuth 2.1 authorization server, so we advertise the
// resource + bearer method here; OAUTH_AUTH_SERVERS (CSV) lets a deployment point
// at real authorization servers if/when one is added (backlog).
//
// Refs: https://www.rfc-editor.org/rfc/rfc9728 ·
// https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
// RFC 8414 Authorization Server Metadata + RFC 7591 Dynamic Client Registration
// (Faz 15B). RFC 7591 clients discover the registration_endpoint by reading the
// AS metadata document, so we advertise both here.
export const AUTH_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
export const REGISTRATION_PATH = "/register";

/** Absolute URL of the resource-metadata document, for the WWW-Authenticate hint. */
export function resourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${PROTECTED_RESOURCE_PATH}`;
}

/** RFC 9728 metadata body. `baseUrl` is this server's externally-reachable origin. */
export function buildResourceMetadata(baseUrl: string): Record<string, unknown> {
  const base = baseUrl.replace(/\/$/, "");
  const authServers = (process.env.OAUTH_AUTH_SERVERS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  // Point clients at this server's own AS metadata when no external AS is set, so
  // RFC 7591 Dynamic Client Registration is discoverable out of the box.
  if (!authServers.length) authServers.push(base);
  const body: Record<string, unknown> = {
    resource: `${base}/mcp`,
    bearer_methods_supported: ["header"],
    authorization_servers: authServers,
    // ollamas issues opaque API keys (see /api/saas/keys); no token endpoint yet.
    "x-ollamas-token-type": "opaque-api-key",
  };
  return body;
}

/** RFC 8414 Authorization Server Metadata. ollamas does not yet run a full OAuth
 *  2.1 authorization server (token issuance → backlog); this advertises the DCR
 *  registration_endpoint so clients can register a client_id without manual setup. */
export function buildAuthServerMetadata(baseUrl: string): Record<string, unknown> {
  const base = baseUrl.replace(/\/$/, "");
  return {
    issuer: base,
    registration_endpoint: `${base}${REGISTRATION_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    // No authorization/token endpoint yet (full AS is backlog); DCR only.
    "x-ollamas-dcr-only": true,
  };
}
