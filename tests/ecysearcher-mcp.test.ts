import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ecyBase, searchUrl, domainUrl, ipUrl, threatsUrl, urlForTool, TOOLS } from "../scripts/ecysearcher-mcp.mjs";

describe("ecysearcher-mcp — pure request builders", () => {
  const base = "http://localhost:5000";

  it("ecyBase default (remapped :5055) + env override", () => {
    expect(ecyBase({} as any)).toBe("http://localhost:5055");
    expect(ecyBase({ ECYSEARCHER_API_PORT: "5099" } as any)).toBe("http://localhost:5099");
    expect(ecyBase({ ECYSEARCHER_URL: "http://h:5050/" } as any)).toBe("http://h:5050");
  });

  it("all tools hit the ONE fixed unified endpoint /api/search/search with a type filter", () => {
    expect(searchUrl(base, { q: "example.com", type: "all", limit: 10 }))
      .toBe("http://localhost:5000/api/search/search?q=example.com&type=all&limit=10");
    expect(searchUrl(base, { q: "a b" })).toContain("q=a+b");
    expect(domainUrl(base, { name: "evil.test" })).toBe("http://localhost:5000/api/search/search?q=evil.test&type=domains&limit=50");
    expect(ipUrl(base, { ip: "1.2.3.4" })).toBe("http://localhost:5000/api/search/search?q=1.2.3.4&type=ips&limit=50");
    expect(threatsUrl(base, { limit: 5 })).toBe("http://localhost:5000/api/search/search?q=&type=threats&limit=5");
  });

  it("urlForTool dispatches by tool name; unknown throws", () => {
    expect(urlForTool("ecysearcher_search", { q: "x" }, {} as any)).toContain("/api/search/search?q=x");
    expect(urlForTool("ecysearcher_ip", { ip: "8.8.8.8" }, {} as any)).toContain("type=ips");
    expect(() => urlForTool("nope", {}, {} as any)).toThrow(/unknown tool/);
  });

  it("exposes 4 tools, each with a name + inputSchema", () => {
    expect(TOOLS.map((t: any) => t.name)).toEqual([
      "ecysearcher_search", "ecysearcher_domain", "ecysearcher_ip", "ecysearcher_threats",
    ]);
    for (const t of TOOLS as any[]) expect(t.inputSchema?.type).toBe("object");
  });
});

describe("ecysearcher-mcp — registered as a tools.json upstream", () => {
  it("tools.json has the ecysearcher stdio server with its 4 allowedTools", () => {
    const reg = JSON.parse(readFileSync(new URL("../tools.json", import.meta.url), "utf8"));
    const ecy = (reg.mcpServers || []).find((m: any) => m.name === "ecysearcher");
    expect(ecy).toBeTruthy();
    expect(ecy.transport).toBe("stdio");
    expect(ecy.allowedTools).toEqual(["ecysearcher_search", "ecysearcher_domain", "ecysearcher_ip", "ecysearcher_threats"]);
  });
});
