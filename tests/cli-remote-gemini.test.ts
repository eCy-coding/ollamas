/**
 * Pure-core tests for the gemini-cli fleet wiring in cli/commands/remote.ts:
 * the local-provider worker mapping, task-kind inference, and worker enumeration.
 */
import { describe, it, expect } from "vitest";
import { localProviderForWorker, inferTaskKind, buildWorkers } from "../cli/commands/remote";
import type { Backend } from "../cli/lib/remote";

describe("localProviderForWorker", () => {
  it("gemini-cli → provider override; host/mac → null", () => {
    expect(localProviderForWorker("gemini-cli")).toBe("gemini-cli");
    expect(localProviderForWorker("mac")).toBeNull();
    expect(localProviderForWorker("box-a")).toBeNull();
  });
});

describe("inferTaskKind — google-grounded", () => {
  it("web/search/grounding/latest prompts → google-grounded", () => {
    expect(inferTaskKind("search the web for the latest react news")).toBe("google-grounded");
    expect(inferTaskKind("use google search to find current events")).toBe("google-grounded");
  });
  it("plain coding stays codegen; terminal stays host-tool", () => {
    expect(inferTaskKind("write a fizzbuzz function")).toBe("codegen");
    expect(inferTaskKind("run it in the terminal")).toBe("host-tool");
  });
});

describe("buildWorkers — gemini-cli worker gating", () => {
  const pool: Backend[] = [{ name: "box-a", url: "http://box-a:11434" } as Backend];
  it("adds the gemini-cli worker only when its binary is present", () => {
    const withG = buildWorkers(pool, true, true);
    expect(withG.find((w) => w.name === "gemini-cli")?.healthy).toBe(true);
    const without = buildWorkers(pool, true, false);
    expect(without.find((w) => w.name === "gemini-cli")).toBeUndefined();
  });
  it("always includes the mac control plane", () => {
    expect(buildWorkers(pool, true).find((w) => w.kind === "mac")).toBeTruthy();
  });
});
