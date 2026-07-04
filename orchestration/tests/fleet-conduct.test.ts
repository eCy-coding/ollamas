// bin/fleet-conduct.ts contract tests — the conductor's pure inputs: proposal extraction
// (extractOneProposal edge cases NOT covered by fleet-conduct-lib.test.ts) + the claims lifecycle the
// kill-switch/convergence logic observes (defaultStore → readClaims → activeClaims → closeClaim).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractOneProposal } from "../bin/lib/fleet-conduct-lib";
import { defaultStore, readClaims, activeClaims, acquireClaim, closeClaim, type ClaimStore } from "../bin/lib/claims";

const T0 = 1_700_000_000_000; // fixed epoch (deterministic)

describe("extractOneProposal — conductor edge cases (beyond fleet-conduct-lib.test.ts)", () => {
  it("coerces non-string message entries via String() instead of throwing", () => {
    const r = extractOneProposal([42, { not: "a string" }, "## Change: x\nsome body\nVERDICT: DONE"]);
    expect(r.startsWith("## Change: x")).toBe(true);
    expect(r.endsWith("VERDICT: DONE")).toBe(true);
  });

  it("empty messages array → empty proposal (conductor gate then rejects: no proposal content)", () => {
    expect(extractOneProposal([])).toBe("");
  });

  it("marker match is case-insensitive (## change / ## PLAN)", () => {
    expect(extractOneProposal(["noise\n## change: lower\nbody\nVERDICT: DONE"]).startsWith("## change: lower")).toBe(true);
    expect(extractOneProposal(["noise\n## PLAN: upper\nbody\nVERDICT: DONE"]).startsWith("## PLAN: upper")).toBe(true);
  });

  it("ANY VERDICT line terminates (BLOCKED too, not just DONE)", () => {
    const r = extractOneProposal(["## Change: y\nbody\nVERDICT: BLOCKED\ntrailing chatter after verdict"]);
    expect(r.endsWith("VERDICT: BLOCKED")).toBe(true);
    expect(r).not.toContain("trailing chatter");
  });

  it("chatter in FOLLOW-UP messages after the VERDICT is dropped", () => {
    const r = extractOneProposal(["## Plan: z\ndiff body long enough here\nVERDICT: DONE", "thanks! anything else?"]);
    expect(r.endsWith("VERDICT: DONE")).toBe(true);
    expect(r).not.toContain("anything else");
  });
});

describe("claims lifecycle — the conductor's convergence/kill-switch substrate (tmp store)", () => {
  let dir: string;
  let store: ClaimStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleet-conduct-claims-"));
    store = defaultStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const acquire = (lane: string, version: string) =>
    acquireClaim(store, { lane, version, tab: `fleet-${lane}-${version}`, pid: 1, ttlMs: 1_200_000, now: T0 });

  it("workers claim (stream, slot) → conductor sees them as active lane.version keys", () => {
    expect(acquire("typescript-core", "terminal").ok).toBe(true);
    expect(acquire("shell-harden", "iterm2").ok).toBe(true);
    const live = activeClaims(readClaims(store), T0 + 1000);
    expect(live.map((c) => `${c.lane}.${c.version}`).sort()).toEqual(["shell-harden.iterm2", "typescript-core.terminal"]);
  });

  it("kill-switch contract: closeClaim(released) on every live claim → zero active left", () => {
    acquire("typescript-core", "terminal");
    acquire("shell-harden", "iterm2");
    const live = activeClaims(readClaims(store), T0 + 1000);
    expect(live).toHaveLength(2);
    for (const c of live) {
      closeClaim(store, { lane: c.lane, version: c.version, tab: "fleet-conductor", pid: 2, status: "released", now: T0 + 2000 });
    }
    expect(activeClaims(readClaims(store), T0 + 3000)).toHaveLength(0); // convergence precondition: no active claims
  });

  it("released event is persisted append-only with a bumped fence (audit trail, no clobber)", () => {
    acquire("typescript-core", "terminal");
    closeClaim(store, { lane: "typescript-core", version: "terminal", tab: "fleet-conductor", pid: 2, status: "released", now: T0 + 2000 });
    const events = readClaims(store);
    expect(events).toHaveLength(2); // append-only: claim + release both present
    const rel = events.find((e) => e.status === "released")!;
    expect(rel.fence).toBeGreaterThan(events.find((e) => e.status === "claimed")!.fence);
  });

  it("a TTL-expired claim no longer counts as active (stale worker doesn't block convergence)", () => {
    acquireClaim(store, { lane: "test-coverage", version: "terminal", tab: "t", pid: 1, ttlMs: 1000, now: T0 });
    expect(activeClaims(readClaims(store), T0 + 500)).toHaveLength(1);
    expect(activeClaims(readClaims(store), T0 + 5000)).toHaveLength(0);
  });
});
