// Thin gateway client. The CLI is a HTTP/MCP client ONLY — it never imports
// ToolRegistry. Every tool side effect goes through the gateway's single
// choke-point (AGENTS.md §4). This file holds no dispatch logic.
import type { DoctorReport } from "./output";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamMeta {
  source?: string;
  latencyMs?: number;
  tokensPerSec?: number;
}

// Split an accumulating SSE buffer into complete events + remainder.
// Pure → unit-testable without a socket. Each event is the parsed `data:` JSON.
export function parseSSEBuffer(buffer: string): { events: any[]; rest: string } {
  const events: any[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
  return { events, rest };
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly adminToken?: string;

  constructor(baseUrl: string, apiKey?: string, adminToken?: string) {
    // Normalize: drop trailing slashes so `${base}/api/x` never doubles up (G3).
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.adminToken = adminToken;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  // Admin-scoped headers carry X-Admin-Token (adminGuard, server.ts:1323).
  private adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h = this.headers(extra);
    if (this.adminToken) h["X-Admin-Token"] = this.adminToken;
    return h;
  }

  hasAdminToken(): boolean {
    return !!this.adminToken;
  }

  async health(timeoutMs = 8000): Promise<any> {
    const r = await fetch(`${this.baseUrl}/api/health`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`gateway /api/health → ${r.status}`);
    return r.json();
  }

  async ready(timeoutMs = 5000): Promise<any> {
    const r = await fetch(`${this.baseUrl}/api/ready`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json().catch(() => ({}));
  }

  // Stream a one-shot generation. Calls onChunk per token; resolves with final meta.
  async generateStream(
    messages: ChatMessage[],
    opts: { provider?: string; model?: string; temperature?: number; timeoutMs?: number },
    onChunk: (text: string) => void,
  ): Promise<StreamMeta> {
    const { timeoutMs, ...gen } = opts;
    const r = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...gen, messages, stream: true }),
      signal: AbortSignal.timeout(timeoutMs ?? 120_000), // G4: cap hangs
    });
    if (!r.ok || !r.body) throw new Error(`gateway /api/generate → ${r.status}`);

    let meta: StreamMeta = {};
    await consumeSSE(r.body, (ev) => {
      if (ev.error) throw new Error(String(ev.error));
      if (typeof ev.chunk === "string") onChunk(ev.chunk);
      if (ev.done) meta = { source: ev.source, latencyMs: ev.latencyMs, tokensPerSec: ev.tokensPerSec };
    });
    return meta;
  }

  // Drive the ReAct agent loop. Forwards every SSE event to onEvent; resolves
  // with the terminal status and any pending write awaiting approval.
  async agentStream(
    messages: ChatMessage[],
    opts: AgentOpts,
    onEvent: (ev: AgentEvent) => void,
  ): Promise<AgentResult> {
    const { timeoutMs, ...body } = opts;
    const r = await fetch(`${this.baseUrl}/api/agent/chat`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...body, messages }),
      signal: AbortSignal.timeout(timeoutMs ?? 300_000),
    });
    if (!r.ok || !r.body) throw new Error(`gateway /api/agent/chat → ${r.status}`);

    const result: AgentResult = { status: "incomplete", history: [...messages] };
    let lastWrite: { path: string; content: string; diff: string } | undefined;

    await consumeSSE(r.body, (ev: AgentEvent) => {
      onEvent(ev);
      // Track the most recent write_file proposal so a `paused` event can resume it.
      if (ev.type === "step" && /write_file/i.test(ev.tool || "") && ev.args && ev.applied === false) {
        lastWrite = { path: ev.args.path, content: ev.args.content, diff: ev.diff || "" };
      }
      if (ev.type === "message" && ev.text) result.history.push({ role: "assistant", content: ev.text });
      if (ev.type === "paused") { result.status = "paused"; result.pending = lastWrite; }
      if (ev.type === "done") result.status = ev.status === "limit" ? "limit" : "complete";
      if (ev.type === "error") throw new Error(String(ev.message || "agent loop failure"));
    });
    return result;
  }

  async approveWrite(path: string, content: string, timeoutMs = 30_000): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/agent/approve-write`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ path, content }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`gateway /api/agent/approve-write → ${r.status}`);
  }

  async listSessions(): Promise<AgentSession[]> {
    return this.getJson("/api/agent/sessions");
  }
  async getSession(id: string): Promise<AgentSession> {
    return this.getJson(`/api/agent/sessions/${encodeURIComponent(id)}`);
  }
  async createSession(body: { title?: string; providerId?: string; modelId?: string }): Promise<AgentSession> {
    const r = await fetch(`${this.baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`gateway POST /api/agent/sessions → ${r.status}`);
    return r.json();
  }
  async deleteSession(id: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/agent/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`gateway DELETE /api/agent/sessions → ${r.status}`);
  }

  private async getJson(path: string): Promise<any> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`gateway ${path} → ${r.status}`);
    return r.json();
  }

  // --- SaaS / billing admin surface (v3) — all behind adminGuard (X-Admin-Token).

  listPlans(): Promise<Plan[]> {
    return this.adminGet("/api/saas/plans");
  }
  listTenants(): Promise<Tenant[]> {
    return this.adminGet("/api/saas/tenants");
  }
  listKeys(tenantId: string): Promise<ApiKeyMeta[]> {
    return this.adminGet(`/api/saas/keys?tenantId=${encodeURIComponent(tenantId)}`);
  }
  listAudit(opts: { tenantId?: string; limit?: number } = {}): Promise<any[]> {
    const q = new URLSearchParams();
    if (opts.tenantId) q.set("tenantId", opts.tenantId);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.adminGet(`/api/saas/audit${qs ? `?${qs}` : ""}`);
  }
  createTenant(body: { name: string; plan?: string; stripeCustomerId?: string }): Promise<Tenant> {
    return this.adminPost("/api/saas/tenants", body);
  }
  // Returns the plaintext key ONCE (olm_…). Caller must surface + warn; never log.
  createKey(body: { tenantId: string; label?: string; ttlDays?: number; scopes?: string }): Promise<NewApiKey> {
    return this.adminPost("/api/saas/keys", body);
  }
  revokeKey(id: string): Promise<{ revoked: string }> {
    return this.adminPost(`/api/saas/keys/${encodeURIComponent(id)}/revoke`, {});
  }
  billingPreview(period?: string): Promise<BillingReport> {
    return this.adminGet(`/api/billing/preview${period ? `?period=${encodeURIComponent(period)}` : ""}`);
  }
  billingRun(period?: string): Promise<BillingReport> {
    return this.adminPost("/api/billing/run", period ? { period } : {});
  }

  private async adminGet(path: string): Promise<any> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      headers: this.adminHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(adminError(path, r.status));
    return r.json();
  }
  private async adminPost(path: string, body: any): Promise<any> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(adminError(path, r.status));
    return r.json();
  }
}

