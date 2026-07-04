// bin/fleet-watch.ts contract tests — the watcher's claims-view: it derives the 🟢RUN/⚪idle flag from
// activeClaims(readClaims(defaultStore(SEYIR_DIR)), now) keyed as `${lane}.${version}` (stream.slot).
// The render/tail helpers are thin IO; the testable contract is the ts/TTL/LWW filtering below.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { defaultStore, readClaims, activeClaims, type ClaimEvent, type ClaimStore } from "../bin/lib/claims";

const T0 = 1_700_000_000_000; // fixed epoch (deterministic)
const ev = (o: Partial<ClaimEvent>): ClaimEvent => ({
  ts: T0, tab: "fleet-worker", pid: 1, lane: "typescript-core", version: "terminal",
  status: "claimed", ttlMs: 1_200_000, fence: 1, ...o,
});

// exactly the bin's derivation (fleet-watch.ts render()):
const runningKeys = (store: ClaimStore, now: number): Set<string> =>
  new Set(activeClaims(readClaims(store), now).map((c) => `${c.lane}.${c.version}`));

describe("fleet-watch — RUN/idle derivation from the claim ledger", () => {
  let dir: string;
  let store: ClaimStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleet-watch-"));
    store = defaultStore(dir);
    mkdirSync(dirname(store.ledgerPath), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeLedger = (events: ClaimEvent[]) =>
    writeFileSync(store.ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  it("no ledger file yet → no active claims → every slot shows idle", () => {
    expect(readClaims(store)).toEqual([]);
    expect(runningKeys(store, T0).size).toBe(0);
  });

  it("fresh claimed → 🟢RUN; TTL-expired and done claims → ⚪idle", () => {
    writeLedger([
      ev({ lane: "typescript-core", version: "terminal", ts: T0 }),                    // fresh
      ev({ lane: "shell-harden", version: "iterm2", ts: T0 - 10_000, ttlMs: 1000 }),   // expired
      ev({ lane: "test-coverage", version: "terminal", status: "done", ts: T0 }),      // finished
    ]);
    const keys = runningKeys(store, T0 + 1000);
    expect(keys.has("typescript-core.terminal")).toBe(true);
    expect(keys.has("shell-harden.iterm2")).toBe(false);
    expect(keys.has("test-coverage.terminal")).toBe(false);
    expect(keys.size).toBe(1);
  });

  it("the SAME slot flips RUN → idle as the clock passes its TTL (live-loop behavior)", () => {
    writeLedger([ev({ ts: T0, ttlMs: 5000 })]);
    expect(runningKeys(store, T0 + 1000).has("typescript-core.terminal")).toBe(true);
    expect(runningKeys(store, T0 + 6000).has("typescript-core.terminal")).toBe(false);
  });

  it("LWW: a later released event beats the earlier claimed one (worker finished → idle)", () => {
    writeLedger([
      ev({ ts: T0, fence: 1 }),
      ev({ ts: T0 + 2000, fence: 2, status: "released" }),
    ]);
    expect(runningKeys(store, T0 + 3000).size).toBe(0);
  });

  it("a corrupt ledger line is skipped gracefully (watcher never crashes mid-fleet)", () => {
    writeFileSync(store.ledgerPath, JSON.stringify(ev({})) + "\n{corrupt json\n");
    expect(runningKeys(store, T0 + 1000).has("typescript-core.terminal")).toBe(true);
  });
});
