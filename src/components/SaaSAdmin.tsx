import React, { useEffect, useState } from "react";
import { Building2, KeyRound, Gauge, Receipt, Network, Plus, Trash2, RefreshCw, Copy, ShieldAlert } from "lucide-react";

interface Props {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

interface Plan { id: string; name: string; rate_per_min: number; monthly_quota: number; allowed_tiers: string[]; }
interface Tenant { id: string; name: string; plan_id: string; stripe_customer_id?: string | null; created_at: string; }
interface KeyMeta { id: string; label: string; revoked: number; created_at: string; }

// SaaS control plane: provision tenants + API keys, inspect usage, preview billing,
// and read the MCP gateway status. Admin token (X-Admin-Token) is required when the
// server runs with SAAS_ENFORCE=1; stored locally for convenience.
export const SaaSAdmin: React.FC<Props> = ({ onNotify }) => {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem("saasAdminToken") || "");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [keys, setKeys] = useState<KeyMeta[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [gateway, setGateway] = useState<any>(null);
  const [billing, setBilling] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [newName, setNewName] = useState("");
  const [newPlan, setNewPlan] = useState("free");
  const [freshKey, setFreshKey] = useState<string>("");

  // Self-service (tenant key): usage chart, webhooks, upstreams, billing portal.
  const [tenantKey, setTenantKey] = useState<string>(() => localStorage.getItem("saasTenantKey") || "");
  const [selfUsage, setSelfUsage] = useState<any>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [upstreams, setUpstreams] = useState<any[]>([]);
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState("key.created,usage.quota_exceeded");

  // SaaSAdmin keeps a local token-scoped wrapper; consolidation tracked for a later vF.
  const hdr = () => ({ "Content-Type": "application/json", "x-admin-token": adminToken });
  const thdr = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tenantKey}` });
  const tapi = async (p: string, init?: RequestInit) => {
    const r = await fetch(p, { ...init, headers: { ...thdr(), ...(init?.headers || {}) } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
    return r.json();
  };
  const loadSelf = async () => {
    if (!tenantKey) return;
    localStorage.setItem("saasTenantKey", tenantKey);
    try {
      setSelfUsage(await tapi("/api/saas/self/usage"));
      setSeries((await tapi("/api/saas/usage/timeseries")).series || []);
      setWebhooks(await tapi("/api/saas/webhooks"));
      setUpstreams(await tapi("/api/saas/upstreams"));
    } catch (e: any) { onNotify(`Self-service: ${e.message} (key needs usage:read scope)`, "error"); }
  };
  const addHook = async () => {
    try {
      const r = await tapi("/api/saas/webhooks", { method: "POST", body: JSON.stringify({ url: whUrl, events: whEvents.split(",").map(s => s.trim()).filter(Boolean) }) });
      onNotify(`Webhook created — secret (once): ${r.secret.slice(0, 16)}…`, "success"); copy(r.secret); setWhUrl(""); loadSelf();
    } catch (e: any) { onNotify(e.message, "error"); }
  };
  const delHook = async (id: string) => { try { await tapi(`/api/saas/webhooks/${id}`, { method: "DELETE" }); loadSelf(); } catch (e: any) { onNotify(e.message, "error"); } };
  const openPortal = async () => {
    try { const r = await tapi("/api/billing/portal", { method: "POST", body: "{}" }); if (r.url) window.open(r.url, "_blank"); }
    catch (e: any) { onNotify(`Portal: ${e.message}`, "error"); }
  };

  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...hdr(), ...(init?.headers || {}) } });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `${res.status} ${path}`);
    }
    return res.json();
  };

  const refresh = async () => {
    try {
      setPlans(await api("/api/saas/plans"));
      setTenants(await api("/api/saas/tenants"));
      setGateway(await (await fetch("/api/mcp/upstreams")).json());
      setAudit(await api("/api/saas/audit?limit=10"));
    } catch (e: any) {
      onNotify(`SaaS admin: ${e.message}`, "error");
    }
  };

  useEffect(() => { if (adminToken !== "") localStorage.setItem("saasAdminToken", adminToken); }, [adminToken]);
  // Only auto-load when a token is already present (avoids a spurious 401 toast on
  // first mount before the operator types the admin token, Faz 9F).
  useEffect(() => { if (adminToken) refresh(); }, []);

  const loadTenant = async (t: Tenant) => {
    setSelected(t); setFreshKey(""); setUsage(null);
    try { setKeys(await api(`/api/saas/keys?tenantId=${encodeURIComponent(t.id)}`)); } catch (e: any) { onNotify(e.message, "error"); }
  };

  const createTenant = async () => {
    if (!newName.trim()) return onNotify("Tenant name required", "error");
    try {
      await api("/api/saas/tenants", { method: "POST", body: JSON.stringify({ name: newName.trim(), plan: newPlan }) });
      setNewName(""); onNotify(`Tenant '${newName}' created`, "success"); refresh();
    } catch (e: any) { onNotify(e.message, "error"); }
  };

  const issueKey = async () => {
    if (!selected) return;
    try {
      const r = await api("/api/saas/keys", { method: "POST", body: JSON.stringify({ tenantId: selected.id }) });
      setFreshKey(r.key); onNotify("API key issued — copy it now, shown once", "success"); loadTenant(selected);
    } catch (e: any) { onNotify(e.message, "error"); }
  };

  const revokeKey = async (id: string) => {
    try { await api(`/api/saas/keys/${id}/revoke`, { method: "POST", body: "{}" }); onNotify("Key revoked", "info"); if (selected) loadTenant(selected); }
    catch (e: any) { onNotify(e.message, "error"); }
  };

  const previewBilling = async () => {
    try { setBilling(await api("/api/billing/preview")); } catch (e: any) { onNotify(e.message, "error"); }
  };

  const copy = (s: string) => { navigator.clipboard?.writeText(s); onNotify("Copied", "info"); };

  const card = "bg-white/[0.03] border border-immersive-border-strong rounded-xl p-4";
  const btn = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition";

  // Zero-dep pure-SVG sparkline for the usage timeseries.
  const Spark: React.FC<{ data: number[]; color: string; label: string }> = ({ data, color, label }) => {
    if (!data.length) return <div className="text-xs text-immersive-text-dim">{label}: no data</div>;
    const max = Math.max(...data, 1), w = Math.max(data.length * 8, 40), h = 48;
    const pts = data.map((v, i) => `${i * 8},${h - (v / max) * h}`).join(" ");
    return (
      <div>
        <div className="text-xs text-immersive-text-muted mb-1">{label} <span className="text-immersive-text-dim">(peak {max})</span></div>
        <svg width={w} height={h} className="border border-immersive-border-strong rounded bg-immersive-inset"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>
      </div>
    );
  };

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-immersive-text-bright">
          <Network className="w-5 h-5 text-status-info" /> SaaS Gateway Control
        </h2>
        <button onClick={refresh} className={`${btn} bg-white/5 text-immersive-text-muted hover:bg-white/10`}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className={card}>
        <label htmlFor="saas-admin-token" className="text-xs font-mono text-immersive-text-muted">Admin Token (X-Admin-Token; needed when SAAS_ENFORCE=1)</label>
        <input id="saas-admin-token" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} type="password" placeholder="SAAS_ADMIN_TOKEN"
          className="mt-1 w-full bg-immersive-inset border border-immersive-border-strong rounded-lg px-3 py-2 text-sm text-immersive-text-bright font-mono" />
      </div>

      {gateway && (
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-immersive-text-bright mb-1"><Network className="w-4 h-4 text-status-info" /> Gateway</div>
          <div className="text-xs font-mono text-immersive-text-muted">exposed tools: <span className="text-status-info">{gateway.exposedTools?.length ?? 0}</span> · tiers: {(gateway.exposeTiers || []).join(", ")} · upstreams: {(gateway.upstreams || []).length}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tenants */}
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-immersive-text-bright mb-3"><Building2 className="w-4 h-4 text-status-ok" /> Tenants</div>
          <div className="flex gap-2 mb-3">
            <input aria-label="Tenant name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="tenant name"
              className="flex-1 bg-immersive-inset border border-immersive-border-strong rounded-lg px-3 py-1.5 text-sm text-immersive-text-bright" />
            <select aria-label="Subscription plan" value={newPlan} onChange={(e) => setNewPlan(e.target.value)} className="bg-immersive-inset border border-immersive-border-strong rounded-lg px-2 text-sm text-immersive-text-bright">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={createTenant} className={`${btn} bg-emerald-500/15 text-status-ok hover:bg-emerald-500/25`}><Plus className="w-3.5 h-3.5" /> Add</button>
          </div>
          <ul className="space-y-1 max-h-64 overflow-auto">
            {tenants.map((t) => (
              <li key={t.id}>
                <button onClick={() => loadTenant(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${selected?.id === t.id ? "bg-cyan-500/15 text-status-info" : "hover:bg-white/5 text-immersive-text-muted"}`}>
                  <span className="font-medium">{t.name}</span> <span className="text-xs font-mono text-immersive-text-dim">· {t.plan_id} · {t.id}</span>
                </button>
              </li>
            ))}
            {tenants.length === 0 && <li className="text-xs text-immersive-text-dim px-3 py-2">No tenants. Create one above.</li>}
          </ul>
        </div>

        {/* Selected tenant detail */}
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-immersive-text-bright mb-3"><KeyRound className="w-4 h-4 text-status-accent" /> API Keys {selected && <span className="text-xs font-mono text-immersive-text-dim">· {selected.name}</span>}</div>
          {!selected && <div className="text-xs text-immersive-text-dim">Select a tenant to manage keys + usage.</div>}
          {selected && (
            <>
              <button onClick={issueKey} className={`${btn} bg-indigo-500/15 text-status-accent hover:bg-indigo-500/25 mb-2`}><Plus className="w-3.5 h-3.5" /> Issue key</button>
              {freshKey && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 mb-2">
                  <code className="flex-1 text-xs text-status-warn break-all">{freshKey}</code>
                  <button aria-label="Copy API key" onClick={() => copy(freshKey)} className="text-status-warn hover:text-status-warn"><Copy className="w-4 h-4" /></button>
                </div>
              )}
              <ul className="space-y-1 mb-3">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between text-xs font-mono text-immersive-text-muted px-2 py-1 rounded bg-immersive-inset">
                    <span>{k.id} {k.label && `(${k.label})`} {k.revoked ? <span className="text-status-err">· revoked</span> : <span className="text-status-ok">· active</span>}</span>
                    {!k.revoked && <button aria-label="Revoke key" onClick={() => revokeKey(k.id)} className="text-status-err hover:text-status-err"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </li>
                ))}
                {keys.length === 0 && <li className="text-xs text-immersive-text-dim">No keys yet.</li>}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Billing */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-immersive-text-bright"><Receipt className="w-4 h-4 text-status-warn" /> Billing (current period)</div>
          <button onClick={previewBilling} className={`${btn} bg-amber-500/15 text-status-warn hover:bg-amber-500/25`}><Gauge className="w-3.5 h-3.5" /> Preview</button>
        </div>
        {billing && (
          <div className="text-xs font-mono text-immersive-text-muted">
            <div>period {billing.period} · {billing.dryRun ? <span className="text-status-warn">DRY-RUN (no Stripe key)</span> : <span className="text-status-ok">LIVE</span>} · total {billing.total}</div>
            <ul className="mt-1 space-y-0.5">
              {(billing.lines || []).map((l: any) => <li key={l.tenantId}>{l.tenantId}: {l.calls} calls → {l.amount}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Audit log (host/privileged/upstream tool calls) */}
      <div className={card}>
        <div className="flex items-center gap-2 text-sm text-immersive-text-bright mb-2"><ShieldAlert className="w-4 h-4 text-status-err" /> Security Audit (recent)</div>
        {audit.length === 0 && <div className="text-xs text-immersive-text-dim">No host/privileged tool calls recorded yet.</div>}
        <ul className="space-y-0.5 max-h-56 overflow-auto">
          {audit.map((a) => (
            <li key={a.id} className="text-xs font-mono text-immersive-text-muted flex items-center gap-2">
              <span className={a.ok ? "text-status-ok" : "text-status-err"}>{a.ok ? "✓" : "✗"}</span>
              <span className="text-immersive-text-muted">{a.tool}</span>
              <span className="text-status-warn">[{a.tier}]</span>
              <span className="text-immersive-text-dim">{a.tenant_id}</span>
              <span className="text-immersive-text-dim ml-auto">{a.ts?.slice(11, 19)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tenant Self-Service (uses a tenant API key, not the admin token) */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-immersive-text-bright"><KeyRound className="w-4 h-4 text-status-info" /> Self-Service (tenant key)</div>
          <button onClick={openPortal} className={`${btn} bg-amber-500/15 text-status-warn hover:bg-amber-500/25`}><Receipt className="w-3.5 h-3.5" /> Billing portal</button>
        </div>
        <div className="flex gap-2 mb-3">
          <input value={tenantKey} onChange={(e) => setTenantKey(e.target.value)} type="password" placeholder="olm_… (needs usage:read / webhooks:write scopes)"
            className="flex-1 bg-immersive-inset border border-immersive-border-strong rounded-lg px-3 py-1.5 text-sm text-immersive-text-bright font-mono" />
          <button onClick={loadSelf} className={`${btn} bg-cyan-500/15 text-status-info hover:bg-cyan-500/25`}><RefreshCw className="w-3.5 h-3.5" /> Load</button>
        </div>
        {selfUsage && <div className="text-xs font-mono text-immersive-text-muted mb-2">plan {selfUsage.plan} · used {selfUsage.used}{selfUsage.quota ? ` / ${selfUsage.quota}` : ""}</div>}
        {series.length > 0 && (
          <div className="flex gap-6 mb-3">
            <Spark data={series.map((s) => s.calls)} color="#22d3ee" label="daily calls" />
            <Spark data={series.map((s) => s.tokens || 0)} color="#a78bfa" label="daily tokens" />
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Webhooks */}
          <div>
            <div className="text-xs text-immersive-text-muted mb-1">Webhooks</div>
            <div className="flex gap-1 mb-1">
              <input aria-label="Webhook URL" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://your.app/hook" className="flex-1 bg-immersive-inset border border-immersive-border-strong rounded px-2 py-1 text-xs text-immersive-text-bright" />
              <button aria-label="Add webhook" onClick={addHook} className={`${btn} bg-emerald-500/15 text-status-ok`}><Plus className="w-3 h-3" /></button>
            </div>
            <input aria-label="Webhook events (comma-separated)" value={whEvents} onChange={(e) => setWhEvents(e.target.value)} className="w-full bg-immersive-inset border border-immersive-border-strong rounded px-2 py-1 text-xs text-immersive-text-dim mb-1" />
            <ul className="space-y-0.5">
              {webhooks.map((w) => (
                <li key={w.id} className="flex items-center gap-2 text-xs font-mono text-immersive-text-muted">
                  <span className="truncate flex-1">{w.url}</span><span className="text-immersive-text-dim">{(w.events || []).length}ev</span>
                  <button aria-label="Delete webhook" onClick={() => delHook(w.id)} className="text-status-err"><Trash2 className="w-3 h-3" /></button>
                </li>
              ))}
              {webhooks.length === 0 && <li className="text-xs text-immersive-text-dim">none</li>}
            </ul>
          </div>
          {/* Upstreams */}
          <div>
            <div className="text-xs text-immersive-text-muted mb-1">Upstream MCP servers</div>
            <ul className="space-y-0.5">
              {upstreams.map((u) => (
                <li key={u.id} className="text-xs font-mono text-immersive-text-muted flex items-center gap-2">
                  <span className="text-immersive-text-muted">{u.name}</span><span className="text-immersive-text-dim">[{u.transport}]</span>
                </li>
              ))}
              {upstreams.length === 0 && <li className="text-xs text-immersive-text-dim">none (POST /api/saas/upstreams)</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
