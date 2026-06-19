import { describe, it, expect } from "vitest";
import {
  extractRoutes, extractCalls, extractRegistrations, normalizePath, gapAnalysis, toMermaid,
} from "../bin/lib/graph";

describe("extractRoutes", () => {
  it("app/router . method (quote + template)", () => {
    const src = `
      app.get("/api/health", h);
      router.post('/api/users', h);
      app.put(\`/api/users/:id\`, h);
      app.use("/static", s);   // method değil → atlanır
    `;
    const r = extractRoutes(src);
    expect(r).toContainEqual({ method: "GET", path: "/api/health" });
    expect(r).toContainEqual({ method: "POST", path: "/api/users" });
    expect(r).toContainEqual({ method: "PUT", path: "/api/users/:id" });
  });
});

describe("extractCalls", () => {
  it("/api/* literalleri, query atılır, /api olmayan atlanır", () => {
    const src = `
      fetch('/api/foo');
      apiClient.get("/api/bar?q=1");
      const x = \`/api/baz/\${id}\`;
      fetch('/healthz');  // /api değil
    `;
    const c = extractCalls(src);
    expect(c).toContain("/api/foo");
    expect(c).toContain("/api/bar");
    expect(c).toContain("/api/baz/${id}");
    expect(c).not.toContain("/healthz");
  });
});

describe("extractRegistrations", () => {
  it("registry/ToolRegistry.register isimleri", () => {
    const src = `registry.register("fs.read", d); ToolRegistry.register('net.fetch', d);`;
    expect(extractRegistrations(src).sort()).toEqual(["fs.read", "net.fetch"]);
  });
});

describe("normalizePath", () => {
  it(":param / sayı / ${tpl} → * (hepsi aynı)", () => {
    expect(normalizePath("/api/u/:id")).toBe("/api/u/*");
    expect(normalizePath("/api/u/123")).toBe("/api/u/*");
    expect(normalizePath("/api/u/${x}")).toBe("/api/u/*");
  });
  it("query at + trailing slash at", () => {
    expect(normalizePath("/api/x?q=1")).toBe("/api/x");
    expect(normalizePath("/api/x/")).toBe("/api/x");
  });
});

describe("gapAnalysis", () => {
  it("missing/matched/unused doğru ayrışır (param-route concrete call ile eşleşir)", () => {
    const routes = [
      { method: "GET", path: "/api/a" },
      { method: "GET", path: "/api/u/:id" },
      { method: "GET", path: "/api/dead" },
    ];
    const calls = ["/api/a", "/api/u/5", "/api/missing"];
    const g = gapAnalysis(routes, calls);
    expect(g.missing).toEqual(["/api/missing"]);
    expect(g.matched.sort()).toEqual(["/api/a", "/api/u/*"]);
    expect(g.unused).toContain("/api/dead");
    expect(g.unused).not.toContain("/api/a");
  });
});

describe("toMermaid", () => {
  it("graph LR + etiketli kenar", () => {
    const md = toMermaid([{ from: "frontend", to: "backend", matched: 3, missing: 1 }]);
    expect(md).toMatch(/^graph LR/);
    expect(md).toMatch(/frontend.*-->\|3✓ 1✗\|.*backend/);
  });
});
