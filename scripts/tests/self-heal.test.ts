// v7 — self_heal CLI behavior (DRY default, no side effects).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const TOOL = join(ROOT, "bin", "host-bridge", "tools", "self_heal.mjs");

// Run self_heal against an unreachable bridge port; capture JSON stdout.
function runSelfHeal(args: string[] = []): { json: any; status: number } {
  try {
    const out = execFileSync("node", [TOOL, ...args], {
      cwd: ROOT, encoding: "utf8",
      env: { ...process.env, BRIDGE_PORT: "59998" }, // nothing listening
    });
    return { json: JSON.parse(out), status: 0 };
  } catch (e: any) {
    // non-zero exit still carries JSON on stdout
    return { json: JSON.parse(e.stdout || "{}"), status: e.status ?? 1 };
  }
}

describe("self_heal (DRY default)", () => {
  it("DRY run exits 0, applied=false, executes nothing", () => {
    const { json, status } = runSelfHeal();
    expect(status).toBe(0);
    expect(json.applied).toBe(false);
    expect(json.ok).toBe(true);
    expect(json).not.toHaveProperty("executed"); // no execution branch in DRY
  });

  it("plans a restart when the bridge is unreachable", () => {
    const { json } = runSelfHeal();
    expect(json.healthyBefore).toBe(false);
    const ids = json.actions.map((a: any) => a.id);
    // unreachable bridge → restart path (kickstart if launchd-managed, else script)
    expect(ids.some((i: string) => i === "restart_bridge" || i === "plist_kickstart")).toBe(true);
  });

  it("emits a structured report (ts, healthyBefore/After, actions[])", () => {
    const { json } = runSelfHeal();
    expect(typeof json.ts).toBe("string");
    expect(typeof json.healthyAfter).toBe("boolean");
    expect(Array.isArray(json.actions)).toBe(true);
  });
});
