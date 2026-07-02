import { useEffect, useState } from "react";
import { Mail, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

// Gmail inbox (read-only headers) — reuses the SAME Firebase Google sign-in/token
// as Drive/Sheets/Calendar. Browser-side only, and deliberately metadata-only:
// From/Subject/Date headers are fetched, message bodies are NEVER requested
// (privacy hard law: keep the surface minimal; nothing touches the ollamas server).
interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
}

const header = (payload: any, name: string): string =>
  payload?.headers?.find((h: any) => h?.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

export function GmailBrowser() {
  const { token, needsAuth, handleLogin, isLoggingIn, authError, resetAuth, isConfigured } = useAuth();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enableUrl, setEnableUrl] = useState<string | null>(null);

  const fetchInbox = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setEnableUrl(null);
    try {
      const auth = { Authorization: `Bearer ${token}` };
      const list = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&labelIds=INBOX",
        { headers: auth },
      );
      if (list.status === 401) { resetAuth("Google session expired. Please sign in again."); return; }
      if (list.status === 403) {
        // Two distinct 403s: the API is disabled on the Google Cloud project
        // (fix = enable it in the console, a one-time owner action), or the
        // token lacks the scope (fix = re-consent). Surface the right action.
        const body = await list.text();
        if (/has not been used in project|it is disabled/.test(body)) {
          setEnableUrl(body.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"\\]+/)?.[0] ?? null);
          throw new Error("The Gmail API is disabled for this Google Cloud project. Enable it via the link below, wait a few minutes, then hit Refresh.");
        }
        throw new Error("Gmail access not granted (403). Sign out and sign in again, approving the Gmail permission.");
      }
      if (!list.ok) throw new Error(`Failed to list inbox (${list.status}).`);
      const ids: { id: string }[] = (await list.json()).messages ?? [];
      const params = "format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date";
      const details = await Promise.all(
        ids.map((m) =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?${params}`, { headers: auth })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      setMessages(
        details
          .filter(Boolean)
          .map((d: any) => ({
            id: d.id,
            from: header(d.payload, "From"),
            subject: header(d.payload, "Subject") || "(no subject)",
            date: header(d.payload, "Date"),
          })),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Fetch on token changes only (GoogleDriveBrowser idiom). Depending on the
  // fetch function itself loops: useAuth() returns fresh callbacks every render.
  useEffect(() => {
    if (token) fetchInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (isConfigured === false) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Mail className="w-12 h-12 text-status-warn mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Configure Firebase</h2>
        <p className="text-xs text-immersive-text-muted max-w-sm font-mono">Gmail needs the same Firebase web config as Drive (<code className="text-status-accent">firebase-applet-config.json</code>).</p>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Mail className="w-12 h-12 text-red-400 mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Connect Gmail</h2>
        <p className="text-xs text-immersive-text-muted mb-6 max-w-sm">Sign in with Google to see your latest inbox headers (From / Subject / Date only — bodies are never fetched). One sign-in covers Drive + Sheets + Calendar + Gmail.</p>
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
          {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-red-400" />}
          <span>Sign in with Google</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg flex flex-col h-full min-h-[400px]">
      <div className="flex items-center gap-2 mb-4">
        <Mail className="w-4 h-4 text-red-400" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase flex-1">Inbox — Latest 20 (headers only)</h2>
        <button
          onClick={fetchInbox}
          disabled={busy}
          className="text-xs text-status-accent border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded cursor-pointer transition font-mono flex items-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-status-err text-xs p-3 rounded font-mono mb-4">
          Error: {error}
          {enableUrl && (
            <a
              href={enableUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 text-status-accent underline flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Enable the Gmail API
            </a>
          )}
        </div>
      )}

      {!busy && !error && messages.length === 0 && (
        <p className="text-xs text-immersive-text-muted font-mono">Inbox looks empty.</p>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className="border border-immersive-border rounded px-3 py-2 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-immersive-text-bright truncate">{m.subject}</div>
              <div className="text-[10px] text-immersive-text-muted font-mono truncate">
                {m.from}{m.date ? ` · ${m.date}` : ""}
              </div>
            </div>
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${m.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-immersive-text-muted hover:text-status-accent"
              aria-label="Open in Gmail"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
