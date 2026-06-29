import { useState } from "react";
import { Sheet, Loader2, ExternalLink, Upload } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

// Google Sheets (#3) — reuses the SAME Firebase Google sign-in/token as Drive (one
// consent grants Drive + Sheets). "Export" creates a fresh spreadsheet and fills it
// with a live ollamas snapshot (/api/health), proving Sheets write access e2e.
export function GoogleSheetsBrowser() {
  const { token, needsAuth, handleLogin, isLoggingIn, authError, resetAuth, isConfigured } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  // Flatten a live /api/health snapshot into a 2-column [metric, value] table.
  const buildRows = async (): Promise<string[][]> => {
    const h = await fetch("/api/health").then((r) => r.json()).catch(() => ({}));
    const rows: string[][] = [["ollamas snapshot", new Date().toISOString()], ["metric", "value"]];
    if (h?.metrics) {
      rows.push(["CPU load (1m)", String(h.metrics.cpuLoad1Min ?? "")]);
      rows.push(["RAM used %", String(h.metrics.memory?.percentageUsed ?? "")]);
      rows.push(["Ollama version", String(h.metrics.ollamaVersion ?? "")]);
    }
    rows.push(["mode", String(h?.mode ?? "")]);
    for (const m of h?.metrics?.loadedModels ?? []) {
      rows.push([`loaded model`, `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`]);
    }
    return rows;
  };

  const handleExport = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setSheetUrl(null);
    try {
      const rows = await buildRows();
      // 1. Create a new spreadsheet.
      const create = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title: `ollamas snapshot ${new Date().toLocaleString()}` } }),
      });
      if (create.status === 401) { resetAuth("Google session expired. Please sign in again."); return; }
      if (create.status === 403) {
        const body = await create.text();
        throw new Error(`Sheets access not granted (403). Re-sign-in and approve the Sheets permission. ${body.slice(0, 200)}`);
      }
      if (!create.ok) throw new Error(`Failed to create spreadsheet (${create.status}).`);
      const ss = await create.json();
      const id: string = ss.spreadsheetId;
      // 2. Write the snapshot rows.
      const write = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: rows }),
        },
      );
      if (!write.ok) throw new Error(`Spreadsheet created but writing values failed (${write.status}).`);
      setSheetUrl(ss.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (isConfigured === false) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Sheet className="w-12 h-12 text-status-warn mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Configure Firebase</h2>
        <p className="text-xs text-immersive-text-muted max-w-sm font-mono">Google Sheets needs the same Firebase web config as Drive (<code className="text-status-accent">firebase-applet-config.json</code>).</p>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Sheet className="w-12 h-12 text-green-400 mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Connect Google Sheets</h2>
        <p className="text-xs text-immersive-text-muted mb-6 max-w-sm">Sign in with Google to export live ollamas data into your spreadsheets. One sign-in covers Drive + Sheets.</p>
        {authError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-status-err text-xs px-4 py-3 rounded mb-6 max-w-md font-mono text-left">
            <strong>Authentication Error:</strong> {authError}
          </div>
        )}
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="bg-immersive-bg text-immersive-text-dim border border-immersive-border rounded px-4 py-2 flex items-center gap-2 hover:bg-immersive-bg transition cursor-pointer font-medium text-sm disabled:opacity-50"
        >
          {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sheet className="w-4 h-4 text-green-400" />}
          <span>Sign in with Google</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg flex flex-col h-full min-h-[400px]">
      <div className="flex items-center gap-2 mb-4">
        <Sheet className="w-4 h-4 text-green-400" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Google Sheets Export</h2>
      </div>

      <p className="text-xs text-immersive-text-muted mb-4 max-w-md">Create a new Google Sheet filled with a live ollamas snapshot (system metrics + loaded models from <code className="text-status-accent">/api/health</code>).</p>

      <button
        onClick={handleExport}
        disabled={busy}
        className="self-start text-xs text-status-accent border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded cursor-pointer transition font-mono flex items-center gap-2 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        Export snapshot to a new Sheet
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-status-err text-xs p-3 rounded font-mono mt-4">
          Error: {error}
        </div>
      )}

      {sheetUrl && (
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 text-xs text-status-ok border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 rounded font-mono flex items-center gap-2 self-start"
        >
          <ExternalLink className="w-3 h-3" />
          Sheet created — open in Google Sheets
        </a>
      )}
    </div>
  );
}
