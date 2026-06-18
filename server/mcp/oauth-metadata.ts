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

/** Absolute URL of the resource-metadata document, for the WWW-Authenticate hint. */
export function resourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${PROTECTED_RESOURCE_PATH}`;
}

/** RFC 9728 metadata body. `baseUrl` is this server's externally-reachable origin. */
export function buildResourceMetadata(baseUrl: string): Record<string, unknown> {
  const resource = `${baseUrl.replace(/\/$/, "")}/mcp`;
  const authServers = (process.env.OAUTH_AUTH_SERVERS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    resource,
    bearer_methods_supported: ["header"],
    // ollamas issues opaque API keys (see /api/saas/keys); no token endpoint.
    "x-ollamas-token-type": "opaque-api-key",
  };
  if (authServers.length) body.authorization_servers = authServers;
  return body;
}
