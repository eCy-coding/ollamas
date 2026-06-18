import React, { useEffect, useState } from "react";
import { Building2, KeyRound, Gauge, Receipt, Network, Plus, Trash2, RefreshCw, Copy } from "lucide-react";

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
  const [newName, setNewName] = useState("");
  const [newPlan, setNewPlan] = useState("free");
  const [freshKey, setFreshKey] = useState<string>("");

  const hdr = () => ({ "Content-Type": "application/json", "x-admin-token": adminToken });

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
    } catch (e: any) {
      onNotify(`SaaS admin: ${e.message}`, "error");
    }
  };

  useEffect(() => { if (adminToken !== "") localStorage.setItem("saasAdminToken", adminToken); }, [adminToken]);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

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

  const card = "bg-white/[0.03] border border-white/10 rounded-xl p-4";
  const btn = "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition";

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
          <Network className="w-5 h-5 text-cyan-400" /> SaaS Gateway Control
        </h2>
        <button onClick={refresh} className={`${btn} bg-white/5 text-slate-300 hover:bg-white/10`}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className={card}>
        <label className="text-xs font-mono text-slate-400">Admin Token (X-Admin-Token; needed when SAAS_ENFORCE=1)</label>
        <input value={adminToken} onChange={(e) => setAdminToken(e.target.value)} type="password" placeholder="SAAS_ADMIN_TOKEN"
          className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono" />
      </div>

      {gateway && (
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-1"><Network className="w-4 h-4 text-cyan-400" /> Gateway</div>
          <div className="text-xs font-mono text-slate-400">exposed tools: <span className="text-cyan-300">{gateway.exposedTools?.length ?? 0}</span> · tiers: {(gateway.exposeTiers || []).join(", ")} · upstreams: {(gateway.upstreams || []).length}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tenants */}
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-3"><Building2 className="w-4 h-4 text-emerald-400" /> Tenants</div>
          <div className="flex gap-2 mb-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="tenant name"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-slate-200" />
            <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} className="bg-black/40 border border-white/10 rounded-lg px-2 text-sm text-slate-200">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={createTenant} className={`${btn} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`}><Plus className="w-3.5 h-3.5" /> Add</button>
          </div>
          <ul className="space-y-1 max-h-64 overflow-auto">
            {tenants.map((t) => (
              <li key={t.id}>
                <button onClick={() => loadTenant(t)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${selected?.id === t.id ? "bg-cyan-500/15 text-cyan-200" : "hover:bg-white/5 text-slate-300"}`}>
                  <span className="font-medium">{t.name}</span> <span className="text-xs font-mono text-slate-500">· {t.plan_id} · {t.id}</span>
                </button>
              </li>
            ))}
            {tenants.length === 0 && <li className="text-xs text-slate-500 px-3 py-2">No tenants. Create one above.</li>}
          </ul>
        </div>

        {/* Selected tenant detail */}
        <div className={card}>
          <div className="flex items-center gap-2 text-sm text-slate-200 mb-3"><KeyRound className="w-4 h-4 text-indigo-400" /> API Keys {selected && <span className="text-xs font-mono text-slate-500">· {selected.name}</span>}</div>
          {!selected && <div className="text-xs text-slate-500">Select a tenant to manage keys + usage.</div>}
          {selected && (
            <>
              <button onClick={issueKey} className={`${btn} bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 mb-2`}><Plus className="w-3.5 h-3.5" /> Issue key</button>
              {freshKey && (
                <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 mb-2">
                  <code className="flex-1 text-xs text-amber-200 break-all">{freshKey}</code>
                  <button onClick={() => copy(freshKey)} className="text-amber-300 hover:text-amber-100"><Copy className="w-4 h-4" /></button>
                </div>
              )}
              <ul className="space-y-1 mb-3">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between text-xs font-mono text-slate-400 px-2 py-1 rounded bg-black/30">
                    <span>{k.id} {k.label && `(${k.label})`} {k.revoked ? <span className="text-rose-400">· revoked</span> : <span className="text-emerald-400">· active</span>}</span>
                    {!k.revoked && <button onClick={() => revokeKey(k.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </li>
                ))}
                {keys.length === 0 && <li className="text-xs text-slate-500">No keys yet.</li>}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Billing */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-slate-200"><Receipt className="w-4 h-4 text-amber-400" /> Billing (current period)</div>
          <button onClick={previewBilling} className={`${btn} bg-amber-500/15 text-amber-300 hover:bg-amber-500/25`}><Gauge className="w-3.5 h-3.5" /> Preview</button>
        </div>
        {billing && (
          <div className="text-xs font-mono text-slate-400">
            <div>period {billing.period} · {billing.dryRun ? <span className="text-amber-300">DRY-RUN (no Stripe key)</span> : <span className="text-emerald-300">LIVE</span>} · total {billing.total}</div>
            <ul className="mt-1 space-y-0.5">
              {(billing.lines || []).map((l: any) => <li key={l.tenantId}>{l.tenantId}: {l.calls} calls → {l.amount}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
