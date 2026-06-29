import React, { useEffect, useState } from "react";
import { Key, CheckCircle, XCircle, Loader2, Info, AlertTriangle, ExternalLink } from "lucide-react";
import { api } from "../lib/apiClient";

interface KeyVaultProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

// Where the operator logs into the NEXT account + creates a key (the guided-paste flow).
const KEY_PAGE: Record<string, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  openrouter: "https://openrouter.ai/keys",
};

interface PoolEntry { total: number; live: number; worstPct: number; allApproaching: boolean }

export const KeyVault: React.FC<KeyVaultProps> = ({ onNotify }) => {
  const [masks, setMasks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [pingStatus, setPingStatus] = useState<Record<string, { ok: boolean; latency?: number; err?: string }>>({});
  const [pool, setPool] = useState<Record<string, PoolEntry>>({});
  const [alerts, setAlerts] = useState<Array<{ provider: string; worstPct: number; live: number }>>([]);

  // Form Inputs
  const [inputs, setInputs] = useState<Record<string, string>>({
    gemini: "",
    anthropic: "",
    openai: "",
    openrouter: "",
    "ollama-cloud": "",
    "custom-openai": "",
    "custom-openai-endpoint": "",
  });

  const loadMasks = async () => {
    try {
      const data = await api.get<Record<string, string>>("/api/keys/mask");
      setMasks(data);
    } catch (e) {
      console.error("Failed to load credential masks", e);
    }
  };

  // Pool health (per-key burn % + saturation alerts) — poll so the operator sees a key
  // approaching its limit and can add the next account's key BEFORE a 429.
  const loadPool = async () => {
    try {
      const data = await api.get<{ pool: Record<string, PoolEntry>; alerts: typeof alerts }>("/api/keys/pool");
      setPool(data.pool || {});
      setAlerts(data.alerts || []);
    } catch { /* gateway down — leave prior state */ }
  };

  useEffect(() => {
    loadMasks();
    loadPool();
    const t = setInterval(loadPool, 15000); // 15s burn-rate refresh
    return () => clearInterval(t);
  }, []);

  // Guided provisioning: open the provider's key page so the operator logs into the NEXT
  // account + creates a key, then pastes it into the field below + Save (→ joins the pool).
  const openKeyPage = (provider: string) => {
    const url = KEY_PAGE[provider];
    if (!url) return;
    window.open(url, "_blank", "noopener");
    onNotify(`Opened ${provider} key page — log into the next account, create a key, paste it below.`, "info");
  };

  const handleSave = async (provider: string) => {
    setLoading(true);
    const keyVal = inputs[provider];
    const endpoint = provider === "custom-openai" ? inputs["custom-openai-endpoint"] : undefined;

    try {
      // If a primary key already exists for this provider, GROW the rotation pool (the guided
      // "add next key" flow); otherwise set the primary. Either way it joins keyPool().
      if (masks[provider] && KEY_PAGE[provider]) {
        const r = await api.post<{ poolSize?: number }>("/api/keys/add", { provider, key: keyVal });
        onNotify(`Key added to the ${provider} pool (size ${r.poolSize ?? "?"}).`, "success");
      } else {
        await api.post("/api/keys", { provider, key: keyVal, customEndpoint: endpoint });
        onNotify(`Secure Key Vault updated: ${provider}`, "success");
      }
      setInputs((prev) => ({ ...prev, [provider]: "" }));
      loadMasks();
      loadPool();
    } catch {
      onNotify(`Failed to save key for ${provider}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async (provider: string) => {
    setLoading(true);
    try {
      await api.post("/api/keys", { provider, key: "" });
      onNotify(`Secured key cleared for ${provider}`, "info");
      loadMasks();
      setPingStatus((prev) => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });
    } catch (err: any) {
      onNotify(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (provider: string) => {
    setTesting((prev) => ({ ...prev, [provider]: true }));
    const keyVal = inputs[provider];
    const endpoint = provider === "custom-openai" ? inputs["custom-openai-endpoint"] : undefined;

    try {
      const data = await api.post<{ success: boolean; latencyMs?: number; error?: string }>(
        "/api/keys/test",
        { provider, key: keyVal, customEndpoint: endpoint },
      );
      if (data.success) {
        setPingStatus((prev) => ({
          ...prev,
          [provider]: { ok: true, latency: data.latencyMs },
        }));
        onNotify(`${provider} connection verified!`, "success");
      } else {
        setPingStatus((prev) => ({
          ...prev,
          [provider]: { ok: false, err: data.error },
        }));
        onNotify(`${provider} reachability failed. Check keys.`, "error");
      }
    } catch (e: any) {
      setPingStatus((prev) => ({ ...prev, [provider]: { ok: false, err: e.message } }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const providers = [
    { id: "gemini", label: "Google Gemini", placeholder: "Key: GEMINI_API_KEY", desc: "Native Google Gen AI API access" },
    { id: "anthropic", label: "Anthropic Claude", placeholder: "Key: ANTHROPIC_API_KEY", desc: "Native Claude 3 / 3.5 messaging protocols" },
    { id: "openai", label: "OpenAI GPT", placeholder: "Key: OPENAI_API_KEY", desc: "Native GPT chat completions access" },
    { id: "openrouter", label: "OpenRouter.ai", placeholder: "Key: OPENROUTER_API_KEY", desc: "Aggregated cloud providers; filterable to FREE models" },
    { id: "custom-openai", label: "Custom OpenAI compatible", placeholder: "Bearer token", desc: "Connect local wrappers, LM Studio, or vLLM hosts" },
  ];

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center gap-2.5 mb-4">
        <Key className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Cryptographic API Key Vault</h2>
      </div>

      <div className="flex gap-2.5 bg-immersive-inset border border-immersive-border p-3.5 rounded mb-6 text-[10px] text-immersive-text-muted font-mono leading-relaxed">
        <Info className="w-4 h-4 text-status-accent shrink-0" />
        <p>
          <strong>Privacy Protocol Enabled:</strong> All keys configured here live strictly server-side on your hardware, encrypted with 
          AES-256-GCM. Unencrypted plaintext keys are never embedded in client bundles or public responses.
        </p>
      </div>

      {/* P3 — approaching-limit alert: the whole live pool of a provider is saturating → act */}
      {alerts.length > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 p-3 rounded mb-4 text-[10px] font-mono text-status-warn leading-relaxed">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Rate-limit approaching:</strong>{" "}
            {alerts.map((a) => `${a.provider} ${Math.round(a.worstPct * 100)}% (${a.live} live)`).join(" · ")}.
            Add the next account's key — click <strong>Key ↗</strong>, log into the next account, create a key, paste it below, Save.
          </div>
        </div>
      )}

      <div className="space-y-4">
        {providers.map((prov) => {
          const isConfigured = !!masks[prov.id];
          const ph = pool[prov.id];
          const maskText = masks[prov.id] || "No key registered (operating in offline fallback)";
          const isTestingThis = !!testing[prov.id];
          const testReport = pingStatus[prov.id];

          return (
            <div key={prov.id} className="bg-immersive-inset border border-immersive-border p-4 rounded flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="md:w-1/3">
                <span className="text-xs font-mono font-bold text-immersive-text-bright block">{prov.label}</span>
                <span className="text-[10px] text-immersive-text-dim block leading-tight mt-0.5">{prov.desc}</span>
                
                {/* Active Key Status Meter */}
                <span className={`inline-block mt-2 text-[8px] font-mono px-2 py-0.5 rounded border ${
                  isConfigured 
                    ? "bg-indigo-500/15 border-indigo-500/20 text-status-accent" 
                    : "bg-immersive-bg border-immersive-border text-immersive-text-dim"
                }`}>
                  {isConfigured ? `CONFIGURED: ${maskText}` : "KEYS INACTIVE"}
                </span>

                {/* P3 — pool burn meter: live/total + worst-key % of its rate limit */}
                {ph && ph.total > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${ph.allApproaching ? "bg-amber-500/15 border-amber-500/25 text-status-warn" : "bg-immersive-bg border-immersive-border text-immersive-text-dim"}`}>
                      pool {ph.live}/{ph.total} · {Math.round(ph.worstPct * 100)}%
                    </span>
                    <div className="flex-1 h-1 rounded bg-immersive-bg overflow-hidden max-w-[80px]">
                      <div className={`h-full ${ph.worstPct >= 0.8 ? "bg-status-warn" : "bg-status-accent"}`} style={{ width: `${Math.min(100, Math.round(ph.worstPct * 100))}%` }} />
                    </div>
                  </div>
                )}

                {/* Ping Result Indicators */}
                {testReport && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono">
                    {testReport.ok ? (
                      <span className="text-status-ok flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Online ({testReport.latency}ms)
                      </span>
                    ) : (
                      <span className="text-status-err flex items-center gap-1 group relative">
                        <XCircle className="w-3.5 h-3.5" />
                        Ping Failed
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-grow flex flex-col gap-2 md:flex-row md:items-center">
                {/* Custom Base URL Field */}
                {prov.id === "custom-openai" && (
                  <input
                    type="text"
                    placeholder="Custom Base API Endpoint (e.g. http://localhost:1234/v1)"
                    value={inputs["custom-openai-endpoint"]}
                    onChange={(e) => setInputs((p) => ({ ...p, "custom-openai-endpoint": e.target.value }))}
                    className="flex-1 bg-immersive-bg border border-immersive-border rounded px-3 py-1.5 text-xs text-immersive-text-bright placeholder-slate-700 focus:outline-none focus:border-indigo-500/40 font-mono transition-colors"
                  />
                )}

                <input
                  type="password"
                  placeholder={prov.placeholder}
                  value={inputs[prov.id]}
                  onChange={(e) => setInputs((p) => ({ ...p, [prov.id]: e.target.value }))}
                  className="flex-1 bg-immersive-bg border border-immersive-border rounded px-3 py-1.5 text-xs text-immersive-text-bright placeholder-slate-700 focus:outline-none focus:border-indigo-500/40 font-mono transition-colors"
                />

                <div className="flex gap-1.5 shrink-0">
                  {KEY_PAGE[prov.id] && (
                    <button
                      onClick={() => openKeyPage(prov.id)}
                      title={`Open ${prov.label} key page (log into the next account → create → paste below)`}
                      className="bg-white/5 text-immersive-text-muted hover:bg-white/10 font-mono font-medium text-[10px] rounded px-2.5 py-1.5 border border-immersive-border-strong flex items-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" /> Key
                    </button>
                  )}
                  <button
                    onClick={() => handleSave(prov.id)}
                    disabled={loading || !inputs[prov.id]}
                    className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono font-bold text-[10px] rounded px-3 py-1.5 disabled:opacity-50 transition cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleTest(prov.id)}
                    disabled={isTestingThis}
                    className="bg-white/5 text-immersive-text-muted hover:bg-white/10 font-mono font-medium text-[10px] rounded px-3 py-1.5 disabled:opacity-50 border border-immersive-border-strong flex items-center gap-1 cursor-pointer"
                  >
                    {isTestingThis && <Loader2 className="w-3 h-3 animate-spin" />}
                    Test
                  </button>
                  {isConfigured && (
                    <button
                      onClick={() => handleClear(prov.id)}
                      className="bg-red-500/10 text-status-err border border-red-500/20 font-mono font-bold text-[10px] rounded px-2.5 py-1.5 hover:bg-red-500/20 transition cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
