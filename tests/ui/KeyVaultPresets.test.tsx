// T7-F2 — the custom-OpenAI row exposes one-click endpoint presets (local Ollama / LM Studio
// / vLLM). Clicking a preset fills the endpoint input with zero typing — minimum-manual
// onboarding of a local OpenAI-compatible host.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { KeyVault } from "../../src/components/KeyVault";

beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => null);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
    let body: unknown = {};
    if (url.includes("/api/keys/pool")) body = { pool: {}, alerts: [] };
    else if (url.includes("/api/keys/mask")) body = {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("KeyVault — custom-OpenAI presets (T7-F2)", () => {
  it("clicking the local Ollama preset fills the endpoint input", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    const presetBtn = await screen.findByRole("button", { name: /local ollama/i });
    fireEvent.click(presetBtn);
    const endpoint = screen.getByPlaceholderText(/custom base api endpoint/i) as HTMLInputElement;
    expect(endpoint.value).toBe("http://localhost:11434/v1");
  });

  it("renders all three local-host presets", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /local ollama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lm studio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /vllm/i })).toBeInTheDocument();
  });

  it("LM Studio and vLLM presets fill their respective ports", async () => {
    renderUI(<KeyVault onNotify={vi.fn()} />);
    const endpoint = () => screen.getByPlaceholderText(/custom base api endpoint/i) as HTMLInputElement;
    fireEvent.click(await screen.findByRole("button", { name: /lm studio/i }));
    expect(endpoint().value).toBe("http://localhost:1234/v1");
    fireEvent.click(screen.getByRole("button", { name: /vllm/i }));
    expect(endpoint().value).toBe("http://localhost:8000/v1");
  });
});
