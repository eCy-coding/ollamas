import { describe, it, expect } from "vitest";
import {
  parseOllamaTags, classifyWorker, fleetReadiness, renderDispatchDoctor,
  type WorkerProbe, type WorkerStatus,
} from "../bin/lib/dispatchdoctor";

// ollamas /api/health body shape (metrics.parseHealth expects metrics.loadedModels[]).
const healthBody = (mode: string, models: string[]) => JSON.stringify({
  mode, db: "up",
  metrics: { cpuLoad1Min: 1, memory: { percentageUsed: 40 }, ollamaVersion: "0.30.11", loadedModels: models.map((name) => ({ name })) },
});
const tagsBody = (models: string[]) => JSON.stringify({ models: models.map((name) => ({ name })) });

// ── parseOllamaTags ───────────────────────────────────────────────────────────
describe("parseOllamaTags — tolerant", () => {
  it("extracts names", () => expect(parseOllamaTags(tagsBody(["qwen3:8b", "llama3:8b"]))).toEqual(["qwen3:8b", "llama3:8b"]));
  it("null/garbage → []", () => {
    expect(parseOllamaTags(null)).toEqual([]);
    expect(parseOllamaTags("not json")).toEqual([]);
    expect(parseOllamaTags("{}")).toEqual([]);
  });
});

// ── classifyWorker ────────────────────────────────────────────────────────────
describe("classifyWorker — gateway vs inference-only vs down", () => {
  it("ollamas /api/health present → gateway (mode + models)", () => {
    const p: WorkerProbe = { name: "mac", url: "http://127.0.0.1:8090", control: true, healthBody: healthBody("live", ["qwen3:8b"]), tagsBody: null };
    const s = classifyWorker(p);
    expect(s.capability).toBe("gateway");
    expect(s.mode).toBe("live");
    expect(s.models).toContain("qwen3:8b");
  });
  it("only /api/tags (ollama-native) → inference-only", () => {
    const p: WorkerProbe = { name: "desktop-ert7724", url: "http://desktop-ert7724:11434", control: false, healthBody: null, tagsBody: tagsBody(["qwen3:8b"]) };
    const s = classifyWorker(p);
    expect(s.capability).toBe("inference-only");
    expect(s.mode).toBeNull();
    expect(s.models).toEqual(["qwen3:8b"]);
  });
  it("neither endpoint → down", () => {
    const s = classifyWorker({ name: "x", url: "http://x:1", control: false, healthBody: null, tagsBody: null });
    expect(s.capability).toBe("down");
    expect(s.models).toEqual([]);
  });
  it("gateway merges health-loaded ∪ tags", () => {
    const p: WorkerProbe = { name: "g", url: "u", control: false, healthBody: healthBody("live", ["qwen3:8b"]), tagsBody: tagsBody(["qwen3:8b", "extra:1b"]) };
    expect(classifyWorker(p).models.sort()).toEqual(["extra:1b", "qwen3:8b"]);
  });
});

// ── fleetReadiness ────────────────────────────────────────────────────────────
const macGw: WorkerStatus = { name: "mac", url: "u", control: true, capability: "gateway", mode: "live", models: ["qwen3:8b"], detail: "" };
const deskInf: WorkerStatus = { name: "desktop-ert7724", url: "u", control: false, capability: "inference-only", mode: null, models: ["qwen3:8b"], detail: "" };
const deskGw: WorkerStatus = { name: "desktop-ert7724", url: "u", control: false, capability: "gateway", mode: "live", models: ["qwen3:8b"], detail: "" };
const deskDown: WorkerStatus = { name: "desktop-ert7724", url: "u", control: false, capability: "down", mode: null, models: [], detail: "" };

describe("fleetReadiness — per-mode GO/NO-GO", () => {
  it("mac gateway + desktop inference-only + model → offload GO, full-remote NO-GO (run gateway remediation)", () => {
    const r = fleetReadiness([macGw, deskInf], "qwen3:8b");
    expect(r.inferenceOffload.go).toBe(true);
    expect(r.fullRemoteDispatch.go).toBe(false);
    expect(r.fullRemoteDispatch.remediation.join(" ")).toMatch(/gateway server/i);
    expect(r.fullRemoteDispatch.remediation.join(" ")).toMatch(/desktop-ert7724/);
  });
  it("remote gateway with model → full-remote GO", () => {
    const r = fleetReadiness([macGw, deskGw], "qwen3:8b");
    expect(r.fullRemoteDispatch.go).toBe(true);
    expect(r.inferenceOffload.go).toBe(true);
  });
  it("desktop down → both reflect (offload still GO via mac-with-model; full-remote NO-GO)", () => {
    const r = fleetReadiness([macGw, deskDown], "qwen3:8b");
    expect(r.inferenceOffload.go).toBe(true); // mac has the model and is reachable
    expect(r.fullRemoteDispatch.go).toBe(false);
    expect(r.fullRemoteDispatch.remediation.join(" ")).toMatch(/çevrimdışı|aç/i);
  });
  it("missing model everywhere → offload NO-GO + pull remediation", () => {
    const r = fleetReadiness(
      [{ ...macGw, models: [] }, { ...deskInf, models: [] }], "qwen3:8b",
    );
    expect(r.inferenceOffload.go).toBe(false);
    expect(r.inferenceOffload.remediation.join(" ")).toMatch(/pull qwen3:8b/);
  });
  it("no remotes at all → full-remote NO-GO + discover remediation", () => {
    const r = fleetReadiness([macGw], "qwen3:8b");
    expect(r.fullRemoteDispatch.go).toBe(false);
    expect(r.fullRemoteDispatch.remediation.join(" ")).toMatch(/discover/);
  });
  it("deterministic", () => {
    expect(fleetReadiness([macGw, deskInf], "qwen3:8b")).toEqual(fleetReadiness([macGw, deskInf], "qwen3:8b"));
  });
});

// ── renderDispatchDoctor ──────────────────────────────────────────────────────
describe("renderDispatchDoctor", () => {
  it("worker table + both mode verdicts + remediation", () => {
    const statuses = [macGw, deskInf];
    const md = renderDispatchDoctor(statuses, fleetReadiness(statuses, "qwen3:8b"), "qwen3:8b", "2026-06-28");
    expect(md).toMatch(/DISPATCH_DOCTOR/);
    expect(md).toMatch(/inference-offload/);
    expect(md).toMatch(/full-remote-dispatch/);
    expect(md).toMatch(/NO-GO/);          // full-remote is NO-GO here
    expect(md).toMatch(/desktop-ert7724/);
  });
});
