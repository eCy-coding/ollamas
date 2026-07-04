// T8 — the Cloudflare Workers AI row is guaranteed: it renders even when /api/keys/pool is
// empty (fetch hiccup / stale session), because it is a BASE row, not pool-derived. This is
// the regression guard for "cloudflare key row not showing" — the SSE pool overwrite / an
// empty pool must never make the onboarding form disappear.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderUI } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => null);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
    let body: unknown = {};
    if (url.includes("/api/keys/pool")) body = { pool: {}, alerts: [] }; // empty pool
    else if (url.includes("/api/keys/mask")) body = {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("KeyVault — Cloudflare guaranteed row (T8)", () => {
  it("renders the Cloudflare Workers AI row even with an empty pool", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    expect(await screen.findByText(/Cloudflare Workers AI/i)).toBeInTheDocument();
  });

  it("shows the CLOUDFLARE_API_TOKEN key field for the row", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    expect(await screen.findByPlaceholderText(/CLOUDFLARE_API_TOKEN/i)).toBeInTheDocument();
  });
});
