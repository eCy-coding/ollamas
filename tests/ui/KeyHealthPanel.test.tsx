// T9-F1 — the KeyHealthPanel consumes the always-running key-health loop (GET /api/keys/health)
// and renders the autonomous failover state: per-provider live/cooled/invalid/absent, the keyless
// (0-manual) set, convergence, and a signup link for non-live providers. Metadata only — no raw key.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderUI } from "./helpers";
import { KeyHealthPanel } from "../../src/components/cockpit/KeyHealthPanel";

const snapshot = {
  total: 4, live: 2, converged: false, keylessLive: ["github-models"], absent: ["cloudflare"], updatedAt: 1, degraded: false,
  providers: [
    { provider: "cerebras", status: "live", keyless: false, source: "vault" },
    { provider: "github-models", status: "live", keyless: true, source: "gh" },
    { provider: "groq", status: "cooled", keyless: false, cooledUntilMs: Date.now() + 240_000 }, // ~4m
    { provider: "cloudflare", status: "absent", keyless: false, signupUrl: "https://dash.cloudflare.com/819aa0/ai/workers-ai" },
  ],
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
    const body = url.includes("/api/keys/health") ? snapshot : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("KeyHealthPanel — autonomous failover surface (T9-F1)", () => {
  it("renders per-provider status pills + convergence + keyless badge", async () => {
    renderUI(<KeyHealthPanel />);
    await waitFor(() => expect(screen.getByText("cerebras")).toBeInTheDocument());
    expect(screen.getByText(/2\/4 live/)).toBeInTheDocument();
    expect(screen.getByText("groq")).toBeInTheDocument();
    // github-models is keyless (0-manual)
    expect(screen.getByText(/0-manual/)).toBeInTheDocument();
    // the cooled provider shows when it auto-recovers
    expect(screen.getByText(/recovers in \dm/)).toBeInTheDocument();
  });

  it("shows a signup link only for non-live providers", async () => {
    renderUI(<KeyHealthPanel />);
    const link = await screen.findByRole("link", { name: /key/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("dash.cloudflare.com"));
  });

  it("SECURITY: never renders a raw-key-shaped string", async () => {
    renderUI(<KeyHealthPanel />);
    await waitFor(() => expect(screen.getByText("cerebras")).toBeInTheDocument());
    expect(document.body.innerHTML).not.toMatch(/gsk_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}|csk-[A-Za-z0-9]{8,}/);
  });
});
