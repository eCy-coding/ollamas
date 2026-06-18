import { describe, it, expect, vi, afterEach } from "vitest";
import { route, extractGlobalFlags, main } from "../cli/index";
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

  it("maps a lone --version/-v to the version command (G5)", () => {
    expect(route(["--version"]).command).toBe("version");
    expect(route(["-v"]).command).toBe("version");
  });

  it("maps a lone --help to help (G5)", () => {
    expect(route(["--help"]).command).toBe("help");
  });
});

describe("extractGlobalFlags (G10)", () => {
  it("pulls --gateway <url> out of argv", () => {
    expect(extractGlobalFlags(["--gateway", "http://h:3000", "doctor"])).toEqual({
      gateway: "http://h:3000",
      rest: ["doctor"],
    });
  });
  it("supports --gateway=<url>", () => {
    expect(extractGlobalFlags(["--gateway=http://h:9", "chat", "hi"])).toEqual({
      gateway: "http://h:9",
      rest: ["chat", "hi"],
    });
  });
  it("leaves argv untouched without the flag", () => {
    expect(extractGlobalFlags(["chat", "hi"])).toEqual({ gateway: undefined, rest: ["chat", "hi"] });
  });
});

describe("main dispatch (G9)", () => {
  afterEach(() => vi.restoreAllMocks());
  const silence = () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  };

  it("help and version exit 0", async () => {
    silence();
    expect(await main(["help"])).toBe(0);
    expect(await main(["version"])).toBe(0);
    expect(await main(["--version"])).toBe(0); // G5 end-to-end
  });

  it("unknown command exits 2", async () => {
    silence();
    expect(await main(["bogus"])).toBe(2);
  });

  it("routes saas: --help exits 0, no action exits 2 (no network)", async () => {
    silence();
    expect(await main(["saas", "--help"])).toBe(0);
    expect(await main(["saas"])).toBe(2);
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
