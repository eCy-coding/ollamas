import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderUI } from "./helpers";
import { DocumentsPanel } from "../../src/components/DocumentsPanel";

vi.mock("../../src/lib/apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn(), downloadFile: vi.fn() },
}));
import { api } from "../../src/lib/apiClient";

const TREE = {
  tree: [
    { name: "docs", relativePath: "docs", isDirectory: true, children: [
      { name: "readme.md", relativePath: "docs/readme.md", isDirectory: false },
    ] },
    { name: "logo.png", relativePath: "logo.png", isDirectory: false },
  ],
};

beforeEach(() => {
  // Per-test isolation: reset every mock, then set the default tree response.
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.uploadFile).mockReset();
  vi.mocked(api.downloadFile).mockReset();
  vi.mocked(api.get).mockImplementation(async (ep: string) =>
    (ep.includes("/workspace/tree") ? TREE : { content: "# Readme\nhello" }) as unknown as never,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("DocumentsPanel", () => {
  it("renders header, Upload and Refresh", () => {
    renderUI(<DocumentsPanel />);
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });

  it("loads and flattens the workspace tree into a file list", async () => {
    renderUI(<DocumentsPanel />);
    await waitFor(() => {
      expect(screen.getByText("docs/readme.md")).toBeInTheDocument();
      expect(screen.getByText("logo.png")).toBeInTheDocument();
    });
  });

  it("opens a text file and shows its content in the editor", async () => {
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText("docs/readme.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("docs/readme.md"));
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("# Readme"));
  });

  it("enables Save only when edited, and Save POSTs the content", async () => {
    renderUI(<DocumentsPanel onNotify={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("docs/readme.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("docs/readme.md"));
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
    const saveBtn = screen.getByRole("button", { name: /Save/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Edited" } });
    expect(saveBtn).not.toBeDisabled();
    vi.mocked(api.post).mockResolvedValueOnce({} as never);
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/workspace/file", { relativePath: "docs/readme.md", content: "# Edited" }),
    );
  });

  it("shows an honest binary state (no fetch, download only) for non-text files", async () => {
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    vi.mocked(api.get).mockClear();
    fireEvent.click(screen.getByText("logo.png"));
    await waitFor(() => expect(screen.getByText(/Binary file/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Download/i })).toBeInTheDocument();
    // never fetched file content for a binary
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining("/workspace/file"));
  });

  it("downloads a binary file via api.downloadFile", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.mocked(api.downloadFile).mockResolvedValueOnce(new Blob(["data"]) as never);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    fireEvent.click(screen.getByText("logo.png"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Download/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Download/i }));
    await waitFor(() => expect(api.downloadFile).toHaveBeenCalledWith("logo.png"));
  });

  it("shows an honest empty state when the workspace has no files", async () => {
    vi.mocked(api.get).mockImplementation(async () => ({ tree: [] }) as unknown as never);
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText(/No files in workspace/i)).toBeInTheDocument());
  });

  it("shows an error banner when the tree fails to load", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("workspace offline"));
    renderUI(<DocumentsPanel />);
    await waitFor(() => expect(screen.getByText(/workspace offline/)).toBeInTheDocument());
  });
});
