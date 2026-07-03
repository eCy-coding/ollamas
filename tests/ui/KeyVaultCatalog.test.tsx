// T2-F2 — catalog-driven KeyVault onboarding: provider rows derive from /api/keys/pool
// metadata (envKey/signupUrl/defaultModel/trainsOnData), so every catalog provider gets a
// key-add form + guided signup anchor without client hardcoding. Legacy rows unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderUI, mockFetch } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

const poolEntry = (over: Record<string, unknown> = {}) => ({
  total: 0, live: 0, worstPct: 0, allApproaching: false, ...over,
});

describe("KeyVault — catalog-driven onboarding (T2-F2)", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mockFetch({
      "/api/keys/mask": {},
      "/api/keys/pool": {
        pool: {
          gemini: poolEntry({ envKey: "GEMINI_API_KEY", signupUrl: "https://aistudio.google.com/apikey", defaultModel: "", trainsOnData: true }),
          groq: poolEntry({ envKey: "GROQ_API_KEY", signupUrl: "https://console.groq.com/keys", defaultModel: "llama-3.3-70b-versatile", trainsOnData: false }),
          cerebras: poolEntry({ envKey: "CEREBRAS_API_KEY", signupUrl: "https://cloud.cerebras.ai", defaultModel: "gpt-oss-120b", trainsOnData: false }),
        },
        alerts: [],
      },
    });
  });
  afterEach(() => openSpy.mockRestore());

  it("renders a row per pool provider: catalog providers get form + env placeholder + signup anchor", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Groq")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Key: GROQ_API_KEY")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Key: CEREBRAS_API_KEY")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /^Key$/i });
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("https://console.groq.com/keys");
    expect(hrefs).toContain("https://cloud.cerebras.ai");
  });

  it("flags providers whose free tier trains on prompts (sovereign privacy surface)", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Groq")).toBeInTheDocument());
    // gemini row carries the trains-on-prompts badge; groq must not
    expect(screen.getAllByText(/trains on prompts/i).length).toBe(1);
  });

  it("legacy rows keep their rich labels; custom-openai stays last with its endpoint field", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Google Gemini")).toBeInTheDocument());
    expect(screen.getByText("Custom OpenAI compatible")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Custom Base API Endpoint/)).toBeInTheDocument();
  });
});
