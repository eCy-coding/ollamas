import { describe, it, expect } from "vitest";
import { buildFleetView } from "../server/cockpit";

describe("buildFleetView", () => {
  const pool = [
    { name: "win", url: "http://desktop-ert7724:11434", priority: 10 },
    { name: "mac", url: "http://localhost:11434", priority: 99 },
  ];

  it("marks the active backend + sorts by priority ascending", () => {
    const f = buildFleetView(pool, "http://localhost:11434");
    expect(f.poolSize).toBe(2);
    expect(f.backends[0].name).toBe("win"); // priority 10 first
    expect(f.backends.find((b) => b.name === "mac")!.active).toBe(true);
    expect(f.backends.find((b) => b.name === "win")!.active).toBe(false);
  });

  it("matches active host ignoring trailing slash", () => {
    const f = buildFleetView(pool, "http://localhost:11434/");
    expect(f.backends.find((b) => b.name === "mac")!.active).toBe(true);
  });

  it("tolerates malformed/empty pool", () => {
    expect(buildFleetView(null, "x").poolSize).toBe(0);
    expect(buildFleetView([{ bad: 1 }, { url: "" }], "x").poolSize).toBe(0);
    const f = buildFleetView([{ url: "http://h:1" }], "http://h:1");
    expect(f.backends[0].name).toBe("http://h:1"); // name defaults to url
    expect(f.backends[0].priority).toBe(50); // priority defaults to 50
    expect(f.backends[0].active).toBe(true);
  });
});
