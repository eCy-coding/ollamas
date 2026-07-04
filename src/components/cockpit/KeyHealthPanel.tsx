import React, { useEffect, useState } from "react";
import { HeartPulse, ExternalLink } from "lucide-react";
import { api } from "../../lib/apiClient";

// Key-lifecycle cockpit panel (T9) — the missing consumer of the always-running key-health
// loop (GET /api/keys/health). Surfaces the autonomous system's state: which provider is live /
// cooled (rate-limited, auto-recovers) / invalid / absent, the keyless (0-manual) set, and the
// convergence signal. Metadata only — the endpoint carries no raw key (keyId hashing upstream),
// so nothing here can leak a secret.

interface ProviderHealth {
  provider: string;
  status: "live" | "cooled" | "invalid" | "absent";
  keyless: boolean;
  source?: string;
  signupUrl?: string;
}
interface KeyHealthSnapshot {
  providers: ProviderHealth[];
  total: number;
  live: number;
  absent: string[];
  converged: boolean;
  keylessLive: string[];
  updatedAt: number;
  degraded: boolean;
  lastError?: string;
  allCloudCooled: boolean;
}

const STATUS_TONE: Record<ProviderHealth["status"], string> = {
  live: "bg-emerald-500/15 border-emerald-500/25 text-status-ok",
  cooled: "bg-amber-500/10 border-amber-500/25 text-status-warn",
  invalid: "bg-red-500/10 border-red-500/20 text-status-err",
  absent: "bg-immersive-bg border-immersive-border text-immersive-text-dim",
};

export function KeyHealthPanel(): React.ReactElement {
  const [snap, setSnap] = useState<KeyHealthSnapshot | null>(null);
  // Defensive: a partial/empty response (or the empty-ok test stub) has no `providers` array —
  // treat it as "not ready yet" instead of crashing the render on `.map` of undefined.
  const rows = Array.isArray(snap?.providers) ? snap!.providers : null;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.get<KeyHealthSnapshot>("/api/keys/health");
        if (alive) setSnap(s);
      } catch { /* transient — next tick retries */ }
    };
    load();
    const t = setInterval(load, 5000); // autonomous loop refreshes server-side; poll surfaces it
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <HeartPulse className="w-4 h-4 text-status-accent" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Key Health — Autonomous Failover</h2>
        {rows && (
          <span className={`ml-auto text-[9px] font-mono px-2 py-0.5 rounded border ${snap!.converged ? "bg-emerald-500/15 border-emerald-500/25 text-status-ok" : "bg-immersive-bg border-immersive-border text-immersive-text-dim"}`}>
            {snap!.live}/{snap!.total} live{(snap!.keylessLive?.length ?? 0) > 0 ? ` · ${snap!.keylessLive.length} keyless` : ""}
          </span>
        )}
      </div>

      {snap?.degraded && (
        <div className="text-[10px] font-mono text-status-warn mb-2">⚠ heal loop degraded — snapshot stale{snap.lastError ? `: ${snap.lastError}` : ""}</div>
      )}
      {snap?.allCloudCooled && (
        <div className="text-[10px] font-mono text-status-err bg-red-500/10 border border-red-500/20 rounded px-2 py-1 mb-2">
          ⛑ all cloud keys cooled — serving from the keyless + local-Ollama terminal tier (auto-recovers as cooldowns expire)
        </div>
      )}

      {!rows ? (
        <div className="text-[11px] text-immersive-text-dim font-mono py-4 text-center">Loading key-health snapshot…</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((p) => (
            <span key={p.provider} className={`text-[9px] font-mono px-2 py-0.5 rounded border ${STATUS_TONE[p.status]} flex items-center gap-1`}>
              <strong>{p.provider}</strong> {p.status}
              {/* No opacity here: 70% alpha on status-colored 9px text can't reach WCAG AA
                  contrast on the light badge background (axe color-contrast, serious). */}
              {p.keyless && <span>·0-manual</span>}
              {p.status !== "live" && p.signupUrl && (
                <a href={p.signupUrl} target="_blank" rel="noopener noreferrer"
                  className="text-status-accent hover:underline inline-flex items-center gap-0.5 no-underline">
                  <ExternalLink className="w-2.5 h-2.5" /> key
                </a>
              )}
            </span>
          ))}
        </div>
      )}
      <p className="text-[9px] font-mono text-immersive-text-dim mt-3">
        cooled = rate-limited, auto-recovers when the cooldown expires · terminal fallback = local Ollama · metadata only, no raw keys
      </p>
    </div>
  );
}
