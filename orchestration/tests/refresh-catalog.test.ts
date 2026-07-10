// refresh-catalog.test.ts — behavior of refresh-catalog.ts pure output contract (human + JSON lines).
import { describe, it, expect } from "vitest";
import { formatRefresh } from "../bin/lib/refresh-catalog-core";

describe("refresh-catalog/formatRefresh", () => {
  it("human line reports the fresh task count on success", () => {
    expect(formatRefresh({ ok: true, count: 351 }, false)).toBe("[refresh-catalog] TASKS.json = 351 tasks (fresh)");
  });
  it("json line emits {ok,count} on success (parseable, no extra fields)", () => {
    expect(JSON.parse(formatRefresh({ ok: true, count: 7 }, true))).toEqual({ ok: true, count: 7 });
  });
  it("human line reports the error message on failure", () => {
    expect(formatRefresh({ ok: false, error: "boom" }, false)).toBe("[refresh-catalog] hata: boom");
  });
  it("json line emits {ok:false,error} on failure", () => {
    expect(JSON.parse(formatRefresh({ ok: false, error: "boom" }, true))).toEqual({ ok: false, error: "boom" });
  });
});
