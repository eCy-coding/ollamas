import React, { useEffect, useState } from "react";
import { Key, CheckCircle, XCircle, Loader2, Info } from "lucide-react";

interface KeyVaultProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

export const KeyVault: React.FC<KeyVaultProps> = ({ onNotify }) => {
  const [masks, setMasks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [pingStatus, setPingStatus] = useState<Record<string, { ok: boolean; latency?: number; err?: string }>>({});

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
      const res = await fetch("/api/keys/mask");
      if (res.ok) {
        const data = await res.json();
        setMasks(data);
      }
    } catch (e) {
      console.error("Failed to load credential masks", e);
    }
  };

  useEffect(() => {
    loadMasks();
  }, []);

  const handleSave = async (provider: string) => {
    setLoading(true);
    const keyVal = inputs[provider];
    const endpoint = provider === "custom-openai" ? inputs["custom-openai-endpoint"] : undefined;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: keyVal, customEndpoint: endpoint }),
      });
      if (res.ok) {
        onNotify(`Secure Key Vault updated: ${provider}`, "success");
        setInputs((prev) => ({ ...prev, [provider]: "" }));
        loadMasks();
      } else {
        onNotify(`Failed to save key for ${provider}`, "error");
      }
    } catch (err: any) {
      onNotify(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async (provider: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: "" }),
      });
      if (res.ok) {
        onNotify(`Secured key cleared for ${provider}`, "info");
        loadMasks();
        setPingStatus((prev) => {
          const next = { ...prev };
          delete next[provider];
          return next;
        });
      }
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
      const res = await fetch("/api/keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: keyVal, customEndpoint: endpoint }),
      });
      const data = await res.json();
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
    <div className="bg-[#08090d] border border-white/5 rounded p-5 shadow-lg">
      <div className="flex items-center gap-2.5 mb-4">
        <Key className="w-4 h-4 text-indigo-400" />
        <h2 className="text-xs font-bold text-slate-100 font-mono tracking-wider uppercase">Cryptographic API Key Vault</h2>
      </div>

      <div className="flex gap-2.5 bg-black/30 border border-white/5 p-3.5 rounded mb-6 text-[10px] text-slate-400 font-mono leading-relaxed">
        <Info className="w-4 h-4 text-indigo-400 shrink-0" />
        <p>
          <strong>Privacy Protocol Enabled:</strong> All keys configured here live strictly server-side on your hardware, encrypted with 
          AES-256-GCM. Unencrypted plaintext keys are never embedded in client bundles or public responses.
        </p>
      </div>

      <div className="space-y-4">
        {providers.map((prov) => {
          const isConfigured = !!masks[prov.id];
          const maskText = masks[prov.id] || "No key registered (operating in offline fallback)";
          const isTestingThis = !!testing[prov.id];
          const testReport = pingStatus[prov.id];

          return (
            <div key={prov.id} className="bg-black/30 border border-white/5 p-4 rounded flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="md:w-1/3">
                <span className="text-xs font-mono font-bold text-white block">{prov.label}</span>
                <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">{prov.desc}</span>
                
                {/* Active Key Status Meter */}
                <span className={`inline-block mt-2 text-[8px] font-mono px-2 py-0.5 rounded border ${
                  isConfigured 
                    ? "bg-indigo-500/15 border-indigo-500/20 text-indigo-400" 
                    : "bg-[#050608] border-white/5 text-slate-500"
                }`}>
                  {isConfigured ? `CONFIGURED: ${maskText}` : "KEYS INACTIVE"}
                </span>

                {/* Ping Result Indicators */}
                {testReport && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono">
                    {testReport.ok ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Online ({testReport.latency}ms)
                      </span>
                    ) : (
                      <span className="text-rose-400 flex items-center gap-1 group relative">
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
                    className="flex-1 bg-[#050608] border border-white/5 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500/40 font-mono transition-colors"
                  />
                )}

                <input
                  type="password"
                  placeholder={prov.placeholder}
                  value={inputs[prov.id]}
                  onChange={(e) => setInputs((p) => ({ ...p, [prov.id]: e.target.value }))}
                  className="flex-1 bg-[#050608] border border-white/5 rounded px-3 py-1.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500/40 font-mono transition-colors"
                />

                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => handleSave(prov.id)}
                    disabled={loading || !inputs[prov.id]}
                    className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-bold text-[10px] rounded px-3 py-1.5 disabled:opacity-50 transition cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleTest(prov.id)}
                    disabled={isTestingThis}
                    className="bg-white/5 text-slate-300 hover:bg-white/10 font-mono font-medium text-[10px] rounded px-3 py-1.5 disabled:opacity-50 border border-white/10 flex items-center gap-1 cursor-pointer"
                  >
                    {isTestingThis && <Loader2 className="w-3 h-3 animate-spin" />}
                    Test
                  </button>
                  {isConfigured && (
                    <button
                      onClick={() => handleClear(prov.id)}
                      className="bg-red-500/10 text-red-400 border border-red-500/20 font-mono font-bold text-[10px] rounded px-2.5 py-1.5 hover:bg-red-500/20 transition cursor-pointer"
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
