import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { ResearchPanel } from "../../src/components/ResearchPanel";

vi.mock("../../src/lib/apiClient", () => ({ api: { streamPost: vi.fn() } }));
import { api } from "../../src/lib/apiClient";

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
// Emit a full happy-path SSE conversation through the onChunk callback.
function stubStream(frames: string[]) {
  vi.mocked(api.streamPost).mockImplementation(
    async (_ep: string, _body: unknown, opts: { onChunk: (t: string) => void }) => {
      for (const f of frames) opts.onChunk(f);
    },
  );
}
const type = (q: string) => fireEvent.change(screen.getByPlaceholderText(/research/i), { target: { value: q } });

describe("ResearchPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders header, input and run button", () => {
    renderUI(<ResearchPanel />);
    expect(screen.getByText("Deep Research")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/research/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Research/i })).toBeInTheDocument();
  });

  it("shows the four progress stages", () => {
    renderUI(<ResearchPanel />);
    for (const s of ["Plan", "Fetch", "Summarize", "Synthesize"]) expect(screen.getByText(s)).toBeInTheDocument();
  });

  it("refuses to run on an empty query (onNotify error, no stream)", () => {
    const onNotify = vi.fn();
    renderUI(<ResearchPanel onNotify={onNotify} />);
    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    expect(onNotify).toHaveBeenCalledWith("Enter a research question", "error");
    expect(api.streamPost).not.toHaveBeenCalled();
  });

  it("streams stages, report and sources on a completed run", async () => {
    stubStream([
      frame({ stage: "plan", status: "done", text: "2 queries" }),
      frame({ stage: "fetch", status: "done", text: "2 sources" }),
      frame({ stage: "synthesize", status: "running", text: "TypeScript " }),
      frame({ stage: "synthesize", status: "running", text: "adds types [1]." }),
      frame({ stage: "synthesize", status: "done", report: "TypeScript adds types [1].", done: true, sources: [{ title: "TS Home", url: "https://ts.dev" }] }),
    ]);
    const onNotify = vi.fn();
    renderUI(<ResearchPanel onNotify={onNotify} />);
    type("what is typescript");
    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    await waitFor(() => {
      expect(screen.getByText("2 sources")).toBeInTheDocument();
      expect(screen.getByText(/TypeScript adds types \[1\]\./)).toBeInTheDocument();
      expect(screen.getByText("TS Home")).toBeInTheDocument();
    });
    expect(onNotify).toHaveBeenCalledWith("Research complete", "success");
  });

  it("shows an honest no-results report without inventing sources", async () => {
    stubStream([
      frame({ stage: "fetch", status: "done", text: "No sources found" }),
      frame({ stage: "synthesize", status: "done", report: "No web sources were found for this query.", done: true, sources: [] }),
    ]);
    renderUI(<ResearchPanel />);
    type("obscure question");
    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    await waitFor(() => expect(screen.getByText(/No web sources were found/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Sources \(/)).not.toBeInTheDocument();
  });

  it("surfaces a stream error frame", async () => {
    stubStream([frame({ stage: "error", status: "fail", error: "search backend down" })]);
    const onNotify = vi.fn();
    renderUI(<ResearchPanel onNotify={onNotify} />);
    type("q");
    fireEvent.click(screen.getByRole("button", { name: /Research/i }));
    await waitFor(() => expect(screen.getByText(/search backend down/)).toBeInTheDocument());
    expect(onNotify).toHaveBeenCalledWith("search backend down", "error");
  });
});
