// completion-scan.test.ts — scan-level flow of bin/completion-scan.ts: a fake CensusInput drives
// analyzeCompletion → renderCompletionReport (expected sections), the real-vs-string marker-line
// discrimination the stub census relies on, and the route/call gap analysis on synthetic source
// (graph primitives + the proxy-prefix false-positive filter, wired exactly as census() wires them).
// Lib-level per-function edge cases live in completion.test.ts / depgraph.test.ts — not repeated here.
import { describe, it, expect } from "vitest";
import { analyzeCompletion, renderCompletionReport, filterProxiedMissing, isRealMarkerLine, type CensusInput } from "../bin/lib/completion";
import { extractRoutes, extractCalls, gapAnalysis } from "../bin/lib/graph";

// ── synthetic backend/frontend sources (the census route-drift slice, end to end) ─────────────────────
const SERVER_SRC = `
import express from "express";
const app = express();
app.get("/api/users", (req, res) => res.json([]));
app.post("/api/items/:id", (req, res) => res.sendStatus(204));
app.get("/api/dead", (req, res) => res.json({ legacy: true }));
app.use("/api/proxy", proxyRouter);
`;
const FRONTEND_SRC = `
await fetch("/api/users");
await fetch(\`/api/items/\${id}\`);
await fetch("/api/ghost");
await fetch("/api/proxy/deep/thing");
`;

describe("route/call gap analysis on a synthetic snippet (census route-drift flow)", () => {
  const routes = extractRoutes(SERVER_SRC);
  const calls = extractCalls(FRONTEND_SRC);
  const g = gapAnalysis(routes, calls);
  // exactly what census() does: app.use("/api/…") mounts are collected as proxy prefixes …
  const proxyPrefixes = [...SERVER_SRC.matchAll(/\bapp\.use\(\s*['"`](\/api\/[^'"`]+)['"`]/g)].map((m) => m[1]);
  // … and proxy-served calls are dropped from "missing" before reporting.
  const missing = filterProxiedMissing(g.missing, proxyPrefixes);

  it("extractRoutes sees get/post but NOT app.use mounts", () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /api/dead", "GET /api/users", "POST /api/items/:id",
    ]);
  });
  it("extractCalls captures literal + template /api calls", () => {
    expect(calls.sort()).toEqual(["/api/ghost", "/api/items/${id}", "/api/proxy/deep/thing", "/api/users"].sort());
  });
  it("param route matches templated call; truly absent endpoint + proxy sub-path are raw-missing", () => {
    expect(g.matched).toContain("/api/users");
    expect(g.matched).toContain("/api/items/*"); // :id ↔ ${id} both normalize to *
    expect(g.missing.sort()).toEqual(["/api/ghost", "/api/proxy/deep/thing"].sort());
  });
  it("filterProxiedMissing drops the proxy-mounted sub-path (false positive) but keeps the real gap", () => {
    expect(proxyPrefixes).toEqual(["/api/proxy"]);
    expect(missing).toEqual(["/api/ghost"]);
  });
  it("never-called backend route is unused", () => {
    expect(g.unused).toEqual(["/api/dead"]);
  });
});

describe("isRealMarkerLine — real comment marker vs incidental string/regex mention", () => {
  it("accepts real code-comment markers", () => {
    expect(isRealMarkerLine("  // TODO: wire the retry path")).toBe(true);
    expect(isRealMarkerLine("# FIXME: quote this properly")).toBe(true);
    expect(isRealMarkerLine("   * HACK around the vite cache")).toBe(true);
  });
  it("rejects the word inside a string literal (grep arg) — no comment opener", () => {
    expect(isRealMarkerLine('const grepArgs = ["-E", "TODO|FIXME|HACK|XXX"];')).toBe(false);
  });
  it("rejects a detector's own regex alternation", () => {
    expect(isRealMarkerLine("const re = /(TODO|FIXME)/;")).toBe(false);
  });
  it("rejects a comment line that merely QUOTES the marker word (detector description)", () => {
    expect(isRealMarkerLine('// files containing "TODO" are flagged by the scanner')).toBe(false);
  });
  it("rejects a bare identifier with no comment opener", () => {
    expect(isRealMarkerLine("let TODO = 1;")).toBe(false);
  });
  it("rejects lines without any marker word at all", () => {
    expect(isRealMarkerLine("// totally done here")).toBe(false);
  });
});

// ── fake census → analyze → render: the exact main() pipeline, IO-free ────────────────────────────────
const CENSUS: CensusInput = {
  langs: [{ ext: "ts", count: 100 }, { ext: "mjs", count: 10 }, { ext: "sh", count: 3 }],
  mjsByDir: [{ dir: "scripts", count: 8 }, { dir: "bin/host-bridge", count: 2 }],
  mjsTotal: 10,
  shCount: 3,
  stubFiles: ["server/analyzer.ts"],
  sparseDirs: [{ dir: "backend", count: 2 }],
  routeGap: { missing: ["/api/ghost"], unused: ["/api/dead"] },
  centralTests: 42,
  mjsChecked: 4,
};

describe("analyzeCompletion on the fake census", () => {
  const gaps = analyzeCompletion(CENSUS);

  it("derives one gap per scanned fact — 5 total (migration, missing, unused, stub, sparse)", () => {
    expect(gaps.map((g) => g.kind).sort()).toEqual(
      ["language-migration", "route-missing", "route-unused", "sparse-folder", "stub"].sort());
  });
  it("severities: missing route P1; ≤50 .mjs migration P2; unused/sparse P3", () => {
    const by = Object.fromEntries(gaps.map((g) => [g.kind, g.severity]));
    expect(by["route-missing"]).toBe("P1");
    expect(by["language-migration"]).toBe("P2");
    expect(by["route-unused"]).toBe("P3");
    expect(by["sparse-folder"]).toBe("P3");
  });
  it("every gap carries evidence + justification + an owning fleet stream", () => {
    for (const g of gaps) {
      expect(g.evidence.length).toBeGreaterThan(0);
      expect(g.justification.length).toBeGreaterThan(0);
      expect(g.ownerStream.length).toBeGreaterThan(0);
    }
    expect(gaps.find((g) => g.kind === "language-migration")!.ownerStream).toBe("mjs-migration");
  });
});

describe("renderCompletionReport — expected sections and facts", () => {
  const gaps = analyzeCompletion(CENSUS);
  const md = renderCompletionReport(gaps, CENSUS, "2026-07-04T00:00:00Z");

  it("contains all five sections §A–§E", () => {
    for (const s of ["## §A — Language breakdown", "## §B — Missing code", "## §C — Missing / sparse folders",
      "## §D — Missing / under-migrated languages", "## §E — Task distribution"]) {
      expect(md).toContain(s);
    }
  });
  it("verdict line counts severities honestly", () => {
    expect(md).toContain("## Verdict: 5 gap(s) — 1 P1 · 2 P2 · 2 P3");
  });
  it("language table + centralized-tests false-positive guard are stated", () => {
    expect(md).toContain("| .ts | 100 |");
    expect(md).toContain("(42 files)");
  });
  it("§D reports the in-place @ts-check migration progress 4/10", () => {
    expect(md).toContain("**4/10**");
  });
  it("§B lists the P1 missing route with its evidence; §E groups by owning stream", () => {
    expect(md).toContain("`/api/ghost`");
    expect(md).toContain("### `typescript-core`");
    expect(md).toContain("### `mjs-migration`");
  });
  it("timestamp is embedded (report provenance)", () => {
    expect(md).toContain("2026-07-04T00:00:00Z");
  });
});
