import { describe, test, expect } from "vitest";
import { checkIntegrations } from "../server/integrations-health";
import type { FetchLike } from "../server/threatfeed";

// Fake feed fetch → one live source so threat-feed probes "ok" deterministically.
const okFeed: FetchLike = async () => ({ ok: true, status: 200, text: async () => "<rss><channel><item><title>x</title><pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>" });
const allAvail = () => true;
// Injected GitHub validators — keep the health check offline + deterministic.
const okGh = async () => ({ ok: true, login: "emre", tokenType: "classic" as const, scopes: ["repo"] });
const badGh = async () => ({ ok: false, tokenType: "classic" as const, scopes: [], status: 401, error: "token geçersiz veya süresi dolmuş" });

describe("checkIntegrations", () => {
  test("returns all expected integration ids", async () => {
    const rows = await checkIntegrations({ token: "gho_x", isAvailable: allAvail, feedFetch: okFeed, ghValidate: okGh });
    const ids = rows.map((r) => r.id);
    for (const id of ["github", "mcp-npx", "mcp-uvx", "threat-feed", "github-search"]) expect(ids).toContain(id);
    for (const r of rows) { expect(r.purpose.length).toBeGreaterThan(5); expect(r.lane.length).toBeGreaterThan(0); }
  });

  test("github: ok on VALID token (shows login), degraded on invalid, needs-setup when absent", async () => {
    const withTok = await checkIntegrations({ token: "gho_x", isAvailable: allAvail, feedFetch: okFeed, ghValidate: okGh });
    const okRow = withTok.find((r) => r.id === "github")!;
    expect(okRow.status).toBe("ok");
    expect(okRow.detail).toMatch(/emre/); // live login surfaced, not a blind green
    const invalid = await checkIntegrations({ token: "gho_bad", isAvailable: allAvail, feedFetch: okFeed, ghValidate: badGh });
    expect(invalid.find((r) => r.id === "github")!.status).toBe("degraded"); // was falsely "ok" before v14
    const noTok = await checkIntegrations({ token: "", isAvailable: allAvail, feedFetch: okFeed });
    const gh = noTok.find((r) => r.id === "github")!;
    expect(gh.status).toBe("needs-setup");
    expect(gh.fix).toMatch(/gh CLI|PAT/i);
  });

  test("uvx missing → needs-setup with brew hint; npx present → ok", async () => {
    const rows = await checkIntegrations({ token: "gho_x", isAvailable: (c) => c === "npx", feedFetch: okFeed, ghValidate: okGh });
    expect(rows.find((r) => r.id === "mcp-npx")!.status).toBe("ok");
    const uvx = rows.find((r) => r.id === "mcp-uvx")!;
    expect(uvx.status).toBe("needs-setup");
    expect(uvx.fix).toMatch(/brew install uv/);
  });

  test("github-search degraded when anon (no token)", async () => {
    const rows = await checkIntegrations({ token: "", isAvailable: allAvail, feedFetch: okFeed });
    const s = rows.find((r) => r.id === "github-search")!;
    expect(s.status).toBe("degraded");
    expect(s.detail).toMatch(/10\/dk|kod araması/);
  });
});
