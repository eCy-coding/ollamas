// brain-ledger dual-write (P0-2): the org ledger stays the sync source of truth while
// every real-run memory is mirrored fire-and-forget into the 5-tier brain. The mirror
// must be deterministic (idempotent ids), isolated (never fires from tests/sandbox
// unless forced), and best-effort (a dead endpoint cannot break remember()).
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remember, toBrainInput, readLedger, type BrainRecord } from "../bin/lib/brain-ledger";

const TS = "2026-07-18T10:00:00.000Z";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "org-ledger-"));
  process.env.ORG_STATE_DIR = dir;
  delete process.env.ORG_BRAIN_MIRROR;
});

afterEach(() => {
  delete process.env.ORG_STATE_DIR;
  delete process.env.ORG_BRAIN_MIRROR;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("toBrainInput", () => {
  test("deterministic id, preserved tier, org ns, original event time", () => {
    const rec: BrainRecord = { ts: TS, tier: "learned", fact: "retry beats restart", meta: { ok: true } };
    const a = toBrainInput(rec);
    const b = toBrainInput(rec);
    expect(a).toEqual(b); // same record → same id → idempotent mirror + migration
    expect(a.id).toMatch(/^org:[0-9a-f]{40}$/);
    expect(a.tier).toBe("learned"); // lessons must land as learned, not episodic
    expect(a.ns).toBe("org");
    expect(a.source).toBe("org-ledger");
    expect(a.createdAt).toBe(Date.parse(TS));
    expect(a.content).toContain("retry beats restart");
    expect(a.content).toContain('"ok":true');
  });

  test("caps content at 500 chars and survives an unparseable ts", () => {
    const rec: BrainRecord = { ts: "not-a-date", tier: "episodic", fact: "x".repeat(600) };
    const out = toBrainInput(rec);
    expect(out.content.length).toBe(500);
    expect(out.createdAt).toBeUndefined();
  });
});

describe("mirror seam", () => {
  test("isolated state dir (tests/sandbox) never fires the mirror", () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    remember("episodic", "dispatch t1 → conductor", { slot: 1 }, TS);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readLedger()).toHaveLength(1); // JSONL append still happens
  });

  test("ORG_BRAIN_MIRROR=1 forces the mirror with the toBrainInput payload", () => {
    process.env.ORG_BRAIN_MIRROR = "1";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const rec = remember("learned", "lesson: kickstart daemons after ship", undefined, TS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/brain/remember");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(toBrainInput(rec));
  });

  test("a rejecting endpoint cannot break remember (fire-and-forget)", async () => {
    process.env.ORG_BRAIN_MIRROR = "1";
    const fetchSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => remember("episodic", "outcome t1: ok", { ok: true }, TS)).not.toThrow();
    await Promise.resolve(); // let the rejected promise settle through the .catch
    expect(readLedger()).toHaveLength(1);
  });

  test("ORG_BRAIN_MIRROR=0 disables even outside isolation", () => {
    process.env.ORG_BRAIN_MIRROR = "0";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    remember("episodic", "quiet", undefined, TS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
