import { describe, it, expect } from "vitest";
import { buildRunRequest, parseRunResult, isAutomationBlocked, classifyCapability } from "../bin/lib/term-exec";

describe("buildRunRequest", () => {
  it("builds the POST /run request with token auth + command body", () => {
    const r = buildRunRequest("http://127.0.0.1:7345", "tok123", "whoami", "terminal", 5000);
    expect(r.url).toBe("http://127.0.0.1:7345/run");
    expect(r.method).toBe("POST");
    expect(r.headers["x-bridge-token"]).toBe("tok123");
    expect(JSON.parse(r.body!)).toEqual({ command: "whoami", target: "terminal", timeoutMs: 5000 });
  });
  it("defaults to iterm2 and strips a trailing slash", () => {
    const r = buildRunRequest("http://127.0.0.1:7345/", "t", "ls");
    expect(r.url).toBe("http://127.0.0.1:7345/run");
    expect(JSON.parse(r.body!).target).toBe("iterm2");
  });
});

describe("parseRunResult", () => {
  it("parses a successful run with exit code + output", () => {
    const r = parseRunResult(JSON.stringify({ ok: true, target: "iterm2", exitCode: 0, output: "emre\n", durationMs: 800 }));
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe("emre\n");
    expect(r.automationBlocked).toBe(false);
  });
  it("flags a non-zero exit", () => {
    expect(parseRunResult(JSON.stringify({ ok: true, exitCode: 2, output: "err" })).exitCode).toBe(2);
  });
  it("detects a timeout", () => {
    expect(parseRunResult(JSON.stringify({ ok: false, timedOut: true, output: "partial" })).timedOut).toBe(true);
  });
  it("detects an Automation-permission block from the error/hint", () => {
    const r = parseRunResult(JSON.stringify({ ok: false, error: "osascript ... -1743", hint: "Grant Automation permission" }));
    expect(r.automationBlocked).toBe(true);
  });
  it("handles an unparseable body", () => {
    expect(parseRunResult("<html>502</html>").ok).toBe(false);
  });
});

describe("isAutomationBlocked", () => {
  it("matches the -1743 signature and 'Automation'", () => {
    expect(isAutomationBlocked("error -1743")).toBe(true);
    expect(isAutomationBlocked("enable Automation")).toBe(true);
    expect(isAutomationBlocked("all good")).toBe(false);
  });
});

describe("classifyCapability", () => {
  const health = { ok: true, terminals: { iterm2: true, terminal: true } };
  const okProbe = parseRunResult(JSON.stringify({ ok: true, exitCode: 0, output: "ollamas-term-ok" }));

  it("granted when a terminal exists and the probe ran with exit 0", () => {
    const c = classifyCapability(health, okProbe);
    expect(c.granted).toBe(true);
    expect(c.detail).toContain("exit 0");
  });
  it("not granted + Automation guidance when blocked", () => {
    const blocked = parseRunResult(JSON.stringify({ ok: false, error: "-1743", hint: "Automation" }));
    const c = classifyCapability(health, blocked);
    expect(c.granted).toBe(false);
    expect(c.automationBlocked).toBe(true);
    expect(c.detail).toContain("Automation permission");
  });
  it("not granted when no terminal app is present", () => {
    const c = classifyCapability({ ok: true, terminals: { iterm2: false, terminal: false } }, okProbe);
    expect(c.granted).toBe(false);
    expect(c.detail).toContain("no terminal app");
  });
  it("not granted when the probe never ran", () => {
    expect(classifyCapability(health, null).granted).toBe(false);
  });
});
