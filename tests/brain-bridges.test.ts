// S29/S36/S41/S38 + S48: durable-source bridges must be cursored (re-runs write
// nothing new), budget-capped, ns-scoped to "ops", and individually fault-isolated.
// All sources are faked on disk/tmp — deterministic, no network (the KEV bridge's
// fetch path is covered by injecting BRAIN_KEV_INGEST=0 here; its delta logic is
// pure-tested separately).
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  foldSeyirLines, newKevItems, assessPressure, runMaintainBridges, readCursor,
  OPS_NS, type BridgeWriter,
} from "../server/brain-bridges";
import { resetBusForTests } from "../server/brain-bus";
import type { BrainMemoryInput, BrainFactInput } from "../server/brain";

let dir: string;
let mems: BrainMemoryInput[];
let facts: BrainFactInput[];
const writer: BridgeWriter = {
  remember: async (m) => { mems.push(m); return { id: m.id }; },
  assertFact: async (f) => { facts.push(f); return { changed: true }; },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bridges-"));
  mems = [];
  facts = [];
  resetBusForTests();
  process.env.HOME = dir; // bridges resolve ~/.llm-mission-control under HOME
  process.env.BRAIN_KEV_INGEST = "0"; // no network in unit tests
  process.env.HIERARCHY_POLICY_PATH = join(dir, "HIERARCHY_POLICY.json");
});

afterEach(() => {
  delete process.env.BRAIN_KEV_INGEST;
  delete process.env.HIERARCHY_POLICY_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const seyirLine = (kind: string, entry: Record<string, unknown>, ts = "2026-07-18T09:00:00.000Z") =>
  JSON.stringify({ ts, kind, entry }) + "\n";

describe("foldSeyirLines (pure)", () => {
  test("keeps operational entries, drops web-vital telemetry noise and bad lines", () => {
    const chunk =
      seyirLine("op", { action: "deploy" }) +
      "garbage not json\n" +
      seyirLine("note", { note: "web-vital TTFB", metric: "TTFB", value: 25 });
    const { items } = foldSeyirLines(chunk, 0);
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain("deploy");
    expect(items[0].at).toBe(Date.parse("2026-07-18T09:00:00.000Z"));
  });
});

describe("newKevItems (pure)", () => {
  test("delta-only against the seen set", () => {
    const items = [{ id: "cve-1", title: "A" }, { id: "cve-2", title: "B" }];
    expect(newKevItems(items, new Set(["cve-1"]))).toEqual([{ id: "cve-2", title: "B" }]);
  });
});

describe("assessPressure (S48, pure)", () => {
  test("over-budget db + episodic dominance + cache-near-cap all flagged", () => {
    const r = assessPressure(
      { memories: { episodic: 90, learned: 5 }, dbBytes: 300 * 1048576, embedCacheRows: 4800 },
      { BRAIN_DB_BUDGET_MB: "256" },
    );
    expect(r.suggestions).toHaveLength(3);
  });
  test("healthy store → zero suggestions (report-only stays quiet)", () => {
    const r = assessPressure({ memories: { episodic: 10, learned: 10 }, dbBytes: 1048576, embedCacheRows: 10 });
    expect(r.suggestions).toEqual([]);
  });
});

describe("runMaintainBridges (io orchestrator)", () => {
  test("seyir tail is cursored: second run writes nothing; ops ns + deterministic ids", async () => {
    const mc = join(dir, ".llm-mission-control");
    writeFileSync(join(dir, "cursor.json"), "{}");
    // fs mkdir for the seyir path
    const seyirPath = join(mc, "seyir-defteri.jsonl");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(mc, { recursive: true });
    writeFileSync(seyirPath, seyirLine("op", { action: "boot" }) + seyirLine("op", { action: "ship" }));

    const cursorFile = join(dir, "cursor.json");
    const r1 = await runMaintainBridges(writer, cursorFile);
    expect(r1.seyir).toBe(2);
    expect(r1.errors).toEqual([]);
    expect(mems).toHaveLength(2);
    expect(new Set(mems.map((m) => m.ns))).toEqual(new Set([OPS_NS]));
    expect(mems[0].id).toMatch(/^seyir:[0-9a-f]{40}$/);

    const r2 = await runMaintainBridges(writer, cursorFile); // no new lines
    expect(r2.seyir).toBe(0);

    appendFileSync(seyirPath, seyirLine("op", { action: "restart" }));
    const r3 = await runMaintainBridges(writer, cursorFile); // only the tail
    expect(r3.seyir).toBe(1);
    expect(mems).toHaveLength(3);
  });

  test("hierarchy policy snapshot: unchanged hash → no rewrite; change → one procedural row", async () => {
    const cursorFile = join(dir, "cursor.json");
    writeFileSync(process.env.HIERARCHY_POLICY_PATH!, JSON.stringify({ mode: "advisory" }));
    const r1 = await runMaintainBridges(writer, cursorFile);
    expect(r1.hierarchy).toBe(1);
    expect(mems.at(-1)?.tier).toBe("procedural");
    const r2 = await runMaintainBridges(writer, cursorFile);
    expect(r2.hierarchy).toBe(0); // same hash
    writeFileSync(process.env.HIERARCHY_POLICY_PATH!, JSON.stringify({ mode: "enforce" }));
    const r3 = await runMaintainBridges(writer, cursorFile);
    expect(r3.hierarchy).toBe(1);
  });

  test("budget cap bounds a flood; a failing writer isolates to its bridge", async () => {
    process.env.BRAIN_INGEST_BUDGET = "2";
    try {
      const mc = join(dir, ".llm-mission-control");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(mc, { recursive: true });
      const flood = Array.from({ length: 10 }, (_, i) => seyirLine("op", { i })).join("");
      writeFileSync(join(mc, "seyir-defteri.jsonl"), flood);
      const cursorFile = join(dir, "cursor.json");
      const r = await runMaintainBridges(writer, cursorFile);
      expect(r.seyir).toBe(2); // capped, not 10
      // cursor still advanced to EOF — flood beyond budget is dropped by design,
      // visible via bus denied-stats, never replayed as a thundering herd.
      expect(readCursor(cursorFile).seyirOffset).toBeGreaterThan(0);
    } finally {
      delete process.env.BRAIN_INGEST_BUDGET;
    }
  });
});
