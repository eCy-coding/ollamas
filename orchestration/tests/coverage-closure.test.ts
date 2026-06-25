/**
 * coverage-closure.test.ts — vO13: critic'in (CRITIC.json) flag'lediği test'siz export'ları kapatır.
 * Yeni dosya (mevcut test'leri düzenlemez → çoklu-worker collision yok). Yalnız TRACKED lib export'ları.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultStore, readClaims, acquireClaim, renewClaim, closeClaim, detectCollision } from "../bin/lib/claims";
import { declaredVersion, checkBranchCoherence } from "../bin/lib/driftguard";
import { parseHistory, lastSnapshot } from "../bin/lib/trend";
import { stddev } from "../bin/lib/bench";
import { getPersona } from "../bin/lib/personas";
import { isAllowedCmd, nudge } from "../bin/lib/signal";

// ── claims.ts I/O wrappers (vO7 — pure çekirdek test'liydi, I/O değildi) ──────
describe("claims I/O (tmp store round-trip)", () => {
  it("acquire→read→collision→close→re-acquire", () => {
    const store = defaultStore(mkdtempSync(join(tmpdir(), "ccov-claims-")));
    const a = acquireClaim(store, { lane: "x", version: "v1", tab: "A", pid: 1 });
    expect(a.ok).toBe(true);
    expect(readClaims(store)).toHaveLength(1);

    const b = acquireClaim(store, { lane: "x", version: "v1", tab: "B", pid: 2 });
    expect(b.ok).toBe(false);                 // A canlı tutuyor → çakışma
    expect(b.collision?.tab).toBe("A");

    renewClaim(store, { lane: "x", version: "v1", tab: "A", pid: 1 });
    closeClaim(store, { lane: "x", version: "v1", tab: "A", pid: 1, status: "done" });

    const c = acquireClaim(store, { lane: "x", version: "v1", tab: "B", pid: 2 });
    expect(c.ok).toBe(true);                   // A done → B alabilir
  });

  it("revived stale tab cannot clobber the active holder via renewClaim (H11 real path)", () => {
    const store = defaultStore(mkdtempSync(join(tmpdir(), "ccov-h11-")));
    const T0 = 1_700_000_000_000;
    acquireClaim(store, { lane: "x", version: "v", tab: "A", pid: 1, ttlMs: 50, now: T0 });
    // A's claim goes stale (ttl 50ms); B legitimately takes over much later.
    const b = acquireClaim(store, { lane: "x", version: "v", tab: "B", pid: 2, now: T0 + 100_000 });
    expect(b.ok).toBe(true);
    // A revives and tries to renew — must be REJECTED (B holds it now); no clobber event.
    const r = renewClaim(store, { lane: "x", version: "v", tab: "A", pid: 1, now: T0 + 100_001 });
    expect(r.tab).toBe("B"); // renew returned the current holder; A did NOT win (pre-fix: A clobbered)
    // B remains the sole active holder in the folded ledger.
    expect(detectCollision(readClaims(store), "x", "v", "B", T0 + 100_002)).toBeNull();
    expect(detectCollision(readClaims(store), "x", "v", "A", T0 + 100_002)?.tab).toBe("B");
  });
});

// ── driftguard.ts (vO8) ──────────────────────────────────────────────────────
describe("driftguard declaredVersion + checkBranchCoherence", () => {
  it("declaredVersion = ROADMAP son DONE", () => {
    const md = ["| **vO5** | ✅ DONE | x |", "| vO6 | planned | y |"].join("\n");
    expect(declaredVersion(md)).toBe("vO5");
    expect(declaredVersion("versiyon yok")).toBe("");
  });
  it("checkBranchCoherence: token farkı → SOFT, eşleşme/boş → null", () => {
    expect(checkBranchCoherence("feat/x-v8", "vO8")).toBeNull();          // 8==8
    expect(checkBranchCoherence("feat/orchestration-v3", "vO8")?.severity).toBe("soft"); // 3≠8
    expect(checkBranchCoherence("feat/x", "")).toBeNull();                // sürüm yok
  });
});

// ── trend.ts (vO4.2) ─────────────────────────────────────────────────────────
describe("trend parseHistory + lastSnapshot", () => {
  it("parseHistory: geçerli satır parse, bozuk atla", () => {
    const jsonl = [
      JSON.stringify({ ts: "t1", head: "aaa", keys: [] }),
      "{bozuk",
      JSON.stringify({ ts: "t2", head: "bbb", keys: [{ key: "k", severity: "med", id: "i" }] }),
    ].join("\n");
    const h = parseHistory(jsonl);
    expect(h).toHaveLength(2);
    expect(h[1].head).toBe("bbb");
  });
  it("lastSnapshot: boş→baseline, dolu→son", () => {
    expect(lastSnapshot([]).keys).toEqual([]);
    const snaps = parseHistory([JSON.stringify({ ts: "t1", head: "a", keys: [] }), JSON.stringify({ ts: "t2", head: "z", keys: [] })].join("\n"));
    expect(lastSnapshot(snaps).head).toBe("z");
  });
});

// ── bench.ts (vO6) stddev ────────────────────────────────────────────────────
describe("bench stddev", () => {
  it("<2 değer→0, eşit→0, örnek sapma (n-1)", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
    expect(stddev([3, 3, 3])).toBe(0);
    expect(stddev([2, 4])).toBeCloseTo(1.4142, 3);   // sqrt(2)
  });
});

// ── personas.ts getPersona ───────────────────────────────────────────────────
describe("personas getPersona", () => {
  it("case-insensitive lookup; bilinmeyen→undefined", () => {
    expect(getPersona("project-architect")?.name).toBe("project-architect");
    expect(getPersona("PROJECT-ARCHITECT")?.name).toBe("project-architect");
    expect(getPersona("nope")).toBeUndefined();
  });
});

// ── signal.ts isAllowedCmd + nudge (dry-run, spawn yok) ──────────────────────
describe("signal isAllowedCmd + nudge guard", () => {
  it("allowlist kabul, injection/dışı red", () => {
    expect(isAllowedCmd("git status")).toBe(true);
    expect(isAllowedCmd("pwd")).toBe(true);
    expect(isAllowedCmd("git status; rm -rf /")).toBe(false); // injection meta-char
    expect(isAllowedCmd("rm -rf /")).toBe(false);             // allowlist dışı
  });
  it("nudge dry-run: izinsiz komut reddedilir, spawn yok", () => {
    const r = nudge({ app: "terminal", tty: "/dev/ttys000" }, "rm -rf /", { dryRun: true });
    expect(r.sent).toBe(false);
    expect(r.rejected).toBe(true);
  });
});
