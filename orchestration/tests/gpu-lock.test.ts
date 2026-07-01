import { describe, it, expect } from "vitest";
import { takeTicket, isServed, advance, shouldForceAdvance, type TicketState } from "../bin/lib/gpu-lock";

const S0: TicketState = { next: 0, serving: 0, holder: null, heldSince: null };

describe("ticket-lock pure core — FIFO + starvation-free (proven bakery)", () => {
  it("takeTicket dispenses monotonic tickets", () => {
    let s = S0;
    const t: number[] = [];
    for (let i = 0; i < 5; i++) { const r = takeTicket(s); s = r.state; t.push(r.ticket); }
    expect(t).toEqual([0, 1, 2, 3, 4]);
    expect(s.next).toBe(5);
  });
  it("only the ticket == serving is served (strict order)", () => {
    const s: TicketState = { ...S0, serving: 2 };
    expect(isServed(s, 2)).toBe(true);
    expect(isServed(s, 1)).toBe(false);
    expect(isServed(s, 3)).toBe(false);
  });
  it("advance serves the next ticket in order (no skipping, no starvation)", () => {
    // 3 waiters take tickets 0,1,2; each is served exactly once, strictly in arrival order
    let s = S0;
    const tickets = [0, 1, 2].map(() => { const r = takeTicket(s); s = r.state; return r.ticket; });
    const servedOrder: number[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const served = tickets.find((t) => isServed(s, t))!;
      servedOrder.push(served);
      s = advance(s);
    }
    expect(servedOrder).toEqual([0, 1, 2]); // FIFO — the exact arrival order, every waiter served
  });
  it("advance clears holder/heldSince", () => {
    const s: TicketState = { next: 3, serving: 1, holder: "x", heldSince: 100 };
    expect(advance(s)).toEqual({ next: 3, serving: 2, holder: null, heldSince: null });
  });
});

describe("shouldForceAdvance — dead-holder liveness (crashed holder cannot block forever)", () => {
  it("stale holder (heartbeat older than ttl) → force advance", () => {
    const s: TicketState = { next: 2, serving: 0, holder: "dead", heldSince: 0 };
    expect(shouldForceAdvance(s, 60_000, 30_000)).toBe(true);
  });
  it("fresh holder → do not advance", () => {
    const s: TicketState = { next: 2, serving: 0, holder: "alive", heldSince: 50_000 };
    expect(shouldForceAdvance(s, 60_000, 30_000)).toBe(false);
  });
  it("no holder → nothing to force", () => {
    expect(shouldForceAdvance(S0, 60_000, 30_000)).toBe(false);
  });
});
