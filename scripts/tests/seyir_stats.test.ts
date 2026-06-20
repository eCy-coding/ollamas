// v8 — seyir_stats dashboard CLI over a fixture event stream.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const TOOL = join(ROOT, "bin", "host-bridge", "tools", "seyir_stats.mjs");
const FILE = "seyir-defteri-scripts.jsonl";

const dirs: string[] = [];
function seed(events: any[]): string {
  const d = mkdtempSync(join(tmpdir(), "seyirstats-"));
  dirs.push(d);
  writeFileSync(join(d, FILE), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  return d;
}
afterEach(() => { for (const d of dirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true }); });

function run(dir: string, args: string[] = []): { json: any; status: number } {
  try {
    const out = execFileSync("node", [TOOL, "--json", ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, MISSION_CONTROL_DATA_DIR: dir } });
    return { json: JSON.parse(out), status: 0 };
  } catch (e: any) {
    return { json: JSON.parse(e.stdout || "{}"), status: e.status ?? 1 };
  }
}

const ev = (over: any = {}) => ({ ts_ms: Date.now(), tool: "t", duration_ms: 100, status: "ok", exit: 0, ...over });

describe("seyir_stats --json", () => {
  it("empty stream → zeroed summary, exit 0", () => {
    const { json, status } = run(seed([]));
    expect(status).toBe(0);
    expect(json.summary.total).toBe(0);
    expect(json.slo.alert).toBe(false);
  });

  it("summarizes counts, percentiles, per-tool", () => {
    const { json } = run(seed([
      ev({ tool: "a", duration_ms: 100 }),
      ev({ tool: "a", duration_ms: 300 }),
      ev({ tool: "b", duration_ms: 200, status: "error", exit: 1 }),
    ]));
    expect(json.summary.total).toBe(3);
    expect(json.summary.errors).toBe(1);
    expect(json.summary.byTool.a.count).toBe(2);
  });

  it("SLO breach → alert + exit 1", () => {
    // 3/5 recent errors vs 99% target → burn >> 1 → alert
    const events = [ev({ exit: 1, status: "error" }), ev({ exit: 1, status: "error" }), ev({ exit: 1, status: "error" }), ev(), ev()];
    const { json, status } = run(seed(events), ["--slo", "0.99"]);
    expect(json.slo.alert).toBe(true);
    expect(status).toBe(1);
  });

  it("within budget → no alert, exit 0", () => {
    const events = Array.from({ length: 200 }, (_, i) => ev({ exit: i < 1 ? 1 : 0, status: i < 1 ? "error" : "ok" }));
    const { json, status } = run(seed(events), ["--slo", "0.99"]);
    expect(json.slo.alert).toBe(false);
    expect(status).toBe(0);
  });
});
