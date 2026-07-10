// V7 M-038 — per-model settings (num_ctx / temperature / keep_alive / system). The pure
// merge lives in server/model-overrides.ts; the integration test proves a persisted
// override for a model tag reaches the REAL outgoing ollama /api/chat payload
// (mock global.fetch — no network, deterministic).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sanitizeModelOverride,
  resolveModelTuning,
  resolveKeepAlive,
  withSystemOverride,
} from "../server/model-overrides";
import { ProviderRouter } from "../server/providers";
import { db } from "../server/db";

afterEach(() => {
  vi.restoreAllMocks();
  // In-memory only cleanup — never db.save() from tests (the singleton points at the real vault).
  if (db.data.modelOverrides) delete db.data.modelOverrides["tune-me:1b"];
});

describe("sanitizeModelOverride — HTTP body → typed override", () => {
  it("keeps valid knobs, floors numCtx, drops junk", () => {
    expect(
      sanitizeModelOverride({ numCtx: 4096.7, temperature: 0.2, keepAlive: "10m", system: " Terse. " })
    ).toEqual({ numCtx: 4096, temperature: 0.2, keepAlive: "10m", system: "Terse." });
  });

  it("rejects out-of-range / wrong-typed values field-by-field", () => {
    expect(sanitizeModelOverride({ numCtx: -1, temperature: 9, keepAlive: "sometimes", system: "  " })).toBeNull();
    expect(sanitizeModelOverride({ numCtx: "2048" })).toEqual({ numCtx: 2048 });
  });

  it("accepts keep_alive forms ollama understands: '10m', '0', '-1'", () => {
    expect(sanitizeModelOverride({ keepAlive: "10m" })).toEqual({ keepAlive: "10m" });
    expect(sanitizeModelOverride({ keepAlive: "0" })).toEqual({ keepAlive: "0" });
    expect(sanitizeModelOverride({ keepAlive: "-1" })).toEqual({ keepAlive: "-1" });
  });

  it("empty/invalid override → null (clear semantics)", () => {
    expect(sanitizeModelOverride({})).toBeNull();
    expect(sanitizeModelOverride(null)).toBeNull();
    expect(sanitizeModelOverride("x")).toBeNull();
  });
});

describe("resolveModelTuning — precedence: explicit request > per-model override > global default", () => {
  it("override fills the gaps the request left open", () => {
    expect(resolveModelTuning({}, { numCtx: 4096, temperature: 0.2 }, 8192)).toEqual({ numCtx: 4096, temperature: 0.2 });
  });

  it("an explicit request value beats the override", () => {
    expect(resolveModelTuning({ numCtx: 2048, temperature: 1 }, { numCtx: 4096, temperature: 0.2 }, 8192))
      .toEqual({ numCtx: 2048, temperature: 1 });
  });

  it("temperature 0 in the request is honored (?? not ||)", () => {
    expect(resolveModelTuning({ temperature: 0 }, { temperature: 0.9 }, 8192).temperature).toBe(0);
  });

  it("no override → today's defaults (db numCtx, 0.7)", () => {
    expect(resolveModelTuning({}, undefined, 8192)).toEqual({ numCtx: 8192, temperature: 0.7 });
  });
});

describe("resolveKeepAlive / withSystemOverride", () => {
  it("override > env > 30m default", () => {
    expect(resolveKeepAlive({ keepAlive: "10m" }, "5m")).toBe("10m");
    expect(resolveKeepAlive(undefined, "5m")).toBe("5m");
    expect(resolveKeepAlive(undefined, undefined)).toBe("30m");
  });

  it("prepends the override system message only when the conversation has none", () => {
    const msgs = [{ role: "user", content: "hi" }];
    expect(withSystemOverride(msgs, "Terse.")[0]).toEqual({ role: "system", content: "Terse." });
    const withSys = [{ role: "system", content: "existing" }, ...msgs];
    expect(withSystemOverride(withSys, "Terse.")).toEqual(withSys); // conversation's own system wins
    expect(withSystemOverride(msgs, undefined)).toEqual(msgs);
  });
});

describe("integration: persisted override reaches the ollama request payload", () => {
  it("num_ctx/temperature land in options, keep_alive top-level, system as first message", async () => {
    db.data.modelOverrides = {
      ...(db.data.modelOverrides ?? {}),
      "tune-me:1b": { numCtx: 4096, temperature: 0.15, keepAlive: "10m", system: "Terse." },
    };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: { content: "ok" }, done: true, eval_count: 3, eval_duration: 1_000_000_000 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const r = await ProviderRouter.generate({
      provider: "ollama-local",
      model: "tune-me:1b",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.text).toBe("ok");

    const call = spy.mock.calls.find((c) => String(c[0]).includes("/api/chat"));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.temperature).toBe(0.15);
    expect(body.keep_alive).toBe("10m");
    expect(body.messages[0]).toEqual({ role: "system", content: "Terse." });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("a model WITHOUT an override keeps today's defaults (no behavior change)", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "ok" }, done: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await ProviderRouter.generate({
      provider: "ollama-local",
      model: "tune-me:1b", // no override registered in this test
      messages: [{ role: "user", content: "hi" }],
    });
    const body = JSON.parse((spy.mock.calls.find((c) => String(c[0]).includes("/api/chat"))![1] as RequestInit).body as string);
    expect(body.options.num_ctx).toBe(db.data.ollamaNumCtx || 8192);
    expect(body.options.temperature).toBe(0.7);
    expect(body.messages[0].role).toBe("user"); // no synthetic system message
  });
});
