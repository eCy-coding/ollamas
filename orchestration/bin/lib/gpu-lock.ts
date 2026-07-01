// gpu-lock — a FAIR, FIFO, starvation-free cross-process lock for the single local GPU.
//
// PROVEN basis (not invented): the ticket lock / Lamport bakery algorithm — a monotonic `next` ticket
// dispenser + a `serving` counter; a waiter is served only when serving === its ticket, so requests are
// granted in strict arrival order (FIFO) and no waiter can be starved. This replaces the earlier
// claim-retry mutex, which was unfair (whoever re-polled at the right instant won → late agents starved
// 6+ min). Sources: ticket lock (Linux kernel spinlocks), Lamport bakery (textbook starvation-free);
// fair-scheduling need — Node worker-pool starvation guidance (per-class limits + FIFO).
//
// The pure core (takeTicket/advance/isServed/shouldForceAdvance) is IO-free and unit-tested for the FIFO
// + starvation-free properties. The thin IO layer persists {next,serving,holder,heldSince} under an atomic
// mkdir lock (reused from claims.ts) so it works across the separate agent processes.

import { withLock } from "./claims";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface TicketState { next: number; serving: number; holder?: string | null; heldSince?: number | null; }

/** Dispense the next ticket (monotonic). Returns the new state + the caller's ticket number. */
export function takeTicket(s: TicketState): { state: TicketState; ticket: number } {
  const ticket = s.next;
  return { state: { ...s, next: s.next + 1 }, ticket };
}
/** A ticket is served iff it equals the serving counter (strict FIFO order). */
export function isServed(s: TicketState, ticket: number): boolean {
  return s.serving === ticket;
}
/** Advance to the next ticket (release): serving++ and clear the holder. */
export function advance(s: TicketState): TicketState {
  return { ...s, serving: s.serving + 1, holder: null, heldSince: null };
}
/** Force-advance guard: the current holder died without releasing (heartbeat older than ttl) → skip it,
 *  so a crashed holder can never permanently block the queue (liveness). */
export function shouldForceAdvance(s: TicketState, now: number, ttlMs: number): boolean {
  return s.holder != null && s.heldSince != null && now - s.heldSince > ttlMs;
}

const DEFAULT: TicketState = { next: 0, serving: 0, holder: null, heldSince: null };
function stateFile(dir: string): string { return join(dir, "gpu-lock.json"); }
function read(dir: string): TicketState {
  const f = stateFile(dir);
  if (!existsSync(f)) return { ...DEFAULT };
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(f, "utf8")) }; } catch { return { ...DEFAULT }; }
}
function write(dir: string, s: TicketState): void {
  mkdirSync(dirname(stateFile(dir)), { recursive: true });
  writeFileSync(stateFile(dir), JSON.stringify(s));
}
function lockDir(dir: string): string { return join(dir, ".gpu-lock.lock"); }

/** Pull a ticket atomically (my place in the FIFO queue). */
export function pullTicket(dir: string): number {
  return withLock(lockDir(dir), () => {
    const { state, ticket } = takeTicket(read(dir));
    write(dir, state);
    return ticket;
  });
}
/** Try to claim my turn. Returns true when serving===ticket (I now hold the GPU). Force-advances a dead
 *  holder. Call in a poll loop until true; renew() while working so my hold isn't force-advanced. */
export function tryTurn(dir: string, ticket: number, id: string, now: number, ttlMs: number): boolean {
  return withLock(lockDir(dir), () => {
    let s = read(dir);
    if (shouldForceAdvance(s, now, ttlMs) && s.serving !== ticket) { s = advance(s); write(dir, s); return false; }
    if (isServed(s, ticket)) { s = { ...s, holder: id, heldSince: now }; write(dir, s); return true; }
    return false;
  });
}
/** Heartbeat while holding (keeps heldSince fresh so a long-but-alive job isn't force-advanced). */
export function renewTurn(dir: string, ticket: number, now: number): void {
  withLock(lockDir(dir), () => { const s = read(dir); if (s.serving === ticket) write(dir, { ...s, heldSince: now }); });
}
/** Release my turn (serving++). Only advances if I am the one being served (idempotent-safe). */
export function releaseTurn(dir: string, ticket: number): void {
  withLock(lockDir(dir), () => { const s = read(dir); if (s.serving === ticket) write(dir, advance(s)); });
}
