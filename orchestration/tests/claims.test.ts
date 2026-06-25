import { describe, it, expect } from "vitest";
import { mkdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseClaims, foldClaims, isActive, isStale, activeClaims,
  detectCollision, nextFence, claimKey, withLock, type ClaimEvent,
} from "../bin/lib/claims";

const T0 = 1_700_000_000_000; // sabit epoch (deterministik)
const ev = (o: Partial<ClaimEvent>): ClaimEvent => ({
  ts: T0, tab: "tabA", pid: 1, lane: "orchestration", version: "vO7",
  status: "claimed", ttlMs: 1_200_000, fence: 1, ...o,
});

describe("parseClaims", () => {
  it("geçerli satırları ayrıştırır, bozuk/eksik satırı atlar (graceful)", () => {
    const jsonl = [
      JSON.stringify(ev({})),
      "{bozuk json",
      JSON.stringify({ ts: T0, foo: "claim değil" }), // zorunlu alan yok → atla
      JSON.stringify(ev({ tab: "tabB", version: "vO8" })),
      "",
    ].join("\n");
    const out = parseClaims(jsonl);
    expect(out).toHaveLength(2);
    expect(out[0].tab).toBe("tabA");
    expect(out[1].version).toBe("vO8");
  });
});

describe("claimKey", () => {
  it("lane|version", () => expect(claimKey("frontend", "vF9")).toBe("frontend|vF9"));
});

describe("foldClaims (LWW)", () => {
  it("aynı key'de en güncel ts kazanır", () => {
    const m = foldClaims([
      ev({ ts: T0, status: "claimed" }),
      ev({ ts: T0 + 5000, status: "released" }),
    ]);
    expect(m.get("orchestration|vO7")!.status).toBe("released");
  });
  it("ts eşit → yüksek fence kazanır", () => {
    const m = foldClaims([
      ev({ ts: T0, fence: 1, tab: "tabA" }),
      ev({ ts: T0, fence: 2, tab: "tabB" }),
    ]);
    expect(m.get("orchestration|vO7")!.tab).toBe("tabB");
  });
  it("idempotent — birebir aynı event tek sayılır", () => {
    const e = ev({});
    const m = foldClaims([e, { ...e }]);
    expect(m.size).toBe(1);
  });
});

describe("isActive / isStale", () => {
  it("claimed + ttl içinde → aktif, stale değil", () => {
    const c = ev({ ts: T0 });
    expect(isActive(c, T0 + 600_000)).toBe(true);
    expect(isStale(c, T0 + 600_000)).toBe(false);
  });
  it("claimed + ttl aşıldı → stale, aktif değil", () => {
    const c = ev({ ts: T0, ttlMs: 1000 });
    expect(isActive(c, T0 + 2000)).toBe(false);
    expect(isStale(c, T0 + 2000)).toBe(true);
  });
  it("done/released → ne aktif ne stale", () => {
    expect(isActive(ev({ status: "done" }), T0)).toBe(false);
    expect(isStale(ev({ status: "released" }), T0 + 9_999_999)).toBe(false);
  });
});

describe("activeClaims", () => {
  it("fold + yalnız canlı claimed döner", () => {
    const evs = [
      ev({ lane: "orchestration", version: "vO7", ts: T0 }),
      ev({ lane: "frontend", version: "vF9", ts: T0, status: "done" }),
      ev({ lane: "cli", version: "v11", ts: T0, ttlMs: 1000 }), // expired @ now
    ];
    const a = activeClaims(evs, T0 + 5000);
    expect(a.map((c) => c.version)).toEqual(["vO7"]);
  });
});

describe("detectCollision", () => {
  const evs = [ev({ tab: "tabA", lane: "orchestration", version: "vO7", ts: T0 })];
  it("başka tab aynı lane|version canlı → çakışma döner", () => {
    const c = detectCollision(evs, "orchestration", "vO7", "tabB", T0 + 1000);
    expect(c?.tab).toBe("tabA");
  });
  it("aynı tab (kendi claim'i) → çakışma yok", () => {
    expect(detectCollision(evs, "orchestration", "vO7", "tabA", T0 + 1000)).toBeNull();
  });
  it("expired claim → çakışma yok", () => {
    const old = [ev({ tab: "tabA", version: "vO7", ts: T0, ttlMs: 1000 })];
    expect(detectCollision(old, "orchestration", "vO7", "tabB", T0 + 5000)).toBeNull();
  });
  it("done claim → çakışma yok", () => {
    const done = [ev({ tab: "tabA", version: "vO7", status: "done" })];
    expect(detectCollision(done, "orchestration", "vO7", "tabB", T0 + 1000)).toBeNull();
  });
});

describe("nextFence (monoton)", () => {
  it("key'in max fence + 1", () => {
    const evs = [ev({ fence: 1 }), ev({ fence: 3 }), ev({ lane: "x", version: "y", fence: 9 })];
    expect(nextFence(evs, "orchestration", "vO7")).toBe(4);
  });
  it("hiç claim yok → 1", () => {
    expect(nextFence([], "frontend", "vF9")).toBe(1);
  });
});

describe("withLock — lock alınamazsa fn() çalışmaz (Faz11B ERR-ORCH-013)", () => {
  it("lockDir başkasınca tutuluyorken (non-stale) throw eder, fn ÇAĞRILMAZ", () => {
    const lockDir = join(tmpdir(), `claims-lock-test-${process.pid}-${T0}`);
    mkdirSync(lockDir); // taze mtime=now → non-stale → "başkası tutuyor" simülasyonu
    let called = false;
    try {
      expect(() => withLock(lockDir, () => { called = true; return 1; })).toThrow();
    } finally {
      try { rmdirSync(lockDir); } catch { /* zaten gitti */ }
    }
    expect(called).toBe(false); // BUG: held=false olsa bile fn çağrılırdı
  });
});
