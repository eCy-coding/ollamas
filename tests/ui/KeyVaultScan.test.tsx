// T6-F1 — the KeyVault "Scan & Connect" button POSTs /api/keys/doctor and renders the
// masked result: per-provider status, capability→role suggestions, and signup anchors for
// absent providers. Zero-manual key harvest from the Key section.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

const doctorReport = {
  dryRun: false,
  providers: {
    "github-models": { status: "connected", source: "gh", keyMasked: "…TRQB", capabilitiesActivated: ["code", "tools"] },
    groq: { status: "already", source: "vault", keyMasked: "…9xY2", capabilitiesActivated: ["code", "fast", "tools", "stt"] },
    mistral: { status: "absent", capabilitiesActivated: [], nextManualUrl: "https://console.mistral.ai/api-keys" },
  },
  capabilityReport: { code: ["github-models", "groq"], stt: ["groq"] },
  roleSuggestions: { "cloud-alt": ["github-models", "groq"], "fast-verify": ["groq"], adversarial: ["github-models"] },
};

beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => null);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
    let body: unknown = {};
    if (url.includes("/api/keys/doctor")) body = doctorReport;
    else if (url.includes("/api/keys/pool")) body = { pool: {}, alerts: [] };
    else if (url.includes("/api/keys/mask")) body = {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("KeyVault — Scan & Connect (T6-F1)", () => {
  it("clicking Scan posts to /api/keys/doctor and renders per-provider status + capabilities", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    const scanBtn = await screen.findByRole("button", { name: /scan.*connect|tara.*ba/i });
    fireEvent.click(scanBtn);
    await waitFor(() => expect(screen.getByText(/connected/i)).toBeInTheDocument());
    // masked key surfaced, never raw
    expect(screen.getByText(/…TRQB/)).toBeInTheDocument();
    // absent provider offers its signup anchor
    const link = screen.getByRole("link", { name: /get key/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("console.mistral.ai"));
  });

  it("renders capability→role suggestions from the doctor report", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /scan.*connect|tara.*ba/i }));
    await waitFor(() => expect(screen.getByText(/cloud-alt/i)).toBeInTheDocument());
    expect(screen.getByText(/fast-verify/i)).toBeInTheDocument();
  });

  it("SECURITY: the rendered scan result never contains a raw-key-shaped string", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /scan.*connect|tara.*ba/i }));
    await waitFor(() => expect(screen.getByText(/connected/i)).toBeInTheDocument());
    expect(document.body.innerHTML).not.toMatch(/gsk_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}/);
  });
});
