import { describe, it, expect } from "vitest";
import {
  stateHash, shouldNotify, staleLanes, tickDecision, reqToConductAction, readinessAlert,
  type ConductAction, type LaneAge,
} from "../bin/lib/heartbeat";
import type { ClaimEvent } from "../bin/lib/claims";
import { CLAIMS, readActiveClaims } from "../bin/heartbeat";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const action = (tier: string, lane: string, sev = 50): ConductAction =>
  ({ tier, lane, kind: `${tier.toLowerCase()}:${lane}`, detail: `${lane} detail`, action: `${lane}: do`, severity: sev });

const claim = (lane: string, now: number): ClaimEvent =>
  ({ ts: now, tab: "other", pid: 999, lane, version: "vX", status: "claimed", ttlMs: 20 * 60_000, fence: 1 });

describe("stateHash + shouldNotify", () => {
  it("deterministik (aynı girdi → aynı hash)", () => {
    const a = action("ROADMAP", "cli");
    expect(stateHash(a, ["frontend"])).toBe(stateHash(a, ["frontend"]));
  });
  it("farklı girdi → farklı hash", () => {
    expect(stateHash(action("ROADMAP", "cli"), [])).not.toBe(stateHash(action("ROADMAP", "frontend"), []));
  });
  it("null action + stale sırası bağımsız", () => {
    expect(stateHash(null, ["a", "b"])).toBe(stateHash(null, ["b", "a"]));
  });
  it("shouldNotify: değişince true, aynıysa false", () => {
    expect(shouldNotify("abc", "def")).toBe(true);
    expect(shouldNotify("abc", "abc")).toBe(false);
  });
});

describe("staleLanes", () => {
  it("eşik üstü idle → stuck; altı → değil", () => {
    const lanes: LaneAge[] = [
      { lane: "frontend", ageHours: 10, idle: true },
      { lane: "cli", ageHours: 2, idle: true },
      { lane: "backend", ageHours: 99, idle: false }, // idle değil
    ];
    expect(staleLanes(lanes, 6)).toEqual(["frontend"]);
  });
  it("Infinity ageHours (commit yok) guard → dahil değil", () => {
    expect(staleLanes([{ lane: "x", ageHours: Infinity, idle: true }], 6)).toEqual([]);
  });
});

describe("tickDecision — collision-aware (0 manuel seçim, çakışmasız)", () => {
  const now = 1_000_000;
  const findings = [action("ROADMAP", "cli", 10), action("STALE", "frontend", 40), action("SECURITY", "global", 90)];
  it("claim yok → conduct-action aynen", () => {
    const r = tickDecision(action("SECURITY", "global", 90), findings, [], []);
    expect(r.action?.lane).toBe("global");
    expect(r.claimedElsewhere).toBe(false);
  });
  it("conduct-action lane claim'li → sonraki claim'siz öncelikli seçilir", () => {
    // global SECURITY claim'li → sonraki: STALE:frontend (claim'siz)
    const r = tickDecision(action("SECURITY", "global", 90), findings, [claim("global", now)], []);
    expect(r.claimedElsewhere).toBe(true);
    expect(r.action?.lane).toBe("frontend"); // cli değil — STALE(40) > ROADMAP(10) severity sırası
  });
  it("hepsi claim'li → null (idle)", () => {
    const r = tickDecision(action("SECURITY", "global", 90), findings,
      [claim("global", now), claim("cli", now), claim("frontend", now)], []);
    expect(r.action).toBeNull();
    expect(r.notifyMsg).toMatch(/idle|claim/i);
  });
  it("notifyMsg stuck listesi içerir", () => {
    const r = tickDecision(action("ROADMAP", "cli", 10), findings, [], ["frontend", "scripts"]);
    expect(r.notifyMsg).toMatch(/stuck=\[frontend,scripts\]/);
  });
});

describe("reqToConductAction — vO14 fuse→heartbeat adapter", () => {
  it("fuse Requirement → ConductAction (collision-safe alanlar dolu)", () => {
    const a = reqToConductAction({ criticality: "CRITICAL", source: "quality", target: "gate:backend", detail: "backend test FAILED", action: "düzelt", score: 100 });
    expect(a).toMatchObject({ tier: "CRITICAL", lane: "backend", kind: "gate:backend", severity: 100 });
    expect(a?.action).toBe("düzelt");
  });
  it("çok-segment target → son segment lane", () => {
    expect(reqToConductAction({ criticality: "COMPLETENESS", target: "dod:code-without-test:lib/personas.ts", detail: "d", action: "a" })?.lane).toBe("lib/personas.ts");
  });
  it("target tek-kelime → orchestration lane", () => {
    expect(reqToConductAction({ criticality: "DRIFT", target: "drift", detail: "d", action: "a" })?.lane).toBe("orchestration");
  });
  it("null → null", () => {
    expect(reqToConductAction(null)).toBeNull();
  });
  it("score yok → default 50", () => {
    expect(reqToConductAction({ criticality: "STALE", target: "stale:cli", detail: "d", action: "a" })?.severity).toBe(50);
  });
});

describe("readinessAlert — vO14 readiness gate", () => {
  it("eşik altı → alert", () => {
    expect(readinessAlert(0)).toMatch(/HAZIR DEĞİL.*0\/100/);
    expect(readinessAlert(69)).toMatch(/HAZIR DEĞİL/);
  });
  it("eşik üstü → boş", () => {
    expect(readinessAlert(70)).toBe("");
    expect(readinessAlert(100)).toBe("");
  });
});

describe("vO14 collision-safe — fuse action ile tickDecision (CRITICAL backend claim'liyse sonraki)", () => {
  it("CRITICAL gate:backend claim'liyse sonraki claim'siz seçilir", () => {
    const top = reqToConductAction({ criticality: "CRITICAL", target: "gate:backend", detail: "", action: "", score: 100 })!;
    const next = reqToConductAction({ criticality: "COMPLETENESS", target: "dod:x:frontend", detail: "", action: "", score: 60 })!;
    const claim = (lane: string): ClaimEvent => ({ ts: 1000, tab: "o", pid: 1, lane, version: "v", status: "claimed", ttlMs: 9e5, fence: 1 });
    const r = tickDecision(top, [top, next], [claim("backend")], []);
    expect(r.claimedElsewhere).toBe(true);
    expect(r.action?.lane).toBe("frontend");
  });
});

describe("readActiveClaims — claim ledger path (Faz13 P2-001)", () => {
  it("CLAIMS → seyir/work-claim.jsonl (eski orchestration/claims.jsonl DEĞİL)", () => {
    expect(CLAIMS.endsWith(join("seyir", "work-claim.jsonl"))).toBe(true);
  });
  it("verilen ledger'dan aktif claim okur", () => {
    const dir = mkdtempSync(join(tmpdir(), "hb-claims-"));
    const f = join(dir, "wc.jsonl");
    const now = 1_700_000_000_000;
    writeFileSync(f, JSON.stringify({ ts: now, tab: "t", pid: 1, lane: "orchestration", version: "vO7", status: "claimed", ttlMs: 1_200_000, fence: 1 }) + "\n");
    const active = readActiveClaims(now + 1000, f);
    expect(active.length).toBe(1);
    expect(active[0].lane).toBe("orchestration");
    rmSync(dir, { recursive: true, force: true });
  });
});
