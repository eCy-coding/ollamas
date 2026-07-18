import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { AssistDrawer } from "../../src/components/AssistDrawer";

vi.mock("../../src/lib/apiClient", () => ({
  api: { streamPost: vi.fn() },
}));
import { api } from "../../src/lib/apiClient";

function stubStream(frames: string[]) {
  vi.mocked(api.streamPost).mockImplementation(async (_ep, _body, opts?: { onChunk?: (t: string) => void }) => {
    for (const f of frames) opts?.onChunk?.(`data: ${f}\n\n`);
  });
}

describe("AssistDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the Ask-eCy button and calls the right panel endpoint with context", async () => {
    stubStream([JSON.stringify({ chunk: "ok" }), JSON.stringify({ done: true })]);
    renderUI(<AssistDrawer panelId="github-actions" context={() => "run#42 failed"} />);
    fireEvent.click(screen.getByText("eCy'ye Sor"));
    await waitFor(() => {
      expect(api.streamPost).toHaveBeenCalledWith(
        "/api/ecym/panel/github-actions",
        { context: "run#42 failed" },
        expect.anything(),
      );
    });
  });

  it("streams the specialist answer and strips <think> traces", async () => {
    stubStream([JSON.stringify({ chunk: "<think>scratch</think>Root cause: cache miss." })]);
    renderUI(<AssistDrawer panelId="threatintel" context={() => "ctx"} />);
    fireEvent.click(screen.getByText("eCy'ye Sor"));
    await waitFor(() => expect(screen.getByText("Root cause: cache miss.")).toBeInTheDocument());
    expect(screen.queryByText(/scratch/)).not.toBeInTheDocument();
  });

  it("surfaces a stream error honestly", async () => {
    stubStream([JSON.stringify({ error: "GPU busy" })]);
    renderUI(<AssistDrawer panelId="keys" context={() => "provider=openai status=active"} />);
    fireEvent.click(screen.getByText("eCy'ye Sor"));
    await waitFor(() => expect(screen.getByText("GPU busy")).toBeInTheDocument());
  });
});
