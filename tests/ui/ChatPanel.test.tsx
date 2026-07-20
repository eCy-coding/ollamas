import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { ChatPanel } from "../../src/components/ChatPanel";
import { __resetStreamStoresForTests } from "../../src/lib/streamStore";

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

// Like stubStream, but the caller controls exactly when each frame lands and
// when the underlying call resolves — needed to simulate "still streaming
// while unmounted" instead of the whole thing settling in one microtask sweep.
function deferredStream() {
  let capturedOpts: { onChunk?: (t: string) => void } | undefined;
  let resolveFn!: () => void;
  const promise = new Promise<void>((res) => { resolveFn = res; });
  vi.mocked(api.streamPost).mockImplementation(async (_ep, _body, opts?: { onChunk?: (t: string) => void }) => {
    capturedOpts = opts;
    return promise;
  });
  return {
    push: (obj: Record<string, unknown>) => capturedOpts?.onChunk?.(`data: ${JSON.stringify(obj)}\n\n`),
    resolve: () => resolveFn(),
  };
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function typeAndSend(text: string) {
  const box = await screen.findByPlaceholderText(/Message eCy/i);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatPanel — certainty engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStreamStoresForTests(); // module-level store singleton needs isolation between tests
  });

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

  it("keeps the user message + streamed answer after unmount + remount (module-level store survives)", async () => {
    stubMount();
    const d = deferredStream();
    const { unmount } = renderUI(<ChatPanel />);
    await typeAndSend("Türkiye'nin başkenti?");
    await waitFor(() => expect(api.streamPost).toHaveBeenCalled());

    d.push({ chunk: "Ank" });
    await waitFor(() => expect(screen.getByText("Ank")).toBeInTheDocument());

    // Simulate the tab-switch bug scenario: component unmounts mid-stream.
    unmount();

    // The stream keeps running in the background (module-level store, not component
    // state) — more frames arrive, then the call completes, all after unmount.
    d.push({ chunk: "ara." });
    d.resolve();
    await flush();

    // Remount (e.g. switching back to the Chat tab) — same session, same store key.
    renderUI(<ChatPanel />);
    await waitFor(() => {
      expect(screen.getByText("Türkiye'nin başkenti?")).toBeInTheDocument();
      expect(screen.getByText("Ankara.")).toBeInTheDocument();
    });
  });
});

// v20 — silent model substitution (honesty defect): the router can fall through its
// provider chain and answer with something other than the model the user picked, with
// no indication in the UI. These lock in the provenance warning that now surfaces it.
describe("ChatPanel — substitution provenance warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStreamStoresForTests();
  });

  it("shows the substitution warning when the served source differs from the requested provider", async () => {
    stubMount();
    stubStream([
      JSON.stringify({ chunk: "1914-1918 yılları arasında..." }),
      JSON.stringify({ done: true, source: "cloud:gemini", latencyMs: 500 }),
    ]);
    renderUI(<ChatPanel />);
    await typeAndSend("Fransa'nın başkenti nedir?");
    await waitFor(() => {
      expect(screen.getByText("1914-1918 yılları arasında...")).toBeInTheDocument();
      expect(screen.getByText(/cloud:gemini cevapladı/)).toBeInTheDocument();
    });
  });

  it("shows NO warning when the served source matches the requested provider", async () => {
    stubMount();
    stubStream([
      JSON.stringify({ chunk: "Ankara." }),
      JSON.stringify({ done: true, source: "ollama_local", latencyMs: 300 }),
    ]);
    renderUI(<ChatPanel />);
    await typeAndSend("Türkiye'nin başkenti?");
    await waitFor(() => expect(screen.getByText("Ankara.")).toBeInTheDocument());
    expect(screen.queryByText(/cevapladı/)).not.toBeInTheDocument();
  });

  it("shows NO warning when the done frame carries no source at all (unknown, not substituted)", async () => {
    stubMount();
    stubStream([JSON.stringify({ chunk: "Ankara." }), JSON.stringify({ done: true })]);
    renderUI(<ChatPanel />);
    await typeAndSend("Türkiye'nin başkenti?");
    await waitFor(() => expect(screen.getByText("Ankara.")).toBeInTheDocument());
    expect(screen.queryByText(/cevapladı/)).not.toBeInTheDocument();
  });
});
