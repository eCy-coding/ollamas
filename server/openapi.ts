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
      { name: "Ops", description: "Health, readiness, metrics, API docs" },
      { name: "AI", description: "Inference + STT facade (google.colab.ai-mirrored, programmatic consumers)" },
      { name: "Inference", description: "Local-owner generation, model listing, multi-role pipeline (loopback owner surface; 403 under SAAS_ENFORCE=1)" },
      { name: "Agent", description: "ReAct agent chat + session lifecycle (local-owner)" },
      { name: "Keys", description: "Provider API-key vault + pool + health (local-owner)" },
      { name: "Workspace", description: "Owner filesystem tree/file access (local-owner)" },
      { name: "Revenue", description: "Local-owner income tooling: Stripe checkout + config (no money movement)" },
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

      // v1.27.4 µ1 — kept public + doc routes (route-triage.md KEEP-PUBLIC). External/programmatic
      // consumers or the doc UI fetch these; there is no first-party frontend caller by design.
      "/.well-known/mcp.json": { get: { tags: ["MCP"], summary: "MCP discovery manifest (3rd-party MCP clients)", responses: ok("Manifest document") } },
      "/api/openapi.json": { get: { tags: ["Ops"], summary: "This OpenAPI 3.1 spec (JSON) — powers /api/docs + external tooling", responses: ok("OpenAPI 3.1 document") } },
      "/api/docs": { get: { tags: ["Ops"], summary: "Swagger UI — interactive API docs", responses: ok("HTML docs UI") } },
      "/api/ai/models": { get: { tags: ["AI"], summary: "List available AI models (mirrors google.colab.ai GET /api/ai/models)", responses: ok("Models") } },
      "/api/ai/transcribe": { post: { tags: ["AI"], summary: "Speech-to-text over raw audio bytes (mirrors google.colab.ai)", requestBody: { content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }, responses: { ...ok("Transcript"), "400": { description: "Missing/invalid audio payload" } } } },

      // v1.27.4 µ1 — privileged self-service routes (route-triage.md PRIVILEGED-KEEP). Auth surface;
      // 401 without a credential. Documented so the 401 contract + required scope are discoverable.
      "/api/saas/self/keys/{id}/revoke": { post: { tags: ["Self"], summary: "Revoke one of my keys (scope keys:write)", security: [{ ApiKey: [] }], responses: { ...ok("Revoked"), "401": { description: "Missing/invalid credential (WWW-Authenticate)" }, "403": { description: "insufficient_scope" } } } },
      "/api/saas/upstreams/status": { get: { tags: ["Self"], summary: "Health/status of my registered upstream MCP servers", security: [{ ApiKey: [] }], responses: { ...ok("Upstream status"), "401": { description: "Missing/invalid credential (WWW-Authenticate)" } } } },
      "/api/saas/webhooks/deliveries": { get: { tags: ["SaaS"], summary: "Recent webhook delivery attempts (tenant-scoped)", security: [{ ApiKey: [] }], responses: { ...ok("Deliveries"), "401": { description: "Missing/invalid credential (WWW-Authenticate)" } } } },

      // v1.29.4 batch1 — local-owner inference facade (loopback owner surface; 403 under
      // SAAS_ENFORCE=1). Real handlers in server.ts; documented for programmatic + doc-UI consumers.
      "/api/generate": { post: { tags: ["Inference"], summary: "Chat-style generation over messages[] (provider-routed; SSE when stream=true)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["messages"], properties: { provider: { type: "string" }, model: { type: "string" }, messages: { type: "array", items: { type: "object" } }, temperature: { type: "number" }, stream: { type: "boolean" }, privateMode: { type: "boolean" } } } } } }, responses: { "200": { description: "Generation result (JSON), or text/event-stream when stream=true", ...jsonObj }, "400": { description: "messages[] missing/empty (use /api/ai/generate for a prompt string)" }, "500": { description: "Execution engine failure" } } } },
      "/api/ai/generate": { post: { tags: ["Inference"], summary: "Single-prompt generation (Colab-style; SSE when stream=true)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, model: { type: "string" }, provider: { type: "string" }, temperature: { type: "number" }, stream: { type: "boolean" } } } } } }, responses: { "200": { description: "{ text, model, source, tokensPerSec }, or text/event-stream when stream=true", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, model: { type: "string" }, source: { type: "string" }, tokensPerSec: { type: "number" } } } } } }, "400": { description: "prompt (non-empty string) required" }, "500": { description: "generation failure" } } } },
      "/api/models/{provider}": { get: { tags: ["Inference"], summary: "List model IDs for a provider (8s cached; freeOnly filter)", parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" }, description: "e.g. ollama-local, ollama-cloud, openrouter, gemini" }, { name: "freeOnly", in: "query", required: false, schema: { type: "boolean" } }], responses: { "200": { description: "Array of model-id strings", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } } } },
      "/api/orchestra": { get: { tags: ["Inference"], summary: "Orchestra conductor live status + task/deps progress", responses: { "200": { description: "Conductor snapshot", content: { "application/json": { schema: { type: "object", properties: { ts: { type: "string" }, live: { type: "boolean" }, phase: { type: ["string", "null"] }, conductorModel: { type: ["string", "null"] }, preferredModel: { type: ["string", "null"] }, failoverCount: { type: "number" }, progress: { type: ["object", "null"] }, deps: { type: ["object", "null"] } } } } } } } } },
      "/api/pipeline": { post: { tags: ["Inference"], summary: "Architect→coder→reviewer multi-role pipeline (SSE progress stream)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, architectProvider: { type: "string" }, architectModel: { type: "string" }, coderProvider: { type: "string" }, coderModel: { type: "string" }, reviewerProvider: { type: "string" }, reviewerModel: { type: "string" }, enableSelfImprove: { type: "boolean" }, maxIterations: { type: "number" }, writePermissions: { type: "boolean" } } } } } }, responses: { "200": { description: "text/event-stream of { stage, status, text, tokensPerSec, elapsed }" }, "400": { description: "prompt (non-empty string) required" } } } },

      // v1.29.4 batch2 — ReAct agent chat + session lifecycle (local-owner).
      "/api/agent/chat": { post: { tags: ["Agent"], summary: "Run the ReAct agent loop over messages[] (SSE step stream; combination-defaulted model)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["messages"], properties: { messages: { type: "array", items: { type: "object" } }, provider: { type: "string" }, model: { type: "string" }, autoApply: { type: "boolean" }, maxSteps: { type: "integer", default: 8 }, sessionId: { type: "string" }, verify: { type: "boolean" } } } } } }, responses: { "200": { description: "text/event-stream of ReAct steps (thought/action/observation)" }, "400": { description: "messages[] missing/empty" } } } },
      "/api/agent/sessions": {
        get: { tags: ["Agent"], summary: "List saved agent sessions (id, title, provider/model, updatedAt)", responses: { "200": { description: "Session summaries", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, providerId: { type: "string" }, modelId: { type: "string" }, updatedAt: { type: "string" } } } } } } }, "500": { description: "Failed to fetch agent sessions" } } },
        post: { tags: ["Agent"], summary: "Create a new agent session", requestBody: { content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, providerId: { type: "string" }, modelId: { type: "string" } } } } } }, responses: { "200": { description: "Created session", ...jsonObj }, "500": { description: "Failed to create agent session" } } },
      },
      "/api/agent/sessions/{id}": {
        get: { tags: ["Agent"], summary: "Load one agent session (full message history)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Session", ...jsonObj }, "404": { description: "Agent session not found" } } },
        delete: { tags: ["Agent"], summary: "Delete an agent session", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "{ success, deleted }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, deleted: { type: "boolean" } } } } } } } },
      },
      "/api/agent/sessions/{id}/events": { get: { tags: ["Agent"], summary: "Live-tail a running agent session over SSE (replay ?after=<id>, read-only)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "after", in: "query", required: false, schema: { type: "integer", default: -1 } }], responses: { "200": { description: "text/event-stream of appended session steps" }, "404": { description: "Agent session not found" } } } },

      // v1.29.4 batch3 — provider API-key vault + pool (local-owner). Key VALUES are encrypted at
      // rest and never returned; responses are masked/boolean status only.
      "/api/keys": { post: { tags: ["Keys"], summary: "Set (or clear with key:\"\") a provider's vault key; encrypted at rest", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["provider"], properties: { provider: { type: "string" }, key: { type: "string", description: "empty string clears the key" }, customEndpoint: { type: "string" } } } } } }, responses: { "200": { description: "{ success: true }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } } } }, "400": { description: "Provider name required" } } } },
      "/api/keys/add": { post: { tags: ["Keys"], summary: "Append a rotation key to the provider's encrypted pool (grow, don't overwrite)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["provider", "key"], properties: { provider: { type: "string" }, key: { type: "string" } } } } } }, responses: { "200": { description: "{ success, poolSize }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, poolSize: { type: "integer" } } } } } }, "400": { description: "provider/key required" } } } },
      "/api/keys/test": { post: { tags: ["Keys"], summary: "Non-destructively validate a candidate provider+key (single-attempt, no vault write)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["provider"], properties: { provider: { type: "string" }, key: { type: "string" }, customEndpoint: { type: "string" } } } } } }, responses: { "200": { description: "{ success, latencyMs?, output? } or { success:false, error }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, latencyMs: { type: "number" }, output: { type: "string" }, error: { type: "string" } } } } } }, "400": { description: "provider required" } } } },
      "/api/keys/health": { get: { tags: ["Keys"], summary: "Cheap key-autonomy snapshot: per-provider live/cooled/absent + keyless set (cached; never exposes a key)", responses: ok("Key-health snapshot") } },
      "/api/keys/pool": { get: { tags: ["Keys"], summary: "Per-provider pool health (total/live/worstPct/saturation) + onboarding metadata + alerts", responses: { "200": { description: "{ pool, alerts }", content: { "application/json": { schema: { type: "object", properties: { pool: { type: "object" }, alerts: { type: "array", items: { type: "object" } } } } } } } } } },

      // v1.29.4 batch4 — local-owner revenue tooling + tenant-authenticated SaaS reads.
      "/api/revenue/checkout": { post: { tags: ["Revenue"], summary: "Create a Stripe Checkout URL for a verified audit (skipped without a Stripe key)", requestBody: { content: { "application/json": { schema: { type: "object", properties: { amount: { type: "number", description: "USD" }, description: { type: "string" } } } } } }, responses: { "200": { description: "{ ok, url } or { ok:false, skipped/reason }", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, url: { type: "string" }, skipped: { type: "boolean" }, reason: { type: "string" } } } } } }, "500": { description: "checkout failure" } } } },
      "/api/revenue/config": {
        get: { tags: ["Revenue"], summary: "Get local revenue-ops config", responses: { "200": { description: "Revenue config", ...jsonObj } } },
        post: { tags: ["Revenue"], summary: "Update local revenue-ops config", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "Updated config", ...jsonObj } } },
      },
      "/api/saas/catalog": { get: { tags: ["SaaS"], summary: "MCP upstream catalog decorated with this tenant's installed servers", security: [{ ApiKey: [] }], responses: { "200": { description: "Catalog entries", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } }, "401": { description: "Missing/invalid credential (WWW-Authenticate)" } } } },
      "/api/saas/usage": { get: { tags: ["SaaS"], summary: "This tenant's current-month usage summary (plan/quota/used)", security: [{ ApiKey: [] }], responses: { "200": { description: "Usage summary", content: { "application/json": { schema: { type: "object", properties: { tenantId: { type: "string" }, plan: { type: "string" }, monthlyQuota: { type: "number" }, used: { type: "number" } } } } } }, "401": { description: "Missing/invalid credential (WWW-Authenticate)" } } } },

      // v1.29.4 batch5 — owner workspace filesystem (local-owner; path-confined by resolveSafePath).
      "/api/workspace/tree": { get: { tags: ["Workspace"], summary: "Workspace file tree for the selected workspace path (+ current mode)", responses: { "200": { description: "Tree + mode", ...jsonObj }, "500": { description: "tree read failure" } } } },
      "/api/workspace/file": {
        get: { tags: ["Workspace"], summary: "Read a workspace file's text content", parameters: [{ name: "relativePath", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "{ content }", content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" } } } } } }, "400": { description: "relativePath query parameter required" }, "500": { description: "read failure" } } },
        post: { tags: ["Workspace"], summary: "Write text content to a workspace file", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["relativePath", "content"], properties: { relativePath: { type: "string" }, content: { type: "string" } } } } } }, responses: { "200": { description: "{ success: true }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } } } }, "400": { description: "relativePath + content (strings) required" }, "500": { description: "write failure" } } },
        delete: { tags: ["Workspace"], summary: "Delete a workspace file", parameters: [{ name: "relativePath", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "{ success: true }", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } } } }, "400": { description: "relativePath query parameter required" }, "500": { description: "delete failure" } } },
      },
    },
  },
  apis: ["./server.ts", "./server/**/*.ts"],
});
