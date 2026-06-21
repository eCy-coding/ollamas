import { describe, it, expect } from "vitest";
import {
  parseLsofListen,
  parseLsofCwd,
  matchWorktree,
  mapServersToWorktrees,
  parseTabs,
  parseTmuxPanes,
  parseTabsTagged,
  isShellCmd,
  type Worktree,
} from "../bin/discover";

const WTS: Worktree[] = [
  { path: "/Users/x/Desktop/ollamas", branch: "feat/v1.7-mcp-adopt" },
  { path: "/Users/x/Desktop/ollamas-frontend-wt", branch: "feat/frontend-vf3" },
  { path: "/Users/x/Desktop/ollamas-scripts-wt", branch: "feat/scripts-v1" },
];

describe("parseLsofListen", () => {
  it("addr:port + (LISTEN) satırlarından port/pid çıkarır, IPv6/IPv4/*-formları", () => {
    const raw = [
      "COMMAND    PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME",
      "com.docke  3973 me     172u IPv6 0xba36f9db01461a34 0t0 TCP *:3000 (LISTEN)",
      "node      10100 me      23u IPv4 0x111             0t0 TCP 127.0.0.1:5173 (LISTEN)",
      "node      10200 me      24u IPv6 0x222             0t0 TCP [::1]:3000 (LISTEN)",
      "node      10300 me      25u IPv4 0x333             0t0 TCP 127.0.0.1:54321 (ESTABLISHED)",
    ].join("\n");
    const res = parseLsofListen(raw);
    expect(res).toEqual([
      { port: 3000, pid: 3973, command: "com.docke" },
      { port: 5173, pid: 10100, command: "node" },
      { port: 3000, pid: 10200, command: "node" },
    ]);
  });
  it("boş girdi → boş dizi", () => {
    expect(parseLsofListen("")).toEqual([]);
  });
});

describe("parseLsofCwd", () => {
  it("-Fn çıktısından ilk n alanını döner", () => {
    expect(parseLsofCwd("p10100\nfcwd\nn/Users/x/Desktop/ollamas-frontend-wt\n")).toBe(
      "/Users/x/Desktop/ollamas-frontend-wt",
    );
  });
  it("n alanı yoksa boş", () => {
    expect(parseLsofCwd("p10100\nfcwd\n")).toBe("");
  });
});

describe("matchWorktree", () => {
  it("kardeş-dizin yanlış eşleşmesini önler (ollamas ≠ ollamas-frontend-wt)", () => {
    const m = matchWorktree("/Users/x/Desktop/ollamas-frontend-wt/src", WTS);
    expect(m?.branch).toBe("feat/frontend-vf3"); // ollamas DEĞİL
  });
  it("tam yol + en uzun prefix", () => {
    expect(matchWorktree("/Users/x/Desktop/ollamas", WTS)?.branch).toBe("feat/v1.7-mcp-adopt");
    expect(matchWorktree("/Users/x/Desktop/ollamas/server", WTS)?.branch).toBe("feat/v1.7-mcp-adopt");
  });
  it("eşleşme yoksa null (örn Docker cwd)", () => {
    expect(matchWorktree("/Library/Containers/com.docker", WTS)).toBeNull();
  });
});

describe("mapServersToWorktrees — 6×port-3000 cwd disambiguation (ERR-ORCH-001)", () => {
  it("aynı port 3000 farklı cwd → farklı lane; eşleşmeyen pid (Docker) elenir", () => {
    const listeners = [
      { port: 3000, pid: 3973, command: "com.docke" }, // Docker → cwd eşleşmez
      { port: 3000, pid: 10200, command: "node" }, // backend lane
      { port: 3000, pid: 10400, command: "node" }, // scripts lane (farklı cwd, aynı port)
    ];
    const cwdOf = (pid: number): string => ({
      3973: "/Library/Containers/com.docker",
      10200: "/Users/x/Desktop/ollamas/server",
      10400: "/Users/x/Desktop/ollamas-scripts-wt",
    } as Record<number, string>)[pid] ?? "";
    const res = mapServersToWorktrees(listeners, WTS, cwdOf);
    expect(res).toEqual([
      { lane: "feat/v1.7-mcp-adopt", path: "/Users/x/Desktop/ollamas", port: 3000, pid: 10200 },
      { lane: "feat/scripts-v1", path: "/Users/x/Desktop/ollamas-scripts-wt", port: 3000, pid: 10400 },
    ]);
  });
});

describe("parseTabs", () => {
  it("tty\\tbusy satırlarını ayrıştırır", () => {
    const res = parseTabs("/dev/ttys003\ttrue\n/dev/ttys005\tfalse\n\n");
    expect(res).toEqual([
      { tty: "/dev/ttys003", busy: true },
      { tty: "/dev/ttys005", busy: false },
    ]);
  });
});

// ── vO2 merge: tmux-first + iTerm2 + busy (lib/tabs.ts'ten fold) ──────────────

describe("isShellCmd (busy/idle ayrımı)", () => {
  it("kabuk komutları idle, diğerleri busy", () => {
    expect(isShellCmd("zsh")).toBe(true);
    expect(isShellCmd("-zsh")).toBe(true); // login shell
    expect(isShellCmd("bash")).toBe(true);
    expect(isShellCmd("node")).toBe(false);
    expect(isShellCmd("tsx")).toBe(false);
    expect(isShellCmd("vim")).toBe(false);
  });
});

describe("parseTmuxPanes", () => {
  it("session\\ttty\\tcwd\\tcmd → busy=cmd-kabuk-değil", () => {
    const raw =
      "main\t/dev/ttys004\t/Users/x/Desktop/ollamas\tnode\n" +
      "cli\t/dev/ttys005\t/Users/x/Desktop/ollamas-cli-wt\tzsh\n";
    const res = parseTmuxPanes(raw);
    expect(res.length).toBe(2);
    expect(res[0]).toMatchObject({ app: "tmux", tty: "/dev/ttys004", cwd: "/Users/x/Desktop/ollamas", busy: true });
    expect(res[1].busy).toBe(false); // zsh → idle
  });
});

describe("parseTabsTagged (ERR-ORCH-003 delimiter-fix doğru ayraçla)", () => {
  it("app\\ttty\\ttitle\\tbusy01 → app etiketli, busy 1/0", () => {
    const raw = "iterm2\t/dev/ttys010\tnode\t1\nterminal\t/dev/ttys020\tterm\t0\n";
    const res = parseTabsTagged(raw);
    expect(res).toEqual([
      { app: "iterm2", tty: "/dev/ttys010", busy: true },
      { app: "terminal", tty: "/dev/ttys020", busy: false },
    ]);
  });
  it("boş/tty'siz satır elenir", () => {
    expect(parseTabsTagged("iterm2\t\ttitle\t1\n\n")).toEqual([]);
  });
});
