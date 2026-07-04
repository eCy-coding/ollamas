// T7-F1 — Cloudflare account_id auto-derivation: with only a valid Workers AI token, a
// GET /client/v4/accounts returns the account, so the operator never copies the id.
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseCloudflareAccounts, deriveCloudflareAccountId } from "../server/cloudflare";

afterEach(() => vi.unstubAllGlobals());

describe("parseCloudflareAccounts (pure)", () => {
  it("returns the first account id from the /accounts result", () => {
    expect(parseCloudflareAccounts({ success: true, result: [{ id: "acct_abc", name: "Emre" }] })).toBe("acct_abc");
  });
  it("empty / malformed → null (caller surfaces an honest config error)", () => {
    expect(parseCloudflareAccounts({ success: true, result: [] })).toBeNull();
    expect(parseCloudflareAccounts({})).toBeNull();
    expect(parseCloudflareAccounts(null)).toBeNull();
    expect(parseCloudflareAccounts({ result: "nope" })).toBeNull();
  });
});

describe("deriveCloudflareAccountId — GET /accounts with the token", () => {
  it("bearer token → account id from the live response", async () => {
    let seenAuth = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: any, init: any) => {
      seenAuth = init.headers.Authorization;
      return new Response(JSON.stringify({ success: true, result: [{ id: "acct_live" }] }), { status: 200 });
    }));
    const id = await deriveCloudflareAccountId("cf_token_xyz");
    expect(id).toBe("acct_live");
    expect(seenAuth).toBe("Bearer cf_token_xyz");
  });
  it("non-200 or empty → null (never throws into the connect path)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    expect(await deriveCloudflareAccountId("bad")).toBeNull();
  });
});
