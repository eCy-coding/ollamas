import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderUI, mockFetch } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

describe("KeyVault — sustainable key-pool UI (P3/P4)", () => {
  beforeEach(() => {
    mockFetch({
      "/api/keys/mask": {},
      "/api/keys/pool": {
        pool: { gemini: { total: 2, live: 2, worstPct: 0.85, allApproaching: true } },
        alerts: [{ provider: "gemini", worstPct: 0.85, live: 2 }],
      },
    });
  });

  it("renders the approaching-limit alert + pool burn meter", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Rate-limit approaching/i)).toBeInTheDocument());
    expect(screen.getByText(/gemini 85% \(2 live\)/i)).toBeInTheDocument();
    expect(screen.getByText(/pool 2\/2 · 85%/)).toBeInTheDocument();
  });

  it("the guided 'Key' button opens the provider key page", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const onNotify = vi.fn();
    renderUI(<KeyVault onNotify={onNotify} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Key/i }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /^Key$/i })[0]);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("aistudio.google.com/apikey"), "_blank", "noopener");
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("next account"), "info");
  });
});
