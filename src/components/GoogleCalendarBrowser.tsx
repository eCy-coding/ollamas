import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

// Google Calendar (read-only) — reuses the SAME Firebase Google sign-in/token as
// Drive/Sheets (one consent, one token). Browser-side only: events go straight
// from googleapis.com to this component; nothing touches the ollamas server.
interface CalendarEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
}

const formatStart = (ev: CalendarEvent): string => {
  const raw = ev.start?.dateTime ?? ev.start?.date;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  // All-day events carry a bare date — show it without a bogus 00:00 time.
  return ev.start?.dateTime ? d.toLocaleString() : d.toLocaleDateString();
};

export function GoogleCalendarBrowser() {
  const { token, needsAuth, handleLogin, isLoggingIn, authError, resetAuth, isConfigured } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        maxResults: "20",
        orderBy: "startTime",
        singleEvents: "true",
        timeMin: new Date().toISOString(),
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) { resetAuth("Google session expired. Please sign in again."); return; }
      if (res.status === 403) {
        throw new Error("Calendar access not granted (403). Sign out and sign in again, approving the Calendar permission.");
      }
      if (!res.ok) throw new Error(`Failed to load events (${res.status}).`);
      const data = await res.json();
      setEvents(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [token, resetAuth]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  if (isConfigured === false) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Calendar className="w-12 h-12 text-status-warn mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Configure Firebase</h2>
        <p className="text-xs text-immersive-text-muted max-w-sm font-mono">Google Calendar needs the same Firebase web config as Drive (<code className="text-status-accent">firebase-applet-config.json</code>).</p>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Calendar className="w-12 h-12 text-orange-400 mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Connect Google Calendar</h2>
        <p className="text-xs text-immersive-text-muted mb-6 max-w-sm">Sign in with Google to see your upcoming agenda inside the cockpit. Read-only — one sign-in covers Drive + Sheets + Calendar + Gmail.</p>
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
          {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4 text-orange-400" />}
          <span>Sign in with Google</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg flex flex-col h-full min-h-[400px]">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-orange-400" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase flex-1">Upcoming Events</h2>
        <button
          onClick={fetchEvents}
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
        </div>
      )}

      {!busy && !error && events.length === 0 && (
        <p className="text-xs text-immersive-text-muted font-mono">No upcoming events on your primary calendar.</p>
      )}

      <div className="flex flex-col gap-2 overflow-y-auto">
        {events.map((ev) => (
          <div key={ev.id} className="border border-immersive-border rounded px-3 py-2 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-immersive-text-bright truncate">{ev.summary || "(untitled)"}</div>
              <div className="text-[10px] text-immersive-text-muted font-mono">
                {formatStart(ev)}{ev.location ? ` · ${ev.location}` : ""}
              </div>
            </div>
            {ev.htmlLink && (
              <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer" className="text-immersive-text-muted hover:text-status-accent" aria-label="Open in Google Calendar">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
