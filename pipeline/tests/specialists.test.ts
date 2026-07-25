import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { validateSpecialists, isValidRegistry, type Registry } from "../lib/specialists";

const good = (): Registry => ({
  version: "1.0.0",
  specialists: [
    { id: "ecy", domain: "command", invoke: "ecym", weight: 30, capabilities: ["route"] },
    { id: "ollamas", domain: "llm", invoke: ":3000", weight: 25, capabilities: ["chat"] },
    { id: "odysseus", domain: "research", invoke: "khoj", weight: 23, capabilities: ["research"] },
    { id: "claudecode", domain: "code", invoke: "claude", weight: 22, capabilities: ["code"] },
  ],
});

describe("validateSpecialists", () => {
  it("accepts a well-formed registry", () => {
    expect(isValidRegistry(validateSpecialists(good()))).toBe(true);
  });
  it("rejects a non-object / missing array", () => {
    expect(isValidRegistry(validateSpecialists(null as never))).toBe(false);
    expect(isValidRegistry(validateSpecialists({} as never))).toBe(false);
  });
  it("errors on empty, duplicate id, and missing fields", () => {
    expect(validateSpecialists({ specialists: [] }).some((i) => i.where === "specialists")).toBe(true);
    const dup = good(); dup.specialists[1].id = "ecy";
    expect(validateSpecialists(dup).some((i) => i.message === "duplicate id")).toBe(true);
    const bad = good(); bad.specialists[0].domain = ""; bad.specialists[0].invoke = ""; bad.specialists[0].capabilities = [];
    const errs = validateSpecialists(bad).filter((i) => i.level === "error").map((i) => i.message);
    expect(errs).toEqual(expect.arrayContaining(["no domain", "no invoke target (binary/endpoint)", "no capabilities"]));
  });
  it("warns (not errors) when weights do not sum to ~100", () => {
    const w = good(); w.specialists[0].weight = 5;
    const issues = validateSpecialists(w);
    expect(issues.some((i) => i.level === "warn" && i.where === "weights")).toBe(true);
    expect(isValidRegistry(issues)).toBe(true);
  });
});

describe("the real .ecym/specialists.json", () => {
  it("exists and validates clean", () => {
    const reg = JSON.parse(readFileSync(join(homedir(), "Desktop", "ollamas", ".ecym", "specialists.json"), "utf8"));
    expect(isValidRegistry(validateSpecialists(reg))).toBe(true);
    expect(reg.specialists.map((s: { id: string }) => s.id)).toEqual(["ecy", "ollamas", "odysseus", "claudecode"]);
  });
});
