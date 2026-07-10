import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { CookbookPanel } from "../../src/components/CookbookPanel";

vi.mock("../../src/lib/apiClient", () => ({
  api: { get: vi.fn(), streamPost: vi.fn() },
}));
import { api } from "../../src/lib/apiClient";

const RECIPES = [
  { id: "summarize-text", name: "Summarize Text", description: "Condense text", instructions: "…", tags: ["text"] },
  { id: "code-review", name: "Code Review", description: "Review code", instructions: "…", tags: ["code"] },
];

// api.get is used for both the recipe list and the (best-effort) history fetch.
function stubGet(recipes = RECIPES) {
  vi.mocked(api.get).mockImplementation(async (ep: string) =>
    (ep.includes("/executions") ? [] : recipes) as unknown as never,
  );
}

describe("CookbookPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the header", async () => {
    stubGet([]);
    renderUI(<CookbookPanel />);
    expect(screen.getByText("Recipe Library")).toBeInTheDocument();
  });

  it("fetches and renders recipe cards on mount", async () => {
    stubGet();
    renderUI(<CookbookPanel />);
    await waitFor(() => {
      expect(screen.getByText("Summarize Text")).toBeInTheDocument();
      expect(screen.getByText("Code Review")).toBeInTheDocument();
    });
  });

  it("shows one Run button per recipe and renders tags", async () => {
    stubGet();
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Run/i })).toHaveLength(2));
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("shows an honest empty state when there are no recipes", async () => {
    stubGet([]);
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText(/No recipes yet/i)).toBeInTheDocument());
  });

  it("streams SSE output when Run is clicked", async () => {
    stubGet();
    vi.mocked(api.streamPost).mockImplementation(async (_ep: string, _body: unknown, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('data: {"chunk":"Hello "}\n\n');
      opts.onChunk('data: {"chunk":"World"}\n\n');
      opts.onChunk('data: {"done":true}\n\n');
    });
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText("Summarize Text")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Run/i })[0]);
    await waitFor(() => expect(screen.getByText(/Hello World/)).toBeInTheDocument());
  });

  it("fires onNotify success after a completed run", async () => {
    stubGet();
    const onNotify = vi.fn();
    vi.mocked(api.streamPost).mockImplementation(async (_e: string, _b: unknown, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('data: {"chunk":"done"}\n\n');
    });
    renderUI(<CookbookPanel onNotify={onNotify} />);
    await waitFor(() => expect(screen.getByText("Summarize Text")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Run/i })[0]);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("Recipe complete", "success"));
  });

  it("surfaces an error frame from the stream", async () => {
    stubGet();
    vi.mocked(api.streamPost).mockImplementation(async (_e: string, _b: unknown, opts: { onChunk: (t: string) => void }) => {
      opts.onChunk('data: {"error":"model offline"}\n\n');
    });
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText("Summarize Text")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Run/i })[0]);
    await waitFor(() => expect(screen.getByText(/model offline/)).toBeInTheDocument());
  });

  it("shows an error banner when the recipe list fails to load", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network down"));
    renderUI(<CookbookPanel />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
  });
});