// adminGuard rejects with 401 (bad token) / 403 (enforce on, no token). Map to
// an actionable hint instead of a bare status (H3).
function adminError(path: string, status: number): string {
  const base = `gateway ${path} → ${status}`;
  if (status === 401 || status === 403) {
    return `${base}\n  hint: admin auth — set OLLAMAS_SAAS_ADMIN or 'ollamas config saasAdminToken <token>' (gateway SAAS_ADMIN_TOKEN)`;
  }
  return base;
}

export interface Plan {
  id: string;
  name: string;
  rate_per_min?: number;
  monthly_quota?: number;
  allowed_tiers?: string;
}
export interface Tenant {
  id: string;
  name: string;
  plan_id?: string;
  stripe_customer_id?: string | null;
  created_at?: string;
}
export interface ApiKeyMeta {
  id: string;
  label?: string;
  revoked?: number | string;
  scopes?: string;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_at?: string;
}
export interface NewApiKey {
  id: string;
  key: string;
  expiresAt: string | null;
}
export interface BillingLine {
  tenantId: string;
  calls: number;
  okCalls: number;
  tokens: number;
  latencyMs: number;
  amount: number;
}
export interface BillingReport {
  period: string;
  dryRun: boolean;
  lines: BillingLine[];
  total: number;
}

export interface AgentOpts {
  provider?: string;
  model?: string;
  autoApply?: boolean;
  maxSteps?: number;
  sessionId?: string;
  timeoutMs?: number;
}

// Discriminated-ish union over the server's SSE event types (server.ts:555-733).
export interface AgentEvent {
  type: "thought" | "message" | "step" | "paused" | "done" | "error";
  text?: string;
  step?: number;
  stepNum?: number;
  tool?: string;
  args?: any;
  ok?: boolean;
  latency?: number;
  result?: any;
  diff?: string;
  applied?: boolean;
  status?: string;
  message?: string;
  toolCalls?: any[];
}

export interface AgentResult {
  status: "complete" | "limit" | "paused" | "incomplete";
  history: ChatMessage[];
  pending?: { path: string; content: string; diff: string };
}

export interface AgentSession {
  id: string;
  title: string;
  providerId?: string;
  modelId?: string;
  updatedAt?: string;
  messages?: any[];
}

// Read a web ReadableStream of SSE bytes, dispatching each parsed event.
async function consumeSSE(body: ReadableStream<Uint8Array>, onEvent: (ev: any) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSSEBuffer(buffer);
    buffer = parsed.rest;
    for (const ev of parsed.events) onEvent(ev);
  }
}

// Probe ollama + bridge directly for the doctor command. Gateway already
// reports ollama, but probing the source is more honest about a degraded stack.
export async function buildDoctorReport(
  client: GatewayClient,
  ollamaHost: string,
  nowIso: string,
): Promise<DoctorReport> {
  const gateway = await safeProbe(() => client.health());
  const ollama = await safeProbe(async () => {
    const r = await fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
  const bridge = await safeProbe(async () => {
    const r = await fetch("http://127.0.0.1:7345/health", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
  const ready = await safeProbe(() => client.ready());
  const agent = await safeProbe(() => client.listSessions());
  // SaaS probe only when an admin token is configured; otherwise report skipped
  // (don't gate overall health on it).
  const saas = client.hasAdminToken() ? await safeProbe(() => client.listPlans()) : null;

  return {
    ts: nowIso,
    healthy: gateway.ok && ollama.ok && ready.ok,
    gateway: { ok: gateway.ok, detail: gateway.ok ? `mode=${gateway.value?.mode ?? "?"}` : gateway.error },
    ollama: { ok: ollama.ok, detail: ollama.ok ? `v${ollama.value?.version ?? "?"}` : ollama.error },
    bridge: { ok: bridge.ok, detail: bridge.ok ? `terminals=${countOf(bridge.value?.terminals)}` : "not running (macOS-only)" },
    ready: { ok: ready.ok, detail: ready.ok ? "ready" : ready.error },
    agent: { ok: agent.ok, detail: agent.ok ? `sessions=${countOf(agent.value)}` : agent.error },
    saas: saas ? { ok: saas.ok, detail: saas.ok ? `plans=${countOf(saas.value)}` : saas.error } : { ok: true, detail: "skipped (no admin token)" },
  };
}

// Collapse an unknown terminals payload (array | object | scalar) to a count.
function countOf(v: unknown): number | string {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  return v == null ? "?" : String(v);
}

async function safeProbe<T>(fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error: string }> {
  try {
    return { ok: true, value: await fn(), error: "" };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
