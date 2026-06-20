import { describe, it, expect } from "vitest";
import { renderPanes, visibleLen, type Pane } from "../cli/lib/output";

const ctx = { color: false, json: false };
const panes: Pane[] = [
  { title: "REQUESTS", lines: ["5 total", "2.1 req/s"] },
  { title: "LATENCY", lines: ["avg 60ms"] },
  { title: "TOOLS", lines: ["read_file 9", "write 3"] },
];

describe("visibleLen", () => {
  it("ignores ANSI color escapes", () => {
    expect(visibleLen("\x1b[1mhi\x1b[0m")).toBe(2);
    expect(visibleLen("plain")).toBe(5);
  });
});

describe("renderPanes", () => {
  it("wide → side-by-side (a content row carries ≥2 boxes' borders)", () => {
    const out = renderPanes(panes, 120, ctx);
    expect(out).toContain("REQUESTS");
    expect(out).toContain("LATENCY");
    expect(out).toContain("TOOLS");
    const row = out.split("\n").find((l) => l.includes("5 total"))!;
    expect((row.match(/│/g) || []).length).toBeGreaterThanOrEqual(4); // ≥2 boxes (2 borders each)
  });

  it("narrow → stacked (titles in order, one box per content row)", () => {
    const out = renderPanes(panes, 40, ctx);
    const iReq = out.indexOf("REQUESTS"),
      iLat = out.indexOf("LATENCY"),
      iTool = out.indexOf("TOOLS");
    expect(iReq).toBeLessThan(iLat);
    expect(iLat).toBeLessThan(iTool);
    const row = out.split("\n").find((l) => l.includes("5 total"))!;
    expect((row.match(/│/g) || []).length).toBe(2); // single box
  });

  it("side-by-side rows are all the same visible width (aligned grid)", () => {
    const lines = renderPanes(panes, 120, ctx).split("\n");
    const w = visibleLen(lines[0]);
    for (const l of lines) expect(visibleLen(l)).toBe(w);
  });

  it("truncates an over-long content line to the box width", () => {
    const out = renderPanes([{ title: "X", lines: ["x".repeat(500)] }], 40, ctx);
    for (const l of out.split("\n")) expect(visibleLen(l)).toBeLessThanOrEqual(80);
  });

  it("empty panes → empty string", () => {
    expect(renderPanes([], 120, ctx)).toBe("");
  });
});
