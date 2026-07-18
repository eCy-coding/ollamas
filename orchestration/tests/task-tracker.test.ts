import { describe, it, expect } from "vitest";
import {
  startRun, setItems, updateItem, addTokens, setNote, finishRun, applyEvent,
  fmtElapsed, fmtTokens, spinnerVerb, renderStatusLine, renderChecklist, renderFrame,
  type TrackerEvent, type TrackerState,
} from "../bin/lib/task-tracker";

const T0 = "2026-07-18T10:00:00Z";
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000);
const iso = (sec: number) => at(sec).toISOString();

function run(): TrackerState {
  return startRun("Ledger swap yapılıyor", "ollamas",
    [{ id: "P0-2", label: "P0-2: brain-ledger backend-swap" }, { id: "P0-3", label: "P0-3: fact hijyeni" }], T0);
}

describe("formatters", () => {
  it("fmtElapsed: 9s / 4m 56s / 1h 2m", () => {
    expect(fmtElapsed(T0, at(9))).toBe("9s");
    expect(fmtElapsed(T0, at(4 * 60 + 56))).toBe("4m 56s");
    expect(fmtElapsed(T0, at(62 * 60))).toBe("1h 2m");
  });
  it("fmtTokens: 999 / 18.7k / 2.0M", () => {
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(18700)).toBe("18.7k");
    expect(fmtTokens(2_000_000)).toBe("2.0M");
  });
  it("spinnerVerb deterministic: rotates per 10s window", () => {
    expect(spinnerVerb(0)).toBe(spinnerVerb(9));
    expect(spinnerVerb(0)).not.toBe(spinnerVerb(10));
    expect(spinnerVerb(5)).toBe(spinnerVerb(5)); // stable
  });
});

describe("reducers", () => {
  it("startRun: all items pending, note=title", () => {
    const s = run();
    expect(s.items.every((i) => i.status === "pending")).toBe(true);
    expect(s.note).toBe("Ledger swap yapılıyor");
    expect(s.finished).toBe(false);
  });
  it("updateItem + addTokens + setNote + finishRun", () => {
    let s = updateItem(run(), "P0-2", "active", iso(5));
    s = addTokens(s, 18700, iso(6));
    s = setNote(s, "Migrasyon koşuyor", iso(7), "migrating");
    expect(s.items[0].status).toBe("active");
    expect(s.tokensOut).toBe(18700);
    expect(s.phase).toBe("migrating");
    expect(finishRun(s, iso(8)).finished).toBe(true);
  });
  it("updateItem on unknown id appends it (tolerant)", () => {
    const s = updateItem(run(), "P9-9", "active", iso(1), "P9-9: sürpriz görev");
    expect(s.items).toHaveLength(3);
    expect(s.items[2]).toMatchObject({ id: "P9-9", status: "active" });
  });
  it("addTokens ignores non-finite/negative", () => {
    expect(addTokens(run(), NaN, iso(1)).tokensOut).toBe(0);
    expect(addTokens(run(), -5, iso(1)).tokensOut).toBe(0);
  });
});

describe("task-change (setItems id-merge)", () => {
  it("preserves surviving statuses, adds new as pending, drops removed", () => {
    let s = updateItem(run(), "P0-2", "done", iso(10));
    s = setItems(s, [
      { id: "P0-2", label: "P0-2: brain-ledger backend-swap" },
      { id: "P1-4", label: "P1-4: BrainPanel" },
    ], iso(11));
    expect(s.items.map((i) => i.id)).toEqual(["P0-2", "P1-4"]);
    expect(s.items[0].status).toBe("done");    // preserved
    expect(s.items[1].status).toBe("pending"); // new
  });
});

describe("applyEvent replay", () => {
  it("event fold equals direct reducer chain", () => {
    const evs: TrackerEvent[] = [
      { type: "start", ts: T0, runId: "r1", title: "Ledger swap yapılıyor", source: "ollamas", items: [{ id: "P0-2", label: "P0-2: swap" }] },
      { type: "item", ts: iso(5), id: "P0-2", status: "active" },
      { type: "tokens", ts: iso(6), n: 18700 },
      { type: "note", ts: iso(7), note: "Migrasyon", phase: "migrating" },
      { type: "items", ts: iso(8), items: [{ id: "P0-2", label: "P0-2: swap" }, { id: "P0-3", label: "P0-3: prune" }] },
      { type: "finish", ts: iso(9) },
    ];
    const folded = evs.reduce<TrackerState | null>((s, e) => applyEvent(s, e), null)!;
    expect(folded.items.map((i) => `${i.id}:${i.status}`)).toEqual(["P0-2:active", "P0-3:pending"]);
    expect(folded.tokensOut).toBe(18700);
    expect(folded.finished).toBe(true);
  });
  it("non-start event on null state is tolerated (placeholder run)", () => {
    const s = applyEvent(null, { type: "tokens", ts: T0, n: 5 });
    expect(s.title).toBe("(unknown run)");
    expect(s.tokensOut).toBe(5);
  });
});

describe("rendering", () => {
  it("status line matches the Claude-Code shape", () => {
    let s = addTokens(run(), 18700, iso(1));
    expect(renderStatusLine(s, at(4 * 60 + 56))).toBe("⏺ Ledger swap yapılıyor… (4m 56s · ↓ 18.7k tokens)");
    expect(renderStatusLine(finishRun(s, iso(300)), at(301))).toContain("✅");
  });
  it("checklist glyphs ◻◼✔✖", () => {
    let s = updateItem(run(), "P0-2", "active", iso(1));
    s = updateItem(s, "P0-3", "failed", iso(2));
    s = updateItem(s, "P9", "done", iso(3), "P9: bitti");
    const lines = renderChecklist(s);
    expect(lines[0].startsWith("◼")).toBe(true);
    expect(lines[1].startsWith("✖")).toBe(true);
    expect(lines[2].startsWith("✔")).toBe(true);
    expect(renderChecklist(run())[0].startsWith("◻")).toBe(true);
  });
  it("frame: unfinished shows spinner with phase, finished omits it", () => {
    const s = setNote(run(), "Ledger swap yapılıyor", iso(0), "thinking");
    const frame = renderFrame(s, at(9));
    expect(frame).toContain("… (9s · thinking)");
    expect(renderFrame(finishRun(s, iso(10)), at(11))).not.toContain("thinking)");
  });
});
