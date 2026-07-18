import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { ChatPanel } from "../../src/components/ChatPanel";

vi.mock("../../src/lib/apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), streamPost: vi.fn() },
}));
import { api } from "../../src/lib/apiClient";

// Mount fetches: models + session list. Keep both empty/simple.
function stubMount() {
  vi.mocked(api.get).mockImplementation(async (ep: string) =>
    (ep.includes("/api/models") ? ["ecy:latest"] : []) as unknown as never,
  );
  vi.mocked(api.post).mockResolvedValue({ id: "s1", messages: [] } as unknown as never);
  vi.mocked(api.put).mockResolvedValue({} as unknown as never);
}

// Drive api.streamPost by feeding SSE frames to the caller's onChunk.
function stubStream(frames: string[]) {
  vi.mocked(api.streamPost).mockImplementation(async (_ep, _body, opts?: { onChunk?: (t: string) => void }) => {
    for (const f of frames) opts?.onChunk?.(`data: ${f}\n\n`);
  });
}

async function typeAndSend(text: string) {
  const box = await screen.findByPlaceholderText(/Message eCy/i);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatPanel — certainty engine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the chat header", async () => {
    stubMount();
    renderUI(<ChatPanel />);
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });

  it("shows a DEFINITIVE computed card for a pure-arithmetic message", async () => {
    stubMount();
    stubStream([]); // model says nothing — the card must still be definitive
    renderUI(<ChatPanel />);
    await typeAndSend("2+2=?");
    // Source-of-truth answer, sourced from the parser, not the model.
    await waitFor(() => {
      expect(screen.getByText("2+2 = 4")).toBeInTheDocument();
      expect(screen.getByText(/hesaplandı — kesin/)).toBeInTheDocument();
    });
  });

  it("does NOT show a computed card for a non-arithmetic message", async () => {
    stubMount();
    stubStream([JSON.stringify({ chunk: "Ankara." })]);
    renderUI(<ChatPanel />);
    await typeAndSend("Türkiye'nin başkenti?");
    await waitFor(() => expect(screen.getByText("Ankara.")).toBeInTheDocument());
    expect(screen.queryByText(/hesaplandı — kesin/)).not.toBeInTheDocument();
  });

  it("hides <think> reasoning by default and reveals it on toggle", async () => {
    stubMount();
    stubStream([JSON.stringify({ chunk: "<think>secret scratch work</think>The answer is 4." })]);
    renderUI(<ChatPanel />);
    await typeAndSend("neden 4?");
    await waitFor(() => expect(screen.getByText("The answer is 4.")).toBeInTheDocument());
    // Reasoning hidden until the user asks for it.
    expect(screen.queryByText("secret scratch work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/akıl-yürütmeyi göster/));
    await waitFor(() => expect(screen.getByText("secret scratch work")).toBeInTheDocument());
  });
});
