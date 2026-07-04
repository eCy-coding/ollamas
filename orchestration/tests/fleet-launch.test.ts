// bin/fleet-launch.ts composition tests — the launcher's pure pipeline (plan → cap-guard → filter →
// sequenced ordering → T# labels → workspace request), exercised exactly as the bin composes it.
// Not a duplicate of fleet-plan/mission/fleet-order/workspace tests: those cover each lib alone; this
// covers the LAUNCH-level joins (fake `ollama list` set → plan; readyApiProviders feed; label mapping).
import { describe, it, expect } from "vitest";
import { buildFleetPlan, assertMaxTwo, STREAMS, type Assignment } from "../bin/lib/fleet-plan";
import { buildMission, DEFAULT_DEPS, type AssignmentLike } from "../bin/lib/mission";
import { orderSlotsByMission, type OrderedSlot } from "../bin/lib/fleet-order";
import { selectWorkspaceRequest, parseWorkspaceResp } from "../bin/lib/workspace";

// A fake `ollama list` model set (what liveModels() would return), distinct from fleet-plan.test.ts LIVE.
const FAKE_OLLAMA_LIST = [
  "qwen3-coder:30b", "qwen3-coder-64k:latest", "qwen3:8b", "deepseek-r1:32b",
  "llama3.3:70b", "gpt-oss:20b-cloud", "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud",
];

describe("fleet-launch — plan from a fake `ollama list` set", () => {
  const plan = buildFleetPlan(FAKE_OLLAMA_LIST, []); // exactly the bin's call: buildFleetPlan(liveModels(), readyApiProviders)

  it("respects the ≤2-tasks/model hard cap (assertMaxTwo does not exit the launcher)", () => {
    expect(plan.maxTwoOk).toBe(true);
    expect(() => assertMaxTwo(plan)).not.toThrow();
  });

  it("launchable slots = assignments with a resolved model (null slots are never launched)", () => {
    const slots = plan.assignments.filter((a) => a.model); // the bin's filter
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.model).toBeTruthy();
    expect(slots.length + plan.unassigned.length).toBe(STREAMS.length * 2);
  });

  it("--cloud-only filter keeps only cloud-runtime slots (GPU-safe launch)", () => {
    const cloud = plan.assignments.filter((a) => a.model).filter((a) => a.runtime === "cloud"); // the bin's filter chain
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((a) => a.runtime === "cloud")).toBe(true);
  });

  it("readyApiProviders unlock provider::model cloud workers under the same ≤2 cap (bin feed path)", () => {
    const apiPlan = buildFleetPlan([], ["zai", "groq", "cerebras"]); // server keys live, zero local models
    const apiSlots = apiPlan.assignments.filter((a) => a.model?.includes("::"));
    expect(apiSlots.length).toBeGreaterThan(0);
    expect(apiSlots.every((a) => a.runtime === "cloud")).toBe(true);
    expect(apiPlan.maxTwoOk).toBe(true);
  });
});

describe("fleet-launch --sequenced — T# label mapping (bin's ordered-launch composition)", () => {
  const plan = buildFleetPlan(FAKE_OLLAMA_LIST, []);
  const slots = plan.assignments.filter((a) => a.model);
  // exactly the bin's composition:
  const assignLike: AssignmentLike[] = plan.assignments.map((a) => ({ stream: a.stream, concern: a.concern, model: a.model }));
  const mission = buildMission(assignLike, new Map(Object.entries(DEFAULT_DEPS)));
  const ordered: OrderedSlot<Assignment>[] = orderSlotsByMission(slots, mission);
  const launch = ordered.map((o) => ({ a: o.slot, label: `T${o.missionOrder}·${o.tier || "?"}` }));

  it("every launch line carries a valid T#·tier label (never privileged, never '?')", () => {
    expect(launch.length).toBe(slots.length); // ordering drops nothing
    for (const { label } of launch) expect(label).toMatch(/^T\d+·(safe|host)$/);
  });

  it("launch order is foundation-first: T1 = the mission's first step (shell-harden DAG root)", () => {
    expect(mission.steps[0].stream).toBe("shell-harden");
    expect(launch[0].label.startsWith("T1·")).toBe(true);
    expect(launch[0].a.stream).toBe("shell-harden");
  });

  it("labels are monotonically non-decreasing (T1→Tn tab-open sequence)", () => {
    const orders = ordered.map((o) => o.missionOrder);
    for (let i = 1; i < orders.length; i++) expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
  });

  it("dependency order holds in the launched sequence (typescript-core after mjs-migration)", () => {
    const streams = launch.map((l) => l.a.stream);
    const first = (s: string) => streams.indexOf(s);
    if (first("mjs-migration") >= 0 && first("typescript-core") >= 0) {
      expect(first("mjs-migration")).toBeLessThan(first("typescript-core"));
    }
    // test-coverage is the DAG sink → its slots launch after every other stream's slots
    const lastNonTest = Math.max(...streams.map((s, i) => (s === "test-coverage" ? -1 : i)));
    if (first("test-coverage") >= 0) expect(first("test-coverage")).toBeGreaterThan(lastNonTest);
  });
});

describe("fleet-launch ensureWorkspace — request/response contract (bin's exact composition)", () => {
  const OLLAMAS_URL = "http://127.0.0.1:3000"; // the bin's default
  const REPO = "/Users/x/Desktop/ollamas";

  it("builds POST /api/workspace/select pointing the server workspace at the repo", () => {
    const req = selectWorkspaceRequest(OLLAMAS_URL, REPO);
    expect(req.url).toBe("http://127.0.0.1:3000/api/workspace/select");
    expect(req.method).toBe("POST");
    expect(req.contentType).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ path: REPO });
  });

  it("round-trip: a server success response parses back to the same repo path", () => {
    const r = parseWorkspaceResp(JSON.stringify({ success: true, workspacePath: REPO }));
    expect(r.ok).toBe(true);
    expect(r.workspacePath).toBe(REPO); // what the bin logs as "fleet workers can read the repo"
  });
});
