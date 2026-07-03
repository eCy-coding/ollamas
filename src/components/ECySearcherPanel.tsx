import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ShieldAlert, Loader2, AlertTriangle, Search, Rss, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../lib/apiClient";

// "Threat Intel" tab — queries the eCySearcher threat-intel platform (a separate Flask stack run
// under ollamas, see scripts/ecysearcher-lane.mjs) through the ollamas reverse-proxy
// /api/ecysearcher/* (localOwnerGuard'd). Renders search hits + an analytics summary. Honest empty
// states; never assumes eCySearcher is up (the proxy returns a 502 when it is down).

interface SearchResp {
  success?: boolean; query?: string; type?: string; count?: number;
  data?: { threats?: any[]; domains?: any[]; ips?: any[] };
}
interface Analytics {
  success?: boolean;
  data?: { summary?: { total_threats?: number; total_domains?: number; total_ips?: number } };
}
interface SupStatus {
  state?: string; running?: boolean; ready?: boolean; restarts?: number; circuitOpen?: boolean; baseUrl?: string;
}
interface FeedItem { source: string; title: string; link: string; dateIso: string; summary: string; severity?: "critical" | "high"; }
interface FeedResp { items?: FeedItem[]; sources?: { id: string; title: string; items: number; error?: string }[]; }

