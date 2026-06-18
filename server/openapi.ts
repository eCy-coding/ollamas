// OpenAPI 3.1 spec for the ollamas SaaS gateway (Faz 10C). Built with swagger-jsdoc;
// core paths are defined inline (robust, no file-scan fragility), and any future
// `@openapi` JSDoc annotations in server.ts are merged in via `apis`.

import swaggerJsdoc from "swagger-jsdoc";

const ok = (desc: string) => ({ "200": { description: desc } });
const jsonObj = { content: { "application/json": { schema: { type: "object" } } } };

export const openApiSpec = swaggerJsdoc({
  definition: {
    openapi: "3.1.0",
    info: {
      title: "ollamas — MCP Gateway + tools-as-SaaS",
      version: "1.1.0",
      description: "MCP gateway that exposes/consumes tools with multi-tenant API-key auth, rate-limiting, usage metering, and Stripe billing. Bearer `olm_<key>` or OAuth JWT.",
    },
    servers: [{ url: "/", description: "this gateway" }],
    components: {
      securitySchemes: {
        ApiKey: { type: "http", scheme: "bearer", description: "Opaque key `olm_...` or OAuth JWT" },
        AdminToken: { type: "apiKey", in: "header", name: "x-admin-token" },
      },
    },
    tags: [
      { name: "MCP", description: "Model Context Protocol gateway" },
      { name: "SaaS", description: "Tenant + key administration" },
      { name: "Self", description: "Tenant self-service (scoped)" },
      { name: "Billing", description: "Stripe billing + usage" },
      { name: "Ops", description: "Health, readiness, metrics" },
    ],
    paths: {
      "/mcp": { post: { tags: ["MCP"], summary: "MCP Streamable HTTP endpoint (JSON-RPC: tools/list, tools/call, resources/list, resources/read)", security: [{ ApiKey: [] }], responses: { "200": { description: "MCP JSON-RPC response" }, "401": { description: "Missing/invalid credential (WWW-Authenticate)" }, "403": { description: "Origin not allowed" } } } },
      "/.well-known/oauth-protected-resource": { get: { tags: ["MCP"], summary: "RFC 9728 protected-resource metadata", responses: ok("Metadata document") } },
      "/api/mcp/upstreams": { get: { tags: ["MCP"], summary: "Gateway status: exposed tools + tiers + upstreams", responses: ok("Status") } },
      "/api/saas/plans": { get: { tags: ["SaaS"], summary: "List plans", security: [{ AdminToken: [] }], responses: ok("Plans") } },
      "/api/saas/tenants": {
        get: { tags: ["SaaS"], summary: "List tenants", security: [{ AdminToken: [] }], responses: ok("Tenants") },
        post: { tags: ["SaaS"], summary: "Create tenant", security: [{ AdminToken: [] }], requestBody: jsonObj, responses: ok("Tenant") },
      },
      "/api/saas/keys": { post: { tags: ["SaaS"], summary: "Issue API key (plaintext returned once)", security: [{ AdminToken: [] }], requestBody: jsonObj, responses: ok("Key") } },
      "/api/saas/audit": { get: { tags: ["SaaS"], summary: "Recent host/privileged/upstream tool-call audit", security: [{ AdminToken: [] }], responses: ok("Audit events") } },
      "/api/saas/upstreams": {
        get: { tags: ["Self"], summary: "List my upstream MCP servers", security: [{ ApiKey: [] }], responses: ok("Upstreams") },
        post: { tags: ["Self"], summary: "Register an upstream MCP server", security: [{ ApiKey: [] }], requestBody: jsonObj, responses: ok("Connected") },
      },
      "/api/saas/self/usage": { get: { tags: ["Self"], summary: "My usage + quota (scope usage:read)", security: [{ ApiKey: [] }], responses: { ...ok("Usage"), "403": { description: "insufficient_scope" } } } },
      "/api/saas/usage/timeseries": { get: { tags: ["Self"], summary: "My daily usage timeseries (scope usage:read)", security: [{ ApiKey: [] }], responses: ok("Series") } },
      "/api/saas/self/keys": {
        get: { tags: ["Self"], summary: "List my keys (scope keys:read)", security: [{ ApiKey: [] }], responses: ok("Keys") },
        post: { tags: ["Self"], summary: "Issue my own key (scope keys:write)", security: [{ ApiKey: [] }], requestBody: jsonObj, responses: ok("Key") },
      },
      "/api/billing/preview": { get: { tags: ["Billing"], summary: "Billing preview (dry-run without Stripe key)", security: [{ AdminToken: [] }], responses: ok("Run") } },
      "/api/billing/portal": { post: { tags: ["Billing"], summary: "Stripe Customer Portal session (501 without key)", security: [{ ApiKey: [] }], responses: { ...ok("url"), "501": { description: "Billing not configured" } } } },
      "/api/billing/checkout": { post: { tags: ["Billing"], summary: "Stripe Checkout session (501 without key)", security: [{ ApiKey: [] }], responses: ok("url") } },
      "/api/billing/webhook": { post: { tags: ["Billing"], summary: "Stripe webhook (signature-verified)", responses: ok("Handled") } },
      "/api/health": { get: { tags: ["Ops"], summary: "Liveness + telemetry", responses: ok("Health") } },
      "/api/ready": { get: { tags: ["Ops"], summary: "Readiness probe", responses: { ...ok("Ready"), "503": { description: "Not ready" } } } },
      "/metrics": { get: { tags: ["Ops"], summary: "Prometheus metrics", responses: ok("Metrics text") } },
    },
  },
  apis: ["./server.ts", "./server/**/*.ts"],
});
