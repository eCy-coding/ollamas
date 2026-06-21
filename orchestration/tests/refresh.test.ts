import { describe, it, expect } from "vitest";
import { shouldAutoRefresh, COOLDOWN_H } from "../bin/lib/refresh";

const NOW = Date.parse("2026-06-20T12:00:00Z");
const H = 3_600_000;

describe("shouldAutoRefresh — otonom staleness self-heal kararı (PURE)", () => {
  it("bayat + server up + cooldown geçti → TAZELE", () => {
    const d = shouldAutoRefresh({ stale: true, serverUp: true, lastAttemptMs: NOW - 13 * H, nowMs: NOW, cooldownHours: 12 });
    expect(d.go).toBe(true);
    expect(d.reason).toMatch(/tazele|refresh/i);
  });
  it("taze → ATLA (gereksiz refresh yok)", () => {
    const d = shouldAutoRefresh({ stale: false, serverUp: true, lastAttemptMs: 0, nowMs: NOW, cooldownHours: 12 });
    expect(d.go).toBe(false);
    expect(d.reason).toMatch(/taze|fresh/i);
  });
  it("bayat ama server kapalı → ATLA + bench-lane'e devir (orchestration heavy-bench koşmaz)", () => {
    const d = shouldAutoRefresh({ stale: true, serverUp: false, lastAttemptMs: 0, nowMs: NOW, cooldownHours: 12 });
    expect(d.go).toBe(false);
    expect(d.reason).toMatch(/server|bench-lane|devir/i);
  });
  it("bayat + up ama cooldown aktif → ATLA (debounce: thrash yok)", () => {
    const d = shouldAutoRefresh({ stale: true, serverUp: true, lastAttemptMs: NOW - 1 * H, nowMs: NOW, cooldownHours: 12 });
    expect(d.go).toBe(false);
    expect(d.reason).toMatch(/cooldown|debounce/i);
  });
  it("deterministik — aynı girdi aynı çıktı (Date.now yok)", () => {
    const i = { stale: true, serverUp: true, lastAttemptMs: NOW - 13 * H, nowMs: NOW, cooldownHours: 12 };
    expect(shouldAutoRefresh(i)).toEqual(shouldAutoRefresh(i));
  });
  it("COOLDOWN_H makul varsayılan (>0)", () => {
    expect(COOLDOWN_H).toBeGreaterThan(0);
  });
});
