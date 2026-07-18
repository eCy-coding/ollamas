import { useEffect, useState, type ChangeEvent } from "react";
import { Plug, Loader2, RefreshCw, CheckCircle2, AlertTriangle, CircleAlert, Zap } from "lucide-react";
import { api } from "../lib/apiClient";
import { useAuth } from "../hooks/useAuth";
import { AssistDrawer } from "./AssistDrawer";

// "Entegrasyonlar" tab — on-demand health matrix + a 0-paste GitHub connect
// (pulls the gh CLI token into the vault). Each row shows purpose + a one-step
// fix. Google is client-evaluated (the server can't see the browser OAuth).
type Status = "ok" | "needs-setup" | "degraded";
interface Row { id: string; title: string; status: Status; detail: string; fix?: string; purpose: string; lane: string; }

const STYLE: Record<Status, { icon: any; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-emerald-400", label: "hazır" },
  "needs-setup": { icon: AlertTriangle, cls: "text-amber-400", label: "kurulum" },
  degraded: { icon: CircleAlert, cls: "text-orange-400", label: "kısıtlı" },
};

export default function IntegrationsPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const { isConfigured, token: googleToken } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pat, setPat] = useState("");

  const load = async () => {
    setBusy(true);
    try { setRows(await api.get<Row[]>("/api/integrations/health", { soft: true })); }
    catch (e) { onNotify?.(`Sağlık: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);

  const autoconnect = async () => {
    setConnecting(true);
    try {
      const r = await api.post<{ ok: boolean; source?: string; scopes?: string[]; hint?: string }>("/api/integrations/github/autoconnect", {});
      if (r.ok) { onNotify?.(`GitHub bağlandı (${r.source}, scope: ${(r.scopes || []).join(",")})`, "success"); load(); }
      else onNotify?.(r.hint || "gh CLI bulunamadı", "error");
    } catch (e) { onNotify?.(`Autoconnect: ${String((e as Error)?.message || e)}`, "error"); }
    finally { setConnecting(false); }
  };

  const savePat = async () => {
    const key = pat.trim();
    if (!key) return;
    try { await api.post("/api/keys", { provider: "github", key }); setPat(""); onNotify?.("GitHub PAT kaydedildi", "success"); load(); }
    catch (e) { onNotify?.(`PAT: ${String((e as Error)?.message || e)}`, "error"); }
  };

  // Google row is client-side: the server can't observe the browser OAuth session.
  const googleRow: Row = googleToken
    ? { id: "google", title: "Google (Drive/Sheets/Takvim/Gmail)", status: "ok", detail: "Oturum açık — 4 servis aktif.", purpose: "Ajanda/e-posta/dosya/tablo erişimi (browser-side, veri makinede).", lane: "personal-ops" }
    : isConfigured === false
      ? { id: "google", title: "Google", status: "needs-setup", detail: "Firebase yapılandırılmamış.", fix: "firebase-applet-config.json ekle.", purpose: "Ajanda/e-posta/dosya/tablo.", lane: "personal-ops" }
      : { id: "google", title: "Google (Drive/Sheets/Takvim/Gmail)", status: "needs-setup", detail: "Oturum kapalı.", fix: "İlgili sekmede ‘Sign in with Google’.", purpose: "Ajanda/e-posta/dosya/tablo.", lane: "personal-ops" };

  const allRows = [...rows, googleRow];
  const githubNeedsSetup = rows.find((r) => r.id === "github")?.status !== "ok";

  // Compact (<3000 char) snapshot of the full health matrix for the eCy specialist
  // (triage worst-first + step-by-step fix). Long detail/fix are trimmed.
  const buildContext = () =>
    JSON.stringify(
      allRows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        detail: (r.detail || "").slice(0, 160),
        fix: r.fix ? r.fix.slice(0, 160) : undefined,
        purpose: (r.purpose || "").slice(0, 120),
        lane: r.lane,
      }))
    ).slice(0, 2800);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Plug className="w-4 h-4 text-cyan-300" />
        <span>Entegrasyonlar — sağlık &amp; bağlantı</span>
        <button onClick={load} disabled={busy} className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Yenile
        </button>
      </div>

      <AssistDrawer panelId="integrations" context={buildContext} label="eCy ile düzelt" disabled={busy || rows.length === 0} />

      {githubNeedsSetup && (
        <div className="rounded border border-cyan-800 bg-cyan-950/20 p-3 space-y-2">
          <div className="text-xs text-cyan-200">GitHub'ı 0-paste bağla — gh CLI oturumundan token'ı çeker (Actions/arama/log/dispatch açılır).</div>
          <div className="flex gap-2">
            <button onClick={autoconnect} disabled={connecting} className="flex items-center gap-1 px-3 py-1.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950/40 text-sm disabled:opacity-40">
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} GitHub'ı otomatik bağla (gh CLI)
            </button>
            <input value={pat} onChange={(e: ChangeEvent<HTMLInputElement>) => setPat(e.target.value)} type="password" placeholder="…veya PAT yapıştır (ghp_…)"
              className="flex-1 px-2 py-1.5 rounded border border-slate-600 bg-slate-900 text-xs text-slate-200 font-mono" />
            <button onClick={savePat} disabled={!pat.trim()} className="px-3 py-1.5 rounded border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40">Kaydet</button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-slate-800 rounded border border-slate-700">
        {allRows.map((r) => {
          const s = STYLE[r.status];
          return (
            <li key={r.id} className="px-3 py-2 flex items-start gap-3">
              <s.icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.cls}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200">{r.title}</span>
                  <span className={`text-[9px] font-mono px-1 rounded border border-current ${s.cls}`}>{s.label}</span>
                  <span className="text-[10px] text-slate-600">{r.lane}</span>
                </div>
                <div className="text-[11px] text-slate-400">{r.detail}</div>
                <div className="text-[10px] text-slate-500">amaç: {r.purpose}</div>
                {r.fix && <div className="text-[10px] text-amber-400 font-mono mt-0.5">→ {r.fix}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
