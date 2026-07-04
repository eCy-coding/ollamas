import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  takeTicket, isServed, advance, shouldForceAdvance,
  pullTicket, tryTurn, renewTurn, releaseTurn,
  type TicketState,
} from "../bin/lib/gpu-lock";

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

// ── thin IO layer (persisted state under an atomic mkdir lock; `now` injected → deterministic) ────────

const T0 = 1_700_000_000_000; // fixed epoch
const TTL = 30_000;
const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gpu-lock-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* gone */ } }
});
const readState = (dir: string): TicketState =>
  JSON.parse(readFileSync(join(dir, "gpu-lock.json"), "utf8"));

describe("pullTicket — atomic FIFO ticket dispenser across calls", () => {
  it("dispenses monotonic tickets and persists next", () => {
    const dir = tmpDir();
    expect(pullTicket(dir)).toBe(0);
    expect(pullTicket(dir)).toBe(1);
    expect(pullTicket(dir)).toBe(2);
    expect(readState(dir).next).toBe(3);
    expect(readState(dir).serving).toBe(0);
  });
});

describe("tryTurn / releaseTurn — two ticket holders SERIALIZE (never both hold)", () => {
  it("B cannot claim while A holds; B gets the turn only after A releases", () => {
    const dir = tmpDir();
    const a = pullTicket(dir); // 0
    const b = pullTicket(dir); // 1
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true);   // A holds the GPU
    expect(tryTurn(dir, b, "agentB", T0 + 1000, TTL)).toBe(false); // B must wait — serialized
    expect(readState(dir).holder).toBe("agentA");            // A's hold untouched by B's attempt
    releaseTurn(dir, a);
    expect(tryTurn(dir, b, "agentB", T0 + 2000, TTL)).toBe(true);  // now B is served
    expect(readState(dir).holder).toBe("agentB");
  });
  it("FIFO: three waiters are served strictly in pull order", () => {
    const dir = tmpDir();
    const tickets = [pullTicket(dir), pullTicket(dir), pullTicket(dir)];
    const servedOrder: number[] = [];
    for (let step = 0; step < 3; step++) {
      for (const t of [...tickets].reverse()) { // probe out of order on purpose
        if (!servedOrder.includes(t) && tryTurn(dir, t, `agent${t}`, T0 + step * 1000, TTL)) {
          servedOrder.push(t);
          releaseTurn(dir, t);
        }
      }
    }
    expect(servedOrder).toEqual(tickets); // arrival order, no skipping
  });
  it("re-claiming my own served turn is idempotent (returns true, refreshes heartbeat)", () => {
    const dir = tmpDir();
    const a = pullTicket(dir);
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true);
    expect(tryTurn(dir, a, "agentA", T0 + 500, TTL)).toBe(true);
    expect(readState(dir).heldSince).toBe(T0 + 500);
  });
});

describe("stale-ticket expiry — a dead holder is force-advanced (liveness)", () => {
  it("holder past ttl is skipped so the next waiter gets the GPU", () => {
    const dir = tmpDir();
    const a = pullTicket(dir);
    const b = pullTicket(dir);
    expect(tryTurn(dir, a, "deadAgent", T0, TTL)).toBe(true); // A holds then "crashes"
    // first attempt past the ttl force-advances (returns false), second claims the turn
    expect(tryTurn(dir, b, "agentB", T0 + TTL + 1, TTL)).toBe(false);
    expect(tryTurn(dir, b, "agentB", T0 + TTL + 2, TTL)).toBe(true);
    expect(readState(dir).holder).toBe("agentB");
    expect(readState(dir).serving).toBe(b);
  });
  it("renewTurn keeps a long-but-alive holder from being force-advanced", () => {
    const dir = tmpDir();
    const a = pullTicket(dir);
    const b = pullTicket(dir);
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true);
    renewTurn(dir, a, T0 + TTL - 1000); // heartbeat just before expiry
    expect(readState(dir).heldSince).toBe(T0 + TTL - 1000);
    // at T0+TTL+1 the ORIGINAL heldSince would be stale, but the renewed one is fresh
    expect(tryTurn(dir, b, "agentB", T0 + TTL + 1, TTL)).toBe(false);
    expect(readState(dir).serving).toBe(a); // A still being served
    expect(readState(dir).holder).toBe("agentA");
  });
  it("renewTurn for a ticket not being served is a no-op", () => {
    const dir = tmpDir();
    const a = pullTicket(dir);
    const b = pullTicket(dir);
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true);
    renewTurn(dir, b, T0 + 5000);
    expect(readState(dir).heldSince).toBe(T0); // untouched
  });
});

describe("releaseTurn — double-release safety (idempotent)", () => {
  it("a second release does NOT over-advance serving past the next waiter", () => {
    const dir = tmpDir();
    const a = pullTicket(dir); // 0
    const b = pullTicket(dir); // 1
    const c = pullTicket(dir); // 2
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true);
    releaseTurn(dir, a);
    releaseTurn(dir, a); // double release — must be a no-op
    expect(readState(dir).serving).toBe(1);
    expect(tryTurn(dir, c, "agentC", T0 + 1000, TTL)).toBe(false); // C did NOT jump the queue
    expect(tryTurn(dir, b, "agentB", T0 + 1000, TTL)).toBe(true);  // B is next, as owed
  });
  it("releasing a turn you never held is a no-op", () => {
    const dir = tmpDir();
    const a = pullTicket(dir);
    const b = pullTicket(dir);
    releaseTurn(dir, b); // b is not being served
    expect(readState(dir).serving).toBe(0);
    expect(tryTurn(dir, a, "agentA", T0, TTL)).toBe(true); // A's turn intact
  });
});
