import { describe, it, expect } from "vitest";
import { composeEnv, resolveConfig, parseComposeRunning } from "../server/ecysearcher";
import { backoffMs, isCrashLoop, shouldResetBackoff } from "../server/ecysearch";

describe("ecysearcher supervisor — config + port remap (pure)", () => {
  it("composeEnv remaps the AirPlay/ecypro-conflicting host ports, overridable", () => {
    const e = composeEnv({} as NodeJS.ProcessEnv);
    expect(e.API_PORT).toBe("5055");
    expect(e.DB_PORT).toBe("5433");
    expect(e.REDIS_PORT).toBe("6380");
    expect(e.FRONTEND_PORT).toBe("8088");
    expect(composeEnv({ ECYSEARCHER_DB_PORT: "5599" } as any).DB_PORT).toBe("5599");
  });

  it("resolveConfig: baseUrl from the remapped port, ECYSEARCHER_URL wins; healthUrl = base + /", () => {
    const c = resolveConfig({} as NodeJS.ProcessEnv, "/home/x");
    expect(c.baseUrl).toBe("http://localhost:5055");
    expect(c.healthUrl).toBe("http://localhost:5055/");
    expect(c.logFile).toBe("/home/x/.llm-mission-control/ecysearcher.log");
    expect(resolveConfig({ ECYSEARCHER_URL: "http://h:7/" } as any, "/home/x").baseUrl).toBe("http://h:7");
    expect(resolveConfig({ ECYSEARCHER_API_PORT: "9000" } as any, "/home/x").baseUrl).toBe("http://localhost:9000");
  });
});

describe("ecysearcher supervisor — docker compose ps parsing (pure)", () => {
  it("detects a running backend in array or line-delimited JSON", () => {
    expect(parseComposeRunning(JSON.stringify([{ Service: "backend", State: "running" }]))).toBe(true);
    expect(parseComposeRunning('{"Service":"backend","State":"running"}\n{"Service":"redis","State":"running"}')).toBe(true);
    expect(parseComposeRunning(JSON.stringify([{ Service: "backend", State: "exited" }]))).toBe(false);
    expect(parseComposeRunning("")).toBe(false);
    expect(parseComposeRunning("not json")).toBe(false);
    expect(parseComposeRunning(JSON.stringify([{ Service: "redis", State: "running" }]))).toBe(false); // backend absent
  });
});

describe("ecysearcher supervisor — heal policy (shared with ecysearch)", () => {
  it("exponential backoff + crash-loop breaker + stability reset", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(99)).toBe(30_000); // capped
    expect(isCrashLoop([0, 100, 200, 300, 400], 500)).toBe(true);   // 5 heals in <60s → open circuit
    expect(isCrashLoop([0, 100], 500)).toBe(false);
    expect(shouldResetBackoff(70_000)).toBe(true);
    expect(shouldResetBackoff(10_000)).toBe(false);
  });
});
