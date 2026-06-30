import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ShieldAlert, Loader2, AlertTriangle, Search } from "lucide-react";
import { api } from "../lib/apiClient";

// "Threat Intel" tab — queries the eCySearcher threat-intel platform (a separate Flask stack run
// under ollamas, see scripts/ecysearcher-lane.mjs) through the ollamas reverse-proxy
// /api/ecysearcher/* (localOwnerGuard'd). Renders search hits + an analytics summary. Honest empty
// states; never assumes eCySearcher is up (the proxy returns a 502 when it is down).

interface SearchResp {
  success?: boolean; query?: string; type?: string; count?: number;
  data?: { threats?: any[]; domains?: any[]; ips?: any[] };
}
interface Dashboard {
  success?: boolean;
  data?: { counts?: { threats?: number; domains?: number; ips?: number }; top_sources?: any[] };
}

export default function ECySearcherPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [dash, setDash] = useState<Dashboard["data"] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResp | null>(null);
  const [err, setErr] = useState<string>("");

  // Probe reachability + load the analytics summary on mount (on-demand, no constant background poll).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const root = await api.get<{ service?: string; version?: string }>("/api/ecysearcher/");
        if (cancelled) return;
        setReachable(true);
        setVersion(root?.version || "");
      } catch {
        if (!cancelled) setReachable(false);
        return;
      }
      try {
        const d = await api.get<Dashboard>("/api/ecysearcher/api/analytics/dashboard");
        if (!cancelled) setDash(d?.data || null);
      } catch { /* analytics optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const runSearch = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true); setErr(""); setResults(null);
    try {
      const r = await api.get<SearchResp>(`/api/ecysearcher/api/search?q=${encodeURIComponent(query)}&type=all&limit=50`);
      setResults(r);
      onNotify?.(`eCySearcher: ${r?.count ?? 0} sonuç`, "info");
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setErr(msg);
      onNotify?.(`eCySearcher arama hatası: ${msg}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ...(results?.data?.threats || []).map((t: any) => ({ kind: "threat", v: t.indicator || t.name, meta: t.severity || t.threat_type || "" })),
    ...(results?.data?.domains || []).map((d: any) => ({ kind: "domain", v: d.name, meta: d.status || "" })),
    ...(results?.data?.ips || []).map((i: any) => ({ kind: "ip", v: i.ip, meta: i.status || "" })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <span>eCySearcher — threat intelligence (subsystem under ollamas)</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${reachable === null ? "text-slate-400" : reachable ? "text-emerald-300 bg-emerald-950/40" : "text-rose-300 bg-rose-950/30"}`}>
          {reachable === null ? "probing…" : reachable ? `UP${version ? ` v${version}` : ""}` : "DOWN"}
        </span>
      </div>

      {reachable === false && (
        <div className="flex items-start gap-2 text-sm text-rose-300 bg-rose-950/30 border border-rose-800 rounded p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>
            <div>eCySearcher erişilemiyor (:5000).</div>
            <div className="text-slate-400 text-xs mt-1 font-mono">ollamas ecysearcher up &nbsp;# docker compose ile başlat</div>
          </div>
        </div>
      )}

      {dash?.counts && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {(["threats", "domains", "ips"] as const).map((k) => (
            <div key={k} className="rounded border border-slate-700 bg-slate-900/40 py-2">
              <div className="text-lg font-semibold text-slate-100">{dash.counts?.[k] ?? 0}</div>
              <div className="text-xs text-slate-400 capitalize">{k}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") runSearch(); }}
          placeholder="domain / IP / gösterge ara (örn. example.com)"
          className="flex-1 px-3 py-2 rounded border border-slate-600 bg-slate-900 text-sm text-slate-200 placeholder-slate-500"
        />
        <button
          onClick={runSearch}
          disabled={busy || reachable === false}
          className="flex items-center gap-1 px-3 py-2 rounded border border-slate-600 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Ara
        </button>
      </div>

      {err && <div className="text-rose-400 text-xs font-mono">{err}</div>}

      {results && (
        <div className="text-sm">
          <div className="text-slate-400 text-xs mb-1">{rows.length} sonuç · "{results.query}"</div>
          {rows.length === 0 ? (
            <div className="text-slate-500 text-sm py-4 text-center">eşleşme yok</div>
          ) : (
            <ul className="divide-y divide-slate-800 rounded border border-slate-700">
              {rows.map((r, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-slate-200">{r.v}</span>
                  <span className="text-xs text-slate-400">{r.kind}{r.meta ? ` · ${r.meta}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
