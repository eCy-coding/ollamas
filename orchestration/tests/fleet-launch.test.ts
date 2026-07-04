// fleet-launch seams — tests the PURE pipeline bin/fleet-launch.ts composes (plan → filter →
// sequenced order → workspace request), without spawning osascript/terminals or running the CLI.
import { describe, it, expect } from "vitest";
import { buildFleetPlan, assertMaxTwo, STREAMS, type Assignment } from "../bin/lib/fleet-plan";
import { buildMission, DEFAULT_DEPS, type AssignmentLike } from "../bin/lib/mission";
import { orderSlotsByMission, maxTwoOkOrdered } from "../bin/lib/fleet-order";
import { selectWorkspaceRequest, parseWorkspaceResp } from "../bin/lib/workspace";

const LIVE = [
  "qwen3-coder-64k:latest", "qwen3:8b-16k", "ollamas-reviewer:latest", "qwen2.5vl:32b",
  "qwen2.5vl:7b", "qwen3:8b", "qwen3:30b-a3b", "deepseek-r1:32b", "qwen3-coder:30b",
  "qwen3:4b", "gpt-oss:20b", "kimi-k2.5:cloud", "nomic-embed-text:latest",
  "gpt-oss:20b-cloud", "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "llama3.3:70b",
];

/** Reproduce main()'s slot selection: only assigned slots, optional --streams / --cloud-only filters. */
function selectSlots(plan = buildFleetPlan(LIVE), streams: string[] | null = null, cloudOnly = false): Assignment[] {
  let slots = plan.assignments.filter((a) => a.model);
  if (streams) slots = slots.filter((a) => streams.includes(a.stream));
  if (cloudOnly) slots = slots.filter((a) => a.runtime === "cloud");
  return slots;
}

describe("fleet-launch slot selection (main() filters)", () => {
  it("live fleet passes the ≤2/model gate fleet-launch enforces before launching", () => {
    const plan = buildFleetPlan(LIVE);
    expect(() => assertMaxTwo(plan)).not.toThrow();
    expect(plan.maxTwoOk).toBe(true);
  });
  it("default launch set = every assigned slot (no null-model slots leak into wrappers)", () => {
    const slots = selectSlots();
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((a) => typeof a.model === "string" && a.model.length > 0)).toBe(true);
    expect(slots.length).toBeLessThanOrEqual(STREAMS.length * 2);
  });
  it("--streams a,b filter keeps only the named streams", () => {
    const picked = ["typescript-core", "shell-harden"];
    const slots = selectSlots(buildFleetPlan(LIVE), picked);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((a) => picked.includes(a.stream))).toBe(true);
  });
  it("--cloud-only keeps only cloud-runtime slots (GPU-safe launch)", () => {
    const slots = selectSlots(buildFleetPlan(LIVE), null, true);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((a) => a.runtime === "cloud")).toBe(true);
  });
});

describe("fleet-launch --sequenced ordering (mission → orderSlotsByMission)", () => {
  const plan = buildFleetPlan(LIVE);
  const slots = selectSlots(plan);
  const assignLike: AssignmentLike[] = plan.assignments.map((a) => ({ stream: a.stream, concern: a.concern, model: a.model }));
  const mission = buildMission(assignLike, new Map(Object.entries(DEFAULT_DEPS)));
  const ordered = orderSlotsByMission(slots, mission);

  it("mission builds ok and ordering keeps every launchable slot (none dropped)", () => {
    expect(mission.ok).toBe(true);
    expect(ordered.length).toBe(slots.length);
  });
  it("orders foundation-first: missionOrder is nondecreasing and shell-harden leads", () => {
    const orders = ordered.map((o) => o.missionOrder);
    for (let i = 1; i < orders.length; i++) expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    expect(ordered[0].slot.stream).toBe("shell-harden");
    expect(ordered[0].dependsOn).toEqual([]);
  });
  it("every ordered slot carries a valid ethical tier label (never privileged) for the T#·tier tag", () => {
    for (const o of ordered) expect(["safe", "host"]).toContain(o.tier);
  });
  it("sequenced order still honors the ≤2-streams/model cap", () => {
    expect(maxTwoOkOrdered(ordered, (s) => s.model)).toBe(true);
  });
});

describe("fleet-launch workspace seam (ensureWorkspace request/response)", () => {
  it("builds POST /api/workspace/select pointing the server workspace at the repo", () => {
    const req = selectWorkspaceRequest("http://127.0.0.1:3000/", "/Users/x/Desktop/ollamas");
    expect(req.url).toBe("http://127.0.0.1:3000/api/workspace/select"); // trailing slash trimmed
    expect(req.method).toBe("POST");
    expect(req.contentType).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ path: "/Users/x/Desktop/ollamas" });
  });
  it("parses success and failure responses the way ensureWorkspace logs them", () => {
    const ok = parseWorkspaceResp(JSON.stringify({ success: true, workspacePath: "/repo" }));
    expect(ok).toEqual({ ok: true, workspacePath: "/repo", error: "" });
    const err = parseWorkspaceResp(JSON.stringify({ success: false, error: "denied" }));
    expect(err.ok).toBe(false);
    expect(err.error).toBe("denied");
    const garbage = parseWorkspaceResp("<html>502</html>"); // server down / proxy page
    expect(garbage.ok).toBe(false);
    expect(garbage.error).toMatch(/unparseable/);
  });
});
