import { describe, it, expect } from "vitest";
import {
  buildRoster, resolveSeat, seatsForLane, SEAT_SPEC, LANES,
  type SeatSpec,
} from "../bin/lib/council-roster";

// Live fleet (ollama list 2026-07-01) — used to assert full coverage on the real machine.
const LIVE = [
  "qwen3-coder-64k:latest", "qwen3:8b-16k", "ollamas-reviewer:latest", "qwen2.5vl:32b",
  "qwen2.5vl:7b", "qwen3:8b", "qwen3:30b-a3b", "deepseek-r1:32b", "qwen3-coder:30b",
  "qwen3:4b", "gpt-oss:20b", "kimi-k2.5:cloud", "nomic-embed-text:latest",
  "gpt-oss:20b-cloud", "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "llama3.3:70b",
];

describe("resolveSeat — ordered preference, first available wins", () => {
  const spec: SeatSpec = SEAT_SPEC.find((s) => s.capability === "deep-code")!;
  it("picks first preferred when available", () => {
    const seat = resolveSeat(spec, new Set(["qwen3-coder:480b-cloud", "qwen3-coder:30b"]));
    expect(seat.model).toBe("qwen3-coder:480b-cloud");
    expect(seat.available).toBe(true);
  });
  it("falls back to next preference when top absent", () => {
    const seat = resolveSeat(spec, new Set(["qwen3-coder:30b"]));
    expect(seat.model).toBe("qwen3-coder:30b");
  });
  it("marks absent when no preferred model pulled", () => {
    const seat = resolveSeat(spec, new Set(["phi4:latest"]));
    expect(seat.model).toBeNull();
    expect(seat.available).toBe(false);
  });
});

describe("buildRoster — live fleet coverage", () => {
  const r = buildRoster(LIVE);
  it("seats every capability spec", () => {
    expect(r.seats.length).toBe(SEAT_SPEC.length);
  });
  it("all seats present on the live fleet", () => {
    expect(r.present).toBe(SEAT_SPEC.length);
    expect(r.absentCapabilities).toEqual([]);
  });
  it("covers all 7 lanes", () => {
    expect(r.lanesCovered.sort()).toEqual([...LANES].sort());
    expect(r.lanesUncovered).toEqual([]);
  });
  it("champion qwen3:8b takes the fast-verify seat", () => {
    const fv = r.seats.find((s) => s.capability === "fast-verify");
    expect(fv?.model).toBe("qwen3:8b");
  });
  it("deepseek-r1 takes the reasoning/root-cause seat", () => {
    const rs = r.seats.find((s) => s.capability === "reasoning");
    expect(rs?.model).toBe("deepseek-r1:32b");
  });
});

describe("buildRoster — degraded fleet surfaces gaps (no silent drop)", () => {
  it("empty fleet → all absent, no lanes covered", () => {
    const r = buildRoster([]);
    expect(r.present).toBe(0);
    expect(r.absentCapabilities.length).toBe(SEAT_SPEC.length);
    expect(r.lanesCovered).toEqual([]);
    expect(r.lanesUncovered.sort()).toEqual([...LANES].sort());
  });
  it("only qwen3:8b → fast-verify + triage-ish seats present, vision absent", () => {
    const r = buildRoster(["qwen3:8b"]);
    expect(r.seats.find((s) => s.capability === "fast-verify")?.available).toBe(true);
    expect(r.seats.find((s) => s.capability === "vision")?.available).toBe(false);
    expect(r.absentCapabilities).toContain("vision");
  });
  it("normalizes whitespace/blank tags", () => {
    const r = buildRoster(["  qwen3:8b  ", "", "  "]);
    expect(r.seats.find((s) => s.capability === "fast-verify")?.model).toBe("qwen3:8b");
  });
});

describe("seatsForLane — present seats per lane", () => {
  const r = buildRoster(LIVE);
  it("frontend lane includes a vision seat", () => {
    const seats = seatsForLane(r, "frontend");
    expect(seats.some((s) => s.capability === "vision")).toBe(true);
  });
  it("backend lane includes deep-code + long-ctx", () => {
    const caps = seatsForLane(r, "backend").map((s) => s.capability);
    expect(caps).toContain("deep-code");
    expect(caps).toContain("long-ctx-code");
  });
  it("absent seats never returned", () => {
    const r2 = buildRoster(["qwen3:8b"]); // vision absent
    expect(seatsForLane(r2, "frontend").every((s) => s.available)).toBe(true);
  });
});
