import { describe, it, expect } from "vitest";
import { route } from "../cli/index";
import { resolveConfig } from "../cli/lib/config";

describe("cli route", () => {
  it("extracts the first positional as the command", () => {
    expect(route(["chat", "hello", "world"])).toEqual({ command: "chat", rest: ["hello", "world"] });
  });

  it("keeps leading flags in rest, command is first non-flag", () => {
    expect(route(["--json", "doctor"])).toEqual({ command: "doctor", rest: ["--json"] });
  });

  it("defaults to help on empty argv", () => {
    expect(route([])).toEqual({ command: "help", rest: [] });
  });

  it("treats a lone flag invocation as help", () => {
    expect(route(["--version"])).toEqual({ command: "help", rest: ["--version"] });
  });
});

describe("config resolution precedence", () => {
  it("env overrides file overrides defaults", () => {
    const cfg = resolveConfig({ gateway: "http://file:3000", model: "fileModel" }, { OLLAMAS_MODEL: "envModel" } as any);
    expect(cfg.gateway).toBe("http://file:3000"); // file wins over default
    expect(cfg.model).toBe("envModel"); // env wins over file
    expect(cfg.provider).toBe("ollama-local"); // default
  });

  it("falls back to defaults with empty inputs", () => {
    const cfg = resolveConfig({}, {} as any);
    expect(cfg.gateway).toBe("http://localhost:3000");
    expect(cfg.model).toBe("qwen3:8b");
    expect(cfg.profile).toBe("default");
    expect(cfg.apiKey).toBeUndefined();
  });
});