export default function ECySearcherPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string>("");
  const [counts, setCounts] = useState<{ threats: number; domains: number; ips: number } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResp | null>(null);
  const [err, setErr] = useState<string>("");
  const [sup, setSup] = useState<SupStatus | null>(null);
  const [acting, setActing] = useState(false);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  // Canlı Tehdit Akışı — server-side curated RSS/Atom/KEV cache; fully
  // independent of the Flask stack's reachability.
  const [feed, setFeed] = useState<FeedResp | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedErr, setFeedErr] = useState("");

  const loadFeed = async (refresh = false) => {
    setFeedBusy(true); setFeedErr("");
    try { setFeed(await api.get<FeedResp>(`/api/threatfeed${refresh ? "?refresh=1" : ""}`)); }
    catch (e) { setFeedErr(String((e as Error)?.message || e)); }
    finally { setFeedBusy(false); }
  };
  useEffect(() => { loadFeed(); }, []);

  const refreshStatus = async () => {
    try { setSup(await api.get<SupStatus>("/api/ecysearcher/status")); } catch { /* supervisor route absent */ }
  };
  const doUp = async () => {
    setActing(true); onNotify?.("eCySearcher başlatılıyor (docker compose up)…", "info");
    try { await api.post("/api/ecysearcher/up"); await refreshStatus(); onNotify?.("eCySearcher up komutu gönderildi", "success"); }
    catch (e) { onNotify?.(`up hatası: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setActing(false); }
  };
  const doDown = async () => {
    setActing(true);
    try { await api.post("/api/ecysearcher/down"); await refreshStatus(); onNotify?.("eCySearcher durduruldu", "info"); }
    catch (e) { onNotify?.(`down hatası: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setActing(false); }
  };
  const loadLogs = async () => {
    setShowLogs((v: boolean) => !v);
    try { const r = await api.get<{ lines?: string[] }>("/api/ecysearcher/logs?limit=200"); setLogs(r?.lines || []); }
    catch { setLogs([]); }
  };

  // Probe reachability + load the analytics summary on mount (on-demand, no constant background poll).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      void refreshStatus();
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
        // The fixed unified analytics endpoint (/api/search + /search/analytics).
        const a = await api.get<Analytics>("/api/ecysearcher/api/search/search/analytics");
        const s = a?.data?.summary;
        if (!cancelled && s) setCounts({ threats: s.total_threats ?? 0, domains: s.total_domains ?? 0, ips: s.total_ips ?? 0 });
      } catch { /* analytics optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const runSearch = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true); setErr(""); setResults(null);
    try {
      const r = await api.get<SearchResp>(`/api/ecysearcher/api/search/search?q=${encodeURIComponent(query)}&type=all&limit=50`);
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
    ...(results?.data?.threats || []).map((t: any) => ({ kind: "threat", v: t.indicator, meta: [t.severity, t.type].filter(Boolean).join(" · ") })),
    ...(results?.data?.domains || []).map((d: any) => ({ kind: "domain", v: d.name, meta: [d.reputation, d.category].filter(Boolean).join(" · ") })),
    ...(results?.data?.ips || []).map((i: any) => ({ kind: "ip", v: i.ip, meta: [i.reputation, i.country].filter(Boolean).join(" · ") })),
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

      {/* Supervisor controls + state — docker-compose stack health under ollamas */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button onClick={doUp} disabled={acting} className="px-2 py-1 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40">
          {acting ? "…" : "Up"}
        </button>
        <button onClick={doDown} disabled={acting} className="px-2 py-1 rounded border border-rose-700 text-rose-300 hover:bg-rose-950/30 disabled:opacity-40">
          Down
        </button>
        <button onClick={loadLogs} className="px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
          {showLogs ? "Logları gizle" : "Loglar"}
        </button>
        {sup && (
          <span className="text-slate-400">
            durum: <span className={sup.circuitOpen ? "text-rose-300" : sup.ready ? "text-emerald-300" : "text-amber-300"}>{sup.state || "?"}</span>
            {typeof sup.restarts === "number" ? ` · restart: ${sup.restarts}` : ""}
            {sup.circuitOpen ? " · circuit AÇIK (manuel Up gerekli)" : ""}
          </span>
        )}
      </div>

      {showLogs && (
        <pre className="text-[11px] leading-snug bg-slate-950 border border-slate-800 rounded p-2 max-h-64 overflow-auto text-slate-300 whitespace-pre-wrap">
          {logs === null ? "yükleniyor…" : logs.length ? logs.join("\n") : "log yok"}
        </pre>
      )}

      {reachable === false && (
        <div className="flex items-start gap-2 text-sm text-rose-300 bg-rose-950/30 border border-rose-800 rounded p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>
            <div>eCySearcher erişilemiyor.</div>
            <div className="text-slate-400 text-xs mt-1 font-mono">ollamas ecysearcher up &nbsp;# docker compose ile başlat</div>
          </div>
        </div>
      )}

      {counts && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {(["threats", "domains", "ips"] as const).map((k) => (
            <div key={k} className="rounded border border-slate-700 bg-slate-900/40 py-2">
              <div className="text-lg font-semibold text-slate-100">{counts[k] ?? 0}</div>
              <div className="text-xs text-slate-400 capitalize">{k}</div>
            </div>
          ))}
        </div>
      )}

      {/* Canlı Tehdit Akışı — CISA KEV + küratörlü güvenlik feed'leri; Flask stack'ten bağımsız */}
      <div className="rounded border border-slate-700 bg-slate-900/40 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Rss className="w-4 h-4 text-amber-400" />
          <span className="text-sm text-slate-200">Canlı Tehdit Akışı</span>
          <span className="text-[10px] text-slate-500">CISA KEV · CISA · SANS ISC · THN · Bleeping · P0</span>
          <button
            onClick={() => loadFeed(true)}
            disabled={feedBusy}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            {feedBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Yenile
          </button>
        </div>
        {feedErr && <div className="text-rose-400 text-xs font-mono">akış alınamadı: {feedErr}</div>}
        {!feed && !feedErr && <div className="text-slate-500 text-xs">yükleniyor…</div>}
        {feed && (feed.items?.length ?? 0) === 0 && !feedErr && <div className="text-slate-500 text-xs">öğe yok</div>}
        {feed && (feed.items?.length ?? 0) > 0 && (
          <ul className="divide-y divide-slate-800 rounded border border-slate-800 max-h-80 overflow-auto">
            {(feed.items ?? []).map((it, i) => (
              <li key={i} className="px-3 py-2 flex items-start gap-2">
                <span className="text-[10px] font-mono text-slate-500 shrink-0 mt-0.5 w-24 truncate" title={it.source}>{it.source}</span>
                <div className="min-w-0 flex-1">
                  <a href={it.link || undefined} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-200 hover:text-sky-300 flex items-center gap-1">
                    <span className="truncate">{it.title}</span>
                    {it.link && <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />}
                  </a>
                  {it.summary && <div className="text-[11px] text-slate-500 truncate">{it.summary}</div>}
                </div>
                <span className="shrink-0 flex items-center gap-1">
                  {it.severity && (
                    <span className={`text-[9px] font-mono px-1 rounded ${it.severity === "critical" ? "bg-rose-950/60 text-rose-300" : "bg-amber-950/60 text-amber-300"}`}>{it.severity}</span>
                  )}
                  <span className="text-[10px] text-slate-500">{it.dateIso ? it.dateIso.slice(0, 10) : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
