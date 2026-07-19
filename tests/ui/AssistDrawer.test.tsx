import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { AssistDrawer } from "../../src/components/AssistDrawer";
import { __resetStreamStoresForTests } from "../../src/lib/streamStore";

vi.mock("../../src/lib/apiClient", () => ({
  api: { streamPost: vi.fn() },
}));
import { api } from "../../src/lib/apiClient";

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

describe("AssistDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStreamStoresForTests(); // module-level store singleton needs isolation between tests
  });

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

  it("keeps the streamed answer after unmount + remount (module-level store survives)", async () => {
    const d = deferredStream();
    const { unmount } = renderUI(<AssistDrawer panelId="integrations" context={() => "ctx"} />);
    fireEvent.click(screen.getByText("eCy'ye Sor"));
    await waitFor(() => expect(api.streamPost).toHaveBeenCalled());

    d.push({ chunk: "Root " });
    await waitFor(() => expect(screen.getByText("Root", { exact: false })).toBeInTheDocument());

    // Simulate the tab-switch bug scenario: the drawer's panel unmounts mid-stream.
    unmount();

    d.push({ chunk: "cause: cache miss." });
    d.resolve();
    await flush();

    // Remount (e.g. returning to the panel) — same panelId, same store key. The
    // drawer should reopen already showing the finished answer, no re-click needed.
    renderUI(<AssistDrawer panelId="integrations" context={() => "ctx"} />);
    await waitFor(() => expect(screen.getByText("Root cause: cache miss.")).toBeInTheDocument());
  });
});
