// Interactive Sandbox Terminal panel — the new ollamas-subcommand quick actions (P0/P1) and the
// persisted audit-history panel (P3/P4) that reuses GET /api/security/log (same endpoint
// SecurityPolicies.tsx already reads) so a page refresh doesn't lose "what did I run".
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderUI, mockFetch } from "./helpers";
import { CommandLineTerminal } from "../../src/components/CommandLineTerminal";

afterEach(() => vi.restoreAllMocks());

describe("CommandLineTerminal — ollamas quick actions", () => {
  it("renders the read-only ollamas subcommand quick actions", async () => {
    mockFetch({ "/api/security/log": [] });
    renderUI(<CommandLineTerminal onNotify={vi.fn()} isLive={true} />);
    expect(await screen.findByText("ollamas doctor")).toBeInTheDocument();
    expect(screen.getByText("ollamas top")).toBeInTheDocument();
    expect(screen.getByText("ollamas ecysearcher status")).toBeInTheDocument();
  });

  it("does not offer 'ollamas ecysearcher up' as a one-click button (state-mutating)", async () => {
    mockFetch({ "/api/security/log": [] });
    renderUI(<CommandLineTerminal onNotify={vi.fn()} isLive={true} />);
    await screen.findByText("ollamas doctor");
    expect(screen.queryByText("ollamas ecysearcher up")).not.toBeInTheDocument();
  });

  it("clicking 'ollamas doctor' posts the command to /api/terminal", async () => {
    const spy = mockFetch({
      "/api/security/log": [],
      "/api/terminal": { stdout: "gateway: ok\nollama: ok", stderr: "", exitCode: 0 },
    });
    renderUI(<CommandLineTerminal onNotify={vi.fn()} isLive={true} />);
    fireEvent.click(await screen.findByText("ollamas doctor"));

    await waitFor(() => {
      const posted = spy.mock.calls.some(([input, init]: any) => {
        const url = typeof input === "string" ? input : input?.url || "";
        return url.includes("/api/terminal") && init?.method === "POST" && String(init?.body || "").includes("ollamas doctor");
      });
      expect(posted).toBe(true);
    });
    expect(await screen.findByText(/gateway: ok/)).toBeInTheDocument();
  });

  it("shows recent command_exec audit entries and filters out other categories", async () => {
    mockFetch({
      "/api/security/log": [
        { id: "1", timestamp: new Date().toISOString(), category: "command_exec", action: "ollamas doctor", details: "ok", status: "allow" },
        { id: "2", timestamp: new Date().toISOString(), category: "command_exec", action: "ollamas up", details: "refused", status: "deny" },
        { id: "3", timestamp: new Date().toISOString(), category: "file_system", action: "read foo.txt", details: "ok", status: "allow" },
      ],
    });
    renderUI(<CommandLineTerminal onNotify={vi.fn()} isLive={true} />);

    expect(await screen.findByText("Recent (audit log)")).toBeInTheDocument();
    // "ollamas doctor" also renders as a quick-action button label — assert on the
    // history-only entry instead of an ambiguous getByText match on both.
    expect(screen.getByText("ollamas up")).toBeInTheDocument();
    expect(screen.queryByText("read foo.txt")).not.toBeInTheDocument();
  });

  it("hides the audit-history panel entirely when there are no command_exec entries", async () => {
    mockFetch({ "/api/security/log": [] });
    renderUI(<CommandLineTerminal onNotify={vi.fn()} isLive={true} />);
    await screen.findByText("ollamas doctor"); // wait for mount to settle
    expect(screen.queryByText("Recent (audit log)")).not.toBeInTheDocument();
  });
});
