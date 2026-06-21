import { describe, it, expect, afterEach } from "vitest";
import { GatewayClient } from "../cli/lib/client";

const original = globalThis.fetch;
afterEach(() => (globalThis.fetch = original));

// Capture the last fetch call so we can assert headers/url/method.
function spy(status: number, body: any) {
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as any;
  return calls;
}

describe("GatewayClient SaaS admin surface", () => {
  it("sends X-Admin-Token on admin GETs", async () => {
    const calls = spy(200, [{ id: "tnt_1", name: "acme" }]);
    const client = new GatewayClient("http://x", undefined, "secret-token");
    const tenants = await client.listTenants();
    expect(tenants[0].name).toBe("acme");
    expect(calls[0].url).toBe("http://x/api/saas/tenants");
    expect(calls[0].init.headers["X-Admin-Token"]).toBe("secret-token");
  });

  it("listKeys requires tenantId in the query", async () => {
    const calls = spy(200, []);
    const client = new GatewayClient("http://x", undefined, "t");
    await client.listKeys("tnt_9");
    expect(calls[0].url).toBe("http://x/api/saas/keys?tenantId=tnt_9");
  });

  it("createKey returns the plaintext key once", async () => {
    spy(200, { id: "key_1", key: "olm_abc123", expiresAt: null });
    const client = new GatewayClient("http://x", undefined, "t");
    const k = await client.createKey({ tenantId: "tnt_1", label: "ci" });
    expect(k.key).toBe("olm_abc123");
    expect(k.id).toBe("key_1");
  });

  it("createTenant POSTs the body with admin header", async () => {
    const calls = spy(200, { id: "tnt_2", name: "beta", plan_id: "pro" });
    const client = new GatewayClient("http://x", undefined, "t");
    const t = await client.createTenant({ name: "beta", plan: "pro" });
    expect(t.id).toBe("tnt_2");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: "beta", plan: "pro" });
    expect(calls[0].init.headers["X-Admin-Token"]).toBe("t");
  });

  it("maps 401 to an actionable admin-token hint", async () => {
    spy(401, { error: "Bad admin token" });
    const client = new GatewayClient("http://x", undefined, "wrong");
    await expect(client.listTenants()).rejects.toThrow(/OLLAMAS_SAAS_ADMIN|saasAdminToken/);
  });

  it("maps 403 to an actionable admin-token hint", async () => {
    spy(403, { error: "Admin disabled" });
    const client = new GatewayClient("http://x");
    await expect(client.listPlans()).rejects.toThrow(/admin auth/);
  });

  it("hasAdminToken reflects the constructor arg", () => {
    expect(new GatewayClient("http://x").hasAdminToken()).toBe(false);
    expect(new GatewayClient("http://x", undefined, "t").hasAdminToken()).toBe(true);
  });

  it("billingPreview passes the period query", async () => {
    const calls = spy(200, { period: "2026-06", dryRun: true, lines: [], total: 0 });
    const client = new GatewayClient("http://x", undefined, "t");
    const r = await client.billingPreview("2026-06");
    expect(r.period).toBe("2026-06");
    expect(calls[0].url).toBe("http://x/api/billing/preview?period=2026-06");
  });
});
