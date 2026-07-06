import { useEffect, useRef, useState } from "react";

// Shared telemetry hook for the cockpit ops panels. Initial paint from
// GET /api/telemetry/recent, then live-tail via /api/telemetry/stream (named SSE events
// `request` + `rollup`). Client keeps a capped array; on SSE error it falls back to a poll.
// All data is already redacted server-side — no secret ever reaches the browser.

export interface RequestEventVM {
  ts: number; providerName: string; requestModel?: string; responseModel?: string;
  inputTokens: number; outputTokens: number; totalMs: number; ttftMs?: number;
  requestId: string; status: "ok" | "error"; errorType?: string; costUsd: number;
  tokPerSec?: number; stream: boolean; routeAttempt: number; fallbackFrom?: string;
}
export interface ProviderStatVM {
  provider: string; calls: number; tokPerSec: number; costPer1k: number;
  successPct: number; p95Ms: number; avgTtftMs: number;
}
export interface RollupVM {
  windowMs: number; count: number; p50TotalMs: number; p95TotalMs: number;
  p50TtftMs: number; p95TtftMs: number; errorRate: number; tokPerSec: number;
  reqPerMin: number; costPerHr: number; byProvider: ProviderStatVM[];
}

const CAP = 200;

// Append a live SSE event, deduped by requestId+ts and capped. The stream replays its recent buffer on
// (re)connect, overlapping the initial /recent snapshot (and any poll re-paint) — without dedup the same
// event is appended repeatedly, piling the feed up to CAP with duplicate rows. Pure → unit-testable.
export function mergeEvent(list: RequestEventVM[], evt: RequestEventVM, cap = CAP): RequestEventVM[] {
  if (list.some((x) => x.requestId === evt.requestId && x.ts === evt.ts)) return list;
  return [...list, evt].slice(-cap);
}

const EMPTY_ROLLUP: RollupVM = {
  windowMs: 60000, count: 0, p50TotalMs: 0, p95TotalMs: 0, p50TtftMs: 0, p95TtftMs: 0,
  errorRate: 0, tokPerSec: 0, reqPerMin: 0, costPerHr: 0, byProvider: [],
};

export function useTelemetry(): { events: RequestEventVM[]; rollup: RollupVM } {
  const [events, setEvents] = useState<RequestEventVM[]>([]);
  const [rollup, setRollup] = useState<RollupVM>(EMPTY_ROLLUP);
  const evRef = useRef<RequestEventVM[]>([]);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const paint = (list: RequestEventVM[]) => { evRef.current = list.slice(-CAP); setEvents(evRef.current); };

    fetch("/api/telemetry/recent?n=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((snap) => {
        if (closed || !snap) return;
        if (Array.isArray(snap.events)) paint(snap.events);
        if (snap.rollup) setRollup(snap.rollup);
      })
      .catch(() => {});

    const startPoll = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        fetch("/api/telemetry/recent?n=200")
          .then((r) => (r.ok ? r.json() : null))
          .then((snap) => { if (!closed && snap) { if (Array.isArray(snap.events)) paint(snap.events); if (snap.rollup) setRollup(snap.rollup); } })
          .catch(() => {});
      }, 3000);
    };

    try {
      // eslint-disable-next-line no-restricted-globals -- native SSE for the telemetry feed
      es = new EventSource("/api/telemetry/stream");
      es.addEventListener("request", (e) => {
        try {
          const evt = JSON.parse((e as MessageEvent).data) as RequestEventVM;
          const next = mergeEvent(evRef.current, evt);
          if (next === evRef.current) return; // duplicate → no re-render
          evRef.current = next;
          setEvents(evRef.current);
        } catch { /* malformed frame ignored */ }
      });
      es.addEventListener("rollup", (e) => {
        try { setRollup(JSON.parse((e as MessageEvent).data) as RollupVM); } catch { /* ignore */ }
      });
      es.onerror = () => { es?.close(); es = null; startPoll(); };
    } catch {
      startPoll();
    }

    return () => { closed = true; es?.close(); if (pollTimer) clearInterval(pollTimer); };
  }, []);

  return { events, rollup };
}
