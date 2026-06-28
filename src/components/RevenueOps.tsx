// Revenue / Personal Ops (Faz19) — local-owner dashboard tab for the $0 income tooling:
// $0 test-gen (auto-verified, only-passing-ships), code-audit (480b), and storefront
// generation from config. Produces local artifacts only — no money movement, no outreach.
import { useState, useEffect } from "react";
import { api } from "../lib/apiClient";

interface Props {
  onNotify: (msg: string, type?: "success" | "error" | "info") => void;
}

type Cfg = { brand?: string; email?: string; paymentLink?: string; model?: string };

export function RevenueOps({ onNotify }: Props) {
  const [cfg, setCfg] = useState<Cfg>({});
  const [tg, setTg] = useState({ file: "orchestration/bin/lib/bench.ts", fn: "median" });
  const [auditRepo, setAuditRepo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => { api.get<Cfg>("/api/revenue/config").then(setCfg).catch((e) => onNotify((e as Error)?.message || "revenue config load failed", "error")); }, []);

  const err = (e: unknown) => onNotify((e as Error)?.message || "error", "error");

  const saveCfg = async () => {
    try { const r = await api.post<Cfg>("/api/revenue/config", cfg); setCfg(r); onNotify("Config saved", "success"); } catch (e) { err(e); }
  };
  const runOp = async (key: string, ep: string, body: unknown, msg: (r: Record<string, unknown>) => [string, "success" | "error" | "info"]) => {
    setBusy(key); setResult(null);
    try { const r = await api.post<Record<string, unknown>>(ep, body); setResult(r); const [m, t] = msg(r); onNotify(m, t); }
    catch (e) { err(e); } finally { setBusy(null); }
  };

  const card = "bg-slate-800/50 border border-slate-700 rounded-xl p-4";
  const input = "w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100";
  const btn = "px-4 py-2 rounded font-medium text-sm disabled:opacity-50";

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-green-400">Revenue / Personal Ops</h2>
        <p className="text-xs text-slate-400">Local-owner only. $0 test-gen (auto-verified) · audit (480b) · storefront from config. No money movement, no outreach — local artifacts only.</p>
      </div>

      {/* Config */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Storefront config <span className="text-slate-500 font-normal">(you provide your own payment link)</span></h3>
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Brand / name" value={cfg.brand || ""} onChange={(e) => setCfg({ ...cfg, brand: e.target.value })} />
          <input className={input} placeholder="Email" value={cfg.email || ""} onChange={(e) => setCfg({ ...cfg, email: e.target.value })} />
          <input className={`${input} col-span-2`} placeholder="Payment / booking link (Gumroad/Stripe)" value={cfg.paymentLink || ""} onChange={(e) => setCfg({ ...cfg, paymentLink: e.target.value })} />
        </div>
        <button className={`${btn} bg-slate-600 hover:bg-slate-500 text-white mt-2`} onClick={saveCfg}>Save config</button>
      </div>

      {/* Test-Pack ($0) */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Test-Pack <span className="text-green-400 font-normal">($0 · qwen3:8b · auto-verified)</span></h3>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input className={input} placeholder="source file" value={tg.file} onChange={(e) => setTg({ ...tg, file: e.target.value })} />
          <input className={input} placeholder="exported fn" value={tg.fn} onChange={(e) => setTg({ ...tg, fn: e.target.value })} />
        </div>
        <button className={`${btn} bg-green-600 hover:bg-green-500 text-white`} disabled={!!busy}
          onClick={() => runOp("testgen", "/api/revenue/testgen", tg, (r) => [r.shippable ? "✅ Test PASSES — shippable" : "✗ Test rejected by gate (never ships broken)", r.shippable ? "success" : "error"])}>
          {busy === "testgen" ? "Generating + running…" : "Generate verified test"}
        </button>
      </div>

      {/* Audit (480b) */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Audit <span className="text-amber-400 font-normal">(480b-cloud · ~cents/repo, higher yield than $0)</span></h3>
        <input className={`${input} mb-2`} placeholder="repo path to audit" value={auditRepo} onChange={(e) => setAuditRepo(e.target.value)} />
        <button className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`} disabled={!!busy || !auditRepo}
          onClick={() => runOp("audit", "/api/revenue/audit", { repo: auditRepo, maxUnits: 6 }, (r) => [`Audit done: ${r.findings ?? 0} findings`, "info"])}>
          {busy === "audit" ? "Auditing…" : "Run audit (capped 6 units)"}
        </button>
      </div>

      {/* Storefront */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Storefront page</h3>
        <button className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`} disabled={!!busy}
          onClick={() => runOp("store", "/api/revenue/storefront", {}, (r) => {
            const rem = (r.remainingPlaceholders as string[] | undefined)?.length || 0;
            return [rem ? `Generated — ${rem} placeholder(s) still unfilled (fill config)` : "Storefront ready (all placeholders filled)", rem ? "info" : "success"];
          })}>
          {busy === "store" ? "Generating…" : "Generate storefront HTML"}
        </button>
      </div>

      {result != null && (
        <pre className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 overflow-auto max-h-72">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
