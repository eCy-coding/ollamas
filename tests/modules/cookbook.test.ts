// O7 Cookbook module (docs/odyssey/05-features/cookbook.md) — service unit +
// route/guard/toggle. Mirrors server/modules/demo/__tests__/demo.test.ts: a bare
// express app + mountEnabledModules (functional behavior) and a real-server import
// for the localOwnerGuard invariant (SAAS_ENFORCE=1 → 403). No ollama, no host
// binaries: hardware detection is injected, bench flows through an injected
// ToolRegistry.execute (the choke-point), pull sanitize is pure.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import "../../server/modules/cookbook"; // side-effect: register the cookbook module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import {
  detectHardware,
  classifyRam,
  fitBadge,
  recommend,
  benchModel,
  sanitizeModelName,
  configFor,
  FIT_RATIO,
  RAM_CLASS_MODELS,
  type HardwareProbe,
} from "../../server/modules/cookbook/service";

// ── Deterministic hardware probes (no real os / sysctl) ──────────────────────
const appleSilicon: HardwareProbe = {
  totalmem: () => 24 * 1e9,
  platform: () => "darwin",
  arch: () => "arm64",
  cpus: () => new Array(12).fill({ model: "Apple M4" }),
  sysctl: () => ({ memBytes: String(24 * 1e9), physCpu: "12", brand: "Apple M4" }),
};
const tinyMac: HardwareProbe = {
  totalmem: () => 8 * 1e9,
  platform: () => "darwin",
  arch: () => "arm64",
  cpus: () => new Array(8).fill({ model: "Apple M1" }),
  sysctl: () => ({ memBytes: String(8 * 1e9), physCpu: "8", brand: "Apple M1" }),
};
const sysctlBroken: HardwareProbe = {
  totalmem: () => 16 * 1e9,
  platform: () => "linux",
  arch: () => "x64",
  cpus: () => new Array(8).fill({ model: "x86" }),
  sysctl: () => {
    throw new Error("sysctl not found");
  },
};

describe("O7 cookbook — hardware detection (P1)", () => {
  test("Apple Silicon darwin/arm64 → metal:true + unified memory + enriched chip", () => {
    const hw = detectHardware(appleSilicon);
    expect(hw.arch).toBe("arm64");
    expect(hw.metal).toBe(true);
    expect(hw.ramGb).toBe(24);
    expect(hw.cores).toBe(12);
    expect(hw.chip).toBe("Apple M4");
    expect(hw.memType.toLowerCase()).toContain("unified");
    // usable = ramGb * FIT_RATIO (single fit source, K5)
    expect(hw.usableGb).toBeCloseTo(24 * FIT_RATIO, 5);
  });

  test("sysctl failure is graceful — returns os.* values, never throws", () => {
    const hw = detectHardware(sysctlBroken);
    expect(hw.metal).toBe(false);
    expect(hw.ramGb).toBe(16);
    expect(hw.chip).toBeTruthy(); // falls back, no throw
  });
});

describe("O7 cookbook — rule base pinned to model-guide.md (P2)", () => {
  test("classifyRam maps to the 4 documented classes", () => {
    expect(classifyRam(8)).toBe("8-16");
    expect(classifyRam(16)).toBe("8-16");
    expect(classifyRam(18)).toBe("18-24");
    expect(classifyRam(24)).toBe("18-24");
    expect(classifyRam(32)).toBe("32-48");
    expect(classifyRam(48)).toBe("32-48");
    expect(classifyRam(64)).toBe("64+");
  });

  test("each class carries the model-guide example models (docs-pin)", () => {
    expect(RAM_CLASS_MODELS["18-24"]).toContain("qwen3:8b");
    expect(RAM_CLASS_MODELS["8-16"]).toContain("qwen3:4b");
    expect(RAM_CLASS_MODELS["64+"]).toContain("llama3.3:70b");
  });
});

describe("O7 cookbook — fit badge single FIT_RATIO source (P3)", () => {
  test("✓ fit / ⚠ tight / ✗ wont via one FIT_RATIO", () => {
    // 24GB → usable ~16.8GB. qwen3:8b footprint 6.6 → comfortable ✓.
    expect(fitBadge("qwen3:8b", 24)).toBe("fit");
    // 8GB → usable 5.6GB. qwen3:8b footprint 6.6 → exceeds → ✗.
    expect(fitBadge("qwen3:8b", 8)).toBe("wont");
    // qwen3:32b footprint 22.5 on 32GB (usable 22.4) → just over → wont.
    expect(fitBadge("qwen3:32b", 32)).toBe("wont");
  });
});

