import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderUI, mockFetch } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

describe("KeyVault — sustainable key-pool UI (P3/P4)", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mockFetch({
      "/api/keys/mask": {},
      "/api/keys/pool": {
        pool: { gemini: { total: 2, live: 2, worstPct: 0.85, allApproaching: true } },
        alerts: [{ provider: "gemini", worstPct: 0.85, live: 2 }],
      },
    });
  });
  afterEach(() => openSpy.mockRestore());

  it("renders the approaching-limit alert + pool burn meter + a clickable key-page anchor", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Rate-limit approaching/i)).toBeInTheDocument());
    expect(screen.getByText(/gemini 85% \(2 live\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pool 2\/2 · 85%/)).toBeInTheDocument();
    // the banner offers a guaranteed one-click anchor to the saturating provider's key page
    const bannerLink = screen.getByRole("link", { name: /Open gemini key page/i });
    expect(bannerLink).toHaveAttribute("href", expect.stringContaining("aistudio.google.com/apikey"));
    expect(bannerLink).toHaveAttribute("target", "_blank");
  });

  it("the guided 'Key' control is a popup-safe anchor to the provider key page", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /^Key$/i }).length).toBeGreaterThan(0));
    const keyLink = screen.getAllByRole("link", { name: /^Key$/i })[0];
    expect(keyLink).toHaveAttribute("href", expect.stringContaining("aistudio.google.com/apikey"));
    expect(keyLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("auto-opens the key page once when a provider's pool saturates", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    const geminiOpens = openSpy.mock.calls.filter((c) => String(c[0]).includes("aistudio.google.com/apikey"));
    expect(geminiOpens.length).toBe(1); // fired once, not re-opened on the 15s poll
  });
});
