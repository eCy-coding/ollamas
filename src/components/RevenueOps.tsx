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
  const [ghRepo, setGhRepo] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [ghDeliver, setGhDeliver] = useState<"issue" | "pr">("issue");
  const [showApp, setShowApp] = useState(false);
  const [ghApp, setGhApp] = useState({ id: "", key: "", installation: "", secret: "" });
  const [stripeKey, setStripeKey] = useState("");
  const [pay, setPay] = useState({ amount: "300", description: "ollamas Verified Audit" });
  const [payUrl, setPayUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

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

      {/* Audit (480b) + optional GitHub delivery */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Audit <span className="text-amber-400 font-normal">(480b-cloud · ~cents/repo, higher yield than $0)</span></h3>
        <input className={`${input} mb-2`} placeholder="repo path to audit" value={auditRepo} onChange={(e) => setAuditRepo(e.target.value)} />

        {/* Optional: deliver the findings to a client repo as a GitHub Issue (the paid artifact) */}
        <div className="border-t border-slate-700 mt-2 pt-2">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-slate-400">GitHub delivery <span className="text-slate-500">(optional)</span></p>
            <div className="flex gap-1 text-[11px]">
              {(["issue", "pr"] as const).map((d) => (
                <button key={d} onClick={() => setGhDeliver(d)}
                  className={`px-2 py-0.5 rounded border ${ghDeliver === d ? "bg-amber-600/30 border-amber-500/40 text-amber-300" : "border-slate-700 text-slate-400 hover:bg-slate-700/40"}`}>
                  {d === "issue" ? "Issue" : "Pull Request"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input className={input} placeholder="client repo (owner/name)" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} />
            <div className="flex gap-1.5">
              <input className={input} type="password" placeholder="GitHub PAT (issues:write)" value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
              <button className={`${btn} bg-slate-600 hover:bg-slate-500 text-white shrink-0`} disabled={!ghToken}
                onClick={async () => { try { await api.post("/api/keys", { provider: "github", key: ghToken }); setGhToken(""); onNotify("GitHub token saved to the encrypted vault", "success"); } catch (e) { err(e); } }}>
                Save token
              </button>
            </div>
          </div>

          {/* GitHub App (Checks API / per-PR CI tier — App-only). Collapsed by default. */}
          <button className="text-[11px] text-slate-500 hover:text-slate-300 mt-0.5" onClick={() => setShowApp((s) => !s)}>
            {showApp ? "▾" : "▸"} GitHub App (Checks / CI tier)
          </button>
          {showApp && (
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <input className={input} placeholder="App id" value={ghApp.id} onChange={(e) => setGhApp({ ...ghApp, id: e.target.value })} />
              <input className={input} placeholder="Installation id" value={ghApp.installation} onChange={(e) => setGhApp({ ...ghApp, installation: e.target.value })} />
              <input className={input} type="password" placeholder="Webhook secret" value={ghApp.secret} onChange={(e) => setGhApp({ ...ghApp, secret: e.target.value })} />
              <textarea className={`${input} col-span-2 font-mono text-[11px]`} rows={3} placeholder="App private key (PEM)" value={ghApp.key} onChange={(e) => setGhApp({ ...ghApp, key: e.target.value })} />
              <button className={`${btn} bg-slate-600 hover:bg-slate-500 text-white col-span-2`} disabled={!ghApp.id || !ghApp.key || !ghApp.installation}
                onClick={async () => {
                  try {
                    await api.post("/api/keys", { provider: "github-app-id", key: ghApp.id });
                    await api.post("/api/keys", { provider: "github-app-key", key: ghApp.key });
                    await api.post("/api/keys", { provider: "github-app-installation", key: ghApp.installation });
                    if (ghApp.secret) await api.post("/api/keys", { provider: "github-webhook-secret", key: ghApp.secret });
                    setGhApp({ id: "", key: "", installation: "", secret: "" });
                    onNotify("GitHub App creds saved to the encrypted vault — Checks API enabled", "success");
                  } catch (e) { err(e); }
                }}>
                Save App creds (enables per-PR Checks)
              </button>
            </div>
          )}
        </div>

        <button className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`} disabled={!!busy || !auditRepo}
          onClick={() => runOp("audit", "/api/revenue/audit", { repo: auditRepo, maxUnits: 6, githubRepo: ghRepo || undefined, deliver: ghDeliver }, (r) => {
            const gh = r.github as { issueUrl?: string; prUrl?: string; reason?: string } | undefined;
            const url = gh?.prUrl || gh?.issueUrl;
            if (url) return [`Audit done: ${r.findings ?? 0} findings → posted to GitHub (${gh?.prUrl ? "PR" : "Issue"})`, "success"];
            if (gh?.reason) return [`Audit done: ${r.findings ?? 0} findings · GitHub: ${gh.reason}`, "info"];
            return [`Audit done: ${r.findings ?? 0} findings`, "info"];
          })}>
          {busy === "audit" ? "Auditing…" : ghRepo ? `Run audit → open ${ghDeliver === "pr" ? "PR" : "Issue"}` : "Run audit (capped 6 units)"}
        </button>

        {(() => {
          const gh = result?.github as { issueUrl?: string; prUrl?: string } | undefined;
          const url = gh?.prUrl || gh?.issueUrl;
          return url ? (
            <p className="mt-2 text-xs">
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                ↗ View the published audit {gh?.prUrl ? "pull request" : "issue"}
              </a>
            </p>
          ) : null;
        })()}
      </div>

      {/* Stripe — get paid (one-time Checkout link for an audit deliverable) */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Get paid <span className="text-green-400 font-normal">(Stripe Checkout link)</span></h3>
        <div className="flex gap-1.5 mb-2">
          <input className={input} type="password" placeholder="Stripe secret key (sk_test_… then sk_live_…)" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} />
          <button className={`${btn} bg-slate-600 hover:bg-slate-500 text-white shrink-0`} disabled={!stripeKey}
            onClick={async () => { try { await api.post("/api/keys", { provider: "stripe", key: stripeKey }); setStripeKey(""); onNotify("Stripe key saved to the encrypted vault", "success"); } catch (e) { err(e); } }}>
            Save key
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input className={input} type="number" placeholder="USD" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <input className={`${input} col-span-2`} placeholder="description" value={pay.description} onChange={(e) => setPay({ ...pay, description: e.target.value })} />
        </div>
        <button className={`${btn} bg-green-600 hover:bg-green-500 text-white`} disabled={!!busy || !(Number(pay.amount) > 0)}
          onClick={() => runOp("checkout", "/api/revenue/checkout", { amount: Number(pay.amount), description: pay.description }, (r) => {
            if (r.url) { setPayUrl(String(r.url)); return [`Payment link created ($${pay.amount})`, "success"]; }
            return [`Stripe: ${r.reason || "not configured"}`, "info"];
          })}>
          {busy === "checkout" ? "Creating…" : "Create payment link"}
        </button>
        {payUrl && (
          <p className="mt-2 text-xs break-all">
            <a href={payUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">↗ {payUrl}</a>
            <span className="text-slate-500"> — send this to the client</span>
          </p>
        )}
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