describe("O7 cookbook — recommendation (P4)", () => {
  test("champion absent → primary qwen3:8b flagged install (not installed)", () => {
    const hw = detectHardware(appleSilicon);
    const rec = recommend(hw, []);
    expect(rec.primary.id).toBe("qwen3:8b");
    expect(rec.primary.installed).toBe(false);
    expect(rec.primary.fits).toBe(true);
    expect(rec.ruleClass).toBe("18-24");
    expect(rec.alternatives.length).toBeGreaterThan(0);
  });

  test("champion installed → primary marked resident/installed", () => {
    const hw = detectHardware(appleSilicon);
    const rec = recommend(hw, ["qwen3:8b"]);
    expect(rec.primary.installed).toBe(true);
  });

  test("honest: no fabricated tok/s without bench; estTokS only from bench data", () => {
    const hw = detectHardware(appleSilicon);
    const rec = recommend(hw, []);
    expect(rec.primary.estTokS).toBeUndefined();
    const withBench = recommend(hw, [], { "qwen3:8b": { tps: 82, runs: 3 } });
    expect(withBench.primary.estTokS).toBe(82);
    expect(withBench.primary.measured).toBe(true);
  });

  test("exceeds usable memory → primary won't fit + a fitting fallback is offered", () => {
    const hw = detectHardware(tinyMac); // 8GB
    const rec = recommend(hw, []);
    expect(rec.primary.fits).toBe(false);
    expect(rec.primary.tier).toBe("wont");
    expect(rec.fallback).toBeTruthy();
    expect(rec.fallback!.fits).toBe(true);
  });
});

describe("O7 cookbook — bench flows through the ToolRegistry choke-point (P5)", () => {
  test("a .gguf path routes to execute('bench_model') and normalizes tps", async () => {
    const calls: string[] = [];
    const fakeExecute = async (name: string) => {
      calls.push(name);
      return { ok: true, output: { tps: 71.4, pp_tps: 900, model: "m", runs: 3 } };
    };
    const r = await benchModel({ model: "/abs/path/model.gguf" }, { execute: fakeExecute as any });
    expect(calls).toEqual(["bench_model"]); // ONLY via the choke-point
    if (!("result" in r)) throw new Error("expected bench to succeed");
    expect(r.result.tps).toBe(71.4);
    expect(r.result.measured).toBe(true);
  });

  test("no .gguf path → 422 (no sha256 blob guess, no fake tps, execute never called)", async () => {
    const calls: string[] = [];
    const fakeExecute = async (name: string) => {
      calls.push(name);
      return { ok: true, output: {} };
    };
    const r = await benchModel({ model: "qwen3:8b" }, { execute: fakeExecute as any });
    expect(r.ok).toBe(false);
    if (!("status" in r)) throw new Error("expected 422");
    expect(r.status).toBe(422);
    expect(calls).toEqual([]); // never dispatched
  });
});

describe("O7 cookbook — pull model-name sanitize (P6 security)", () => {
  test("accepts a real ollama tag, rejects shell/SSRF metacharacters", () => {
    expect(sanitizeModelName("qwen3:8b")).toBe("qwen3:8b");
    expect(sanitizeModelName("library/qwen2.5-coder:7b")).toBe("library/qwen2.5-coder:7b");
    expect(() => sanitizeModelName("qwen3:8b; rm -rf /")).toThrow();
    expect(() => sanitizeModelName("http://evil.com/x")).toThrow();
    expect(() => sanitizeModelName("")).toThrow();
  });
});

describe("O7 cookbook — config bridge maps optimalConfig → ModelOverride (P7)", () => {
  test("configFor produces a sanitized numCtx/keepAlive override", () => {
    const hw = detectHardware(appleSilicon);
    const ov = configFor(hw, "qwen3:8b");
    expect(ov).toBeTruthy();
    expect(ov!.numCtx).toBeGreaterThan(0);
    expect(typeof ov!.keepAlive).toBe("string");
  });
});

// ── Route + toggle (functional) ──────────────────────────────────────────────
describe("O7 cookbook — route + toggle", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountEnabledModules(app, { MODULE_COOKBOOK: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_COOKBOOK=1 → GET /hardware 200 + shape; module in /api/modules list", async () => {
    const res = await fetch(`${base}/api/modules/cookbook/hardware`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.ramGb).toBe("number");
    expect(typeof body.metal).toBe("boolean");
    process.env.MODULE_COOKBOOK = "1";
    expect(enabledModules().map((m) => m.id)).toContain("cookbook");
    delete process.env.MODULE_COOKBOOK;
  });

  test("GET /recommend → 200 with a primary pick (installed=[] when ollama down)", async () => {
    const res = await fetch(`${base}/api/modules/cookbook/recommend`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.primary.id).toBe("qwen3:8b");
  });

  test("POST /bench without a .gguf path → 422 (honest, no fake tps)", async () => {
    const res = await fetch(`${base}/api/modules/cookbook/bench`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen3:8b" }),
    });
    expect(res.status).toBe(422);
  });

  test("POST /pull with a poisoned model name → 400 (sanitize gate)", async () => {
    const res = await fetch(`${base}/api/modules/cookbook/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x; rm -rf /" }),
    });
    expect(res.status).toBe(400);
  });

  test("MODULE_COOKBOOK unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/cookbook/hardware`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/cookbook is 403 under SaaS (P8) ──
describe("O7 cookbook — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_COOKBOOK = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/cookbook/* is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/cookbook/hardware`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/cookbook/hardware`)).status).not.toBe(403);
  });
});
