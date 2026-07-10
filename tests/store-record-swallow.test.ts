// M-005 (V4) — recordUsage / recordAudit are best-effort telemetry: every caller
// fires them WITHOUT await (server/store/index.ts:229-239, 266-273). A DB failure
// must therefore be swallowed (try/catch + console.warn) and NEVER surface as a
// throw or an unhandled promise rejection that could crash the request path.
//
// DB-fail injection: the store is not initialized here, so d() throws
// "Store not initialized" inside the try block — the exact failure the swallow
// must absorb. Removing the try/catch would let that throw propagate → the
// `.resolves` assertions and the zero-unhandled-rejection check both redden.
// Kod DEĞİŞMEZ (test-only, ⊘).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { recordUsage, recordAudit } from "../server/store";

let unhandled = 0;
const onUnhandled = () => { unhandled += 1; };

beforeAll(() => process.on("unhandledRejection", onUnhandled));
afterAll(() => process.off("unhandledRejection", onUnhandled));

describe("store best-effort swallow (M-005)", () => {
  test("recordUsage does not throw when the DB call fails", async () => {
    await expect(
      recordUsage({ tenantId: "t1", tool: "x", tier: "safe", ok: true, latencyMs: 1 }),
    ).resolves.toBeUndefined();
  });

  test("recordAudit does not throw when the DB call fails", async () => {
    await expect(
      recordAudit({ tenantId: "t1", tool: "x", tier: "safe", ok: false }),
    ).resolves.toBeUndefined();
  });

  test("firing both un-awaited (as callers do) yields no unhandled rejection", async () => {
    void recordUsage({ tenantId: "t2", tool: "y", tier: "safe", ok: true, latencyMs: 2 });
    void recordAudit({ tenantId: "t2", tool: "y", tier: "safe", ok: true });
    // Let any rejected microtask settle onto the unhandledRejection queue.
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toBe(0);
  });
});
