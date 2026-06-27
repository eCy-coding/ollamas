// Pure-core tests for fleet supervisor logic + remote pool helpers. Zero IO.
import { describe, it, expect } from "vitest";
import {
  parseBackendPool,
  selectBackend,
  parseTailscalePeers,
  formatPool,
} from "../cli/lib/remote";
import type { Backend, BackendProbe } from "../cli/lib/remote";
import { decideTransition } from "../cli/lib/fleet";
import type { FleetState } from "../cli/lib/fleet";

// ---------------------------------------------------------------------------
// parseBackendPool
// ---------------------------------------------------------------------------
describe("parseBackendPool", () => {
  it("returns sorted by priority ascending", () => {
    const raw = [
      { name: "b", url: "http://b:11434", priority: 20 },
      { name: "a", url: "http://a:11434", priority: 10 },
    ];
    const pool = parseBackendPool(raw);
    expect(pool[0].name).toBe("a");
    expect(pool[1].name).toBe("b");
  });

  it("drops entries missing name/url", () => {
    const raw = [
      { name: "ok", url: "http://ok:11434", priority: 1 },
      { url: "http://no-name:11434", priority: 2 },
      { name: "no-url", priority: 3 },
      null,
      42,
    ];
    const pool = parseBackendPool(raw);
    expect(pool).toHaveLength(1);
    expect(pool[0].name).toBe("ok");
  });

  it("dedupes by url (first occurrence wins)", () => {
    const raw = [
      { name: "first", url: "http://x:11434", priority: 1 },
      { name: "dup", url: "http://x:11434", priority: 2 },
    ];
    const pool = parseBackendPool(raw);
    expect(pool).toHaveLength(1);
    expect(pool[0].name).toBe("first");
  });

  it("defaults priority to 50 when missing or invalid", () => {
    const pool = parseBackendPool([{ name: "a", url: "http://a:11434" }]);
    expect(pool[0].priority).toBe(50);
  });

  it("returns [] for non-array input", () => {
    expect(parseBackendPool(null)).toEqual([]);
    expect(parseBackendPool({})).toEqual([]);
    expect(parseBackendPool("bad")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectBackend
// ---------------------------------------------------------------------------
const mkBackend = (name: string, priority: number, url = `http://${name}:11434`): Backend => ({
  name,
  url,
  priority,
});
const mkProbe = (url: string, reachable: boolean, models: string[] = ["qwen3:8b"]): BackendProbe => ({
  url,
  reachable,
  models,
});

describe("selectBackend", () => {
  it("picks the lowest-priority reachable backend with required model", () => {
    const pool = [mkBackend("a", 10), mkBackend("b", 20)];
    const probes = [mkProbe("http://a:11434", true), mkProbe("http://b:11434", true)];
    const winner = selectBackend(pool, probes);
    expect(winner?.name).toBe("a");
  });

  it("skips unreachable, returns next", () => {
    const pool = [mkBackend("a", 10), mkBackend("b", 20)];
    const probes = [mkProbe("http://a:11434", false), mkProbe("http://b:11434", true)];
    expect(selectBackend(pool, probes)?.name).toBe("b");
  });

  it("skips backend missing required model", () => {
    const pool = [mkBackend("a", 10), mkBackend("b", 20)];
    const probes = [
      mkProbe("http://a:11434", true, ["llama3:8b"]),
      mkProbe("http://b:11434", true, ["qwen3:8b"]),
    ];
    expect(selectBackend(pool, probes)?.name).toBe("b");
  });

  it("returns null when none reachable", () => {
    const pool = [mkBackend("a", 10)];
    const probes = [mkProbe("http://a:11434", false)];
    expect(selectBackend(pool, probes)).toBeNull();
  });

  it("custom required models respected", () => {
    const pool = [mkBackend("a", 10), mkBackend("b", 20)];
    const probes = [
      mkProbe("http://a:11434", true, ["qwen3:8b"]),
      mkProbe("http://b:11434", true, ["qwen3:8b", "mistral:7b"]),
    ];
    expect(selectBackend(pool, probes, { required: ["mistral:7b"] })?.name).toBe("b");
  });

  it("returns null when pool is empty", () => {
    expect(selectBackend([], [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTailscalePeers
// ---------------------------------------------------------------------------
const TAILSCALE_STATUS = {
  Self: {
    DNSName: "macbook.tailnet.ts.net.",
    TailscaleIPs: ["100.64.0.1", "fd7a::1"],
    Online: true,
  },
  Peer: {
    "abc123": {
      DNSName: "winpc1.tailnet.ts.net.",
      TailscaleIPs: ["100.64.0.2", "fd7a::2"],
      Online: true,
    },
    "def456": {
      DNSName: "winpc2.tailnet.ts.net.",
      TailscaleIPs: ["100.64.0.3"],
      Online: false,
    },
  },
};

describe("parseTailscalePeers", () => {
  it("includes Self and online Peers, excludes offline", () => {
    const peers = parseTailscalePeers(TAILSCALE_STATUS);
    expect(peers).toHaveLength(2); // Self + winpc1; winpc2 offline excluded
    expect(peers.map((p) => p.host)).toContain("macbook.tailnet.ts.net");
    expect(peers.map((p) => p.host)).toContain("winpc1.tailnet.ts.net");
  });

  it("strips trailing dot from DNSName", () => {
    const peers = parseTailscalePeers(TAILSCALE_STATUS);
    expect(peers.every((p) => !p.host.endsWith("."))).toBe(true);
  });

  it("picks first IPv4 from TailscaleIPs", () => {
    const peers = parseTailscalePeers(TAILSCALE_STATUS);
    const mac = peers.find((p) => p.host === "macbook.tailnet.ts.net");
    expect(mac?.ip).toBe("100.64.0.1");
  });

  it("returns [] for null/malformed input", () => {
    expect(parseTailscalePeers(null)).toEqual([]);
    expect(parseTailscalePeers({})).toEqual([]);
    expect(parseTailscalePeers({ Self: null })).toEqual([]);
  });

  it("handles missing Peer map", () => {
    const status = { Self: TAILSCALE_STATUS.Self };
    const peers = parseTailscalePeers(status);
    expect(peers).toHaveLength(1);
    expect(peers[0].host).toBe("macbook.tailnet.ts.net");
  });
});

// ---------------------------------------------------------------------------
// formatPool
// ---------------------------------------------------------------------------
describe("formatPool", () => {
  const pool = [mkBackend("worker1", 10), mkBackend("worker2", 20)];
  const probes = [
    mkProbe("http://worker1:11434", true, ["qwen3:8b"]),
    mkProbe("http://worker2:11434", false, []),
  ];

  it("json ctx → valid JSON array", () => {
    const out = formatPool(pool, probes, { color: false, json: true });
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("worker1");
    expect(parsed[0].reachable).toBe(true);
  });

  it("plain ctx → contains backend names", () => {
    const out = formatPool(pool, probes, { color: false, json: false });
    expect(out).toContain("worker1");
    expect(out).toContain("worker2");
  });

  it("plain ctx → marks reachable ✓ and unreachable ✗", () => {
    const out = formatPool(pool, probes, { color: false, json: false });
    expect(out).toContain("✓");
    expect(out).toContain("✗");
  });

  it("plain ctx → no ANSI when color=false", () => {
    const out = formatPool(pool, probes, { color: false, json: false });
    expect(out).not.toMatch(/\x1b\[/);
  });
});

// ---------------------------------------------------------------------------
// decideTransition
// ---------------------------------------------------------------------------
const NOW = 1_000_000;

const mkState = (current: string | null, attempt = 0, lastSwitchMs = 0): FleetState => ({
  current,
  attempt,
  lastSwitchMs,
});

describe("decideTransition", () => {
  const pool = [mkBackend("a", 10, "http://a:11434"), mkBackend("b", 20, "http://b:11434")];

  it("stay — current is already best", () => {
    const probes = [mkProbe("http://a:11434", true), mkProbe("http://b:11434", true)];
    const t = decideTransition(mkState("http://a:11434"), pool, probes, NOW);
    expect(t.action).toBe("stay");
  });

  it("switch — current dies, next-priority is reachable", () => {
    const probes = [mkProbe("http://a:11434", false), mkProbe("http://b:11434", true)];
    const t = decideTransition(mkState("http://a:11434"), pool, probes, NOW);
    expect(t.action).toBe("switch");
    if (t.action === "switch") expect(t.to.name).toBe("b");
  });

  it("thrash-guard — switched too recently → wait", () => {
    const probes = [mkProbe("http://a:11434", false), mkProbe("http://b:11434", true)];
    // switched only 1 second ago, minDwell default 10 s
    const t = decideTransition(
      mkState("http://a:11434", 0, NOW - 1_000),
      pool,
      probes,
      NOW,
      { minDwellMs: 10_000 },
    );
    expect(t.action).toBe("wait");
  });

  it("all-down — no reachable backend → wait with backoff", () => {
    const probes = [mkProbe("http://a:11434", false), mkProbe("http://b:11434", false)];
    const t = decideTransition(mkState(null, 2), pool, probes, NOW);
    expect(t.action).toBe("wait");
    if (t.action === "wait") expect(t.delayMs).toBeGreaterThanOrEqual(0);
  });

  it("recovery — higher-priority backend returns after dwell", () => {
    const probes = [mkProbe("http://a:11434", true), mkProbe("http://b:11434", true)];
    // currently on b (a was down), switched long ago → should switch back to a
    const t = decideTransition(
      mkState("http://b:11434", 0, NOW - 60_000),
      pool,
      probes,
      NOW,
      { minDwellMs: 10_000 },
    );
    expect(t.action).toBe("switch");
    if (t.action === "switch") expect(t.to.name).toBe("a");
  });

  it("no current set and best exists → switch", () => {
    const probes = [mkProbe("http://a:11434", true)];
    const t = decideTransition(mkState(null), pool, probes, NOW);
    expect(t.action).toBe("switch");
    if (t.action === "switch") expect(t.to.name).toBe("a");
  });
});
