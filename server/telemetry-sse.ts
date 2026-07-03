// server/telemetry-sse.ts — thin SSE framing + snapshot helpers for the telemetry cockpit
// feed. Events are ALREADY redacted at record time (telemetry.ts), so this layer only frames
// and snapshots — no secret ever reaches it un-redacted. Pure/testable; the route in server.ts
// wires the live stream (replay buffer + subscribe + 1s rollup tick).
import { recentEvents, rollup, type RequestEvent, type Rollup } from "./telemetry";

/** One named SSE frame: `event: <name>\ndata: <json>\n\n`. Named events let the cockpit's
 *  EventSource use addEventListener("request") / ("rollup") on a single connection. */
export function formatTelemetryFrame(name: "request" | "rollup", data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface TelemetrySnapshot { events: RequestEvent[]; rollup: Rollup }

/** Snapshot for GET /api/telemetry/recent — last-n events (redacted) + a rollup over them.
 *  Used for the cockpit's initial paint and by tests. */
export function telemetrySnapshot(n: number, nowMs: number): TelemetrySnapshot {
  const events = recentEvents(n);
  return { events, rollup: rollup(events, nowMs) };
}
