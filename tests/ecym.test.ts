import { describe, it, expect, vi, beforeEach } from "vitest";

// ai + council mocked so no GPU / running ollama is needed.
vi.mock("../server/ai", () => ({
  generate: vi.fn(async () => ({ text: "23", source: "test", tokensPerSec: 1, modelUsed: "ecy:latest" })),
}));

import {
  ECYM_WHITELIST,
  ECY_IDENTITY,
  buildEcymModelfile,
  pickBase,
  recordEcymVersion,
  distillEcym,
  getEcymStatus,
  type EcymVersion,
  type DistillEvent,
} from "../server/ecym";

const SYS = { arch: "arm64", ramGb: 48, cores: 16, chip: "Apple M4 Max" };
const CFG = { num_ctx: 8192, num_gpu: 999, num_thread: 12, keep_alive: "30m", quant: "Q4_K_M" };

function mockDb(workspacePath = "/tmp/ecym-test-ws") {
  return { data: { workspacePath, ecymVersions: undefined as EcymVersion[] | undefined }, save: vi.fn() };
}
const drain = async (gen: AsyncGenerator<DistillEvent>) => {
  const evs: DistillEvent[] = [];
  for await (const e of gen) evs.push(e);
  return evs;
};

describe("ecym — modelfile distillation (pure)", () => {
  it("builds FROM + SYSTEM(identity+principles) + PARAMETER lines", () => {
    const mf = buildEcymModelfile({ base: "qwen3:8b-16k", config: CFG, sys: SYS });
    expect(mf).toContain("FROM qwen3:8b-16k");
    expect(mf).toContain('SYSTEM """');
    expect(mf).toContain("You are eCy");
    expect(mf).toContain("Working principles:");
    expect(mf).toContain("PARAMETER num_ctx 8192");
    expect(mf).toContain("PARAMETER num_thread 12");
    expect(mf).toContain("PARAMETER temperature 0.4");
  });

  it("preserves an existing persona verbatim as the identity core", () => {
    const persona = "Sen eCy'sin — Emre'nin kişisel MacBook asistanı. Gevezelik YOK.";
    const mf = buildEcymModelfile({ base: "b", config: CFG, sys: SYS, identity: persona });
    expect(mf).toContain(persona);           // Emre's voice kept
    expect(mf).not.toContain("You are eCy"); // default identity NOT injected over it
    expect(mf).toContain("Working principles:"); // principles still appended
  });

  it("clamps temperature into [0,1]", () => {
    expect(buildEcymModelfile({ base: "b", config: CFG, sys: SYS, temperature: 9 })).toContain("PARAMETER temperature 1");
    expect(buildEcymModelfile({ base: "b", config: CFG, sys: SYS, temperature: -3 })).toContain("PARAMETER temperature 0");
  });
});

describe("ecym — base selection", () => {
  it("keeps the current base honestly when bench data is empty", () => {
    const { base, reason } = pickBase({ aggs: [] }, 48, "qwen3:8b-16k");
    expect(base).toBe("qwen3:8b-16k");
    expect(reason).toMatch(/no benchmark data/i);
  });

  it("picks the benchmark champion when real aggs exist", () => {
    const aggs = [
      { model: "qwen3:8b", device: "gpu", n: 30, medianTokS: 80, p95: 90, mad: 2, min: 70, max: 95, correctRatio: 0.9 },
      { model: "phi4:latest", device: "gpu", n: 30, medianTokS: 40, p95: 50, mad: 2, min: 30, max: 55, correctRatio: 0.85 },
    ];
    const { base, reason } = pickBase({ aggs }, 48, "qwen3:8b-16k");
    expect(base).toBe("qwen3:8b");
    expect(reason).toMatch(/champion/i);
  });
});

describe("ecym — version ledger", () => {
  it("records versions and persists via db.save", () => {
    const db = mockDb();
    recordEcymVersion(db, { id: "v1", createdAt: "t", base: "b", numCtx: 8192, temperature: 0.4, probeOk: true, note: "n" });
    expect(db.data.ecymVersions).toHaveLength(1);
    expect(db.save).toHaveBeenCalled();
  });

  it("caps the ledger at 50 entries", () => {
    const db = mockDb();
    for (let i = 0; i < 55; i++) {
      recordEcymVersion(db, { id: `v${i}`, createdAt: "t", base: "b", numCtx: 1, temperature: 0, probeOk: true, note: "" });
    }
    expect(db.data.ecymVersions).toHaveLength(50);
    expect(db.data.ecymVersions![0].id).toBe("v5"); // oldest trimmed
  });
});

describe("ecym — distill loop (deps injected, no real ollama)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses non-whitelisted model names", async () => {
    const evs = await drain(distillEcym(mockDb(), "llama3:70b"));
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ stage: "error", status: "fail" });
    expect(evs[0].text).toMatch(/whitelist/);
  });

  it("runs plan→modelfile→create→probe→done and records a version", async () => {
    const db = mockDb();
    const runCreate = vi.fn(async () => "created ok");
    const probe = vi.fn(async () => true);
    const evs = await drain(distillEcym(db, "ecy:candidate", { runCreate, probe }));
    const stages = evs.map((e) => `${e.stage}:${e.status}`);
    expect(stages).toContain("plan:done");
    expect(stages).toContain("modelfile:done");
    expect(stages).toContain("create:done");
    expect(stages).toContain("probe:done");
    expect(evs[evs.length - 1]).toMatchObject({ stage: "done", status: "done" });
    expect(runCreate).toHaveBeenCalledWith(expect.stringContaining(".ecym/Modelfile"), "ecy:candidate");
    expect(db.data.ecymVersions).toHaveLength(1);
    expect(db.data.ecymVersions![0].probeOk).toBe(true);
  });

  it("surfaces an honest create failure and does NOT record a version", async () => {
    const db = mockDb();
    const runCreate = vi.fn(async () => { throw new Error("manifest pull failed"); });
    const evs = await drain(distillEcym(db, "ecy:candidate", { runCreate }));
    const last = evs[evs.length - 1];
    expect(last).toMatchObject({ stage: "error", status: "fail" });
    expect(last.text).toMatch(/manifest pull failed/);
    expect(db.data.ecymVersions ?? []).toHaveLength(0);
  });

  it("marks probeOk=false when the probe fails, still records the version", async () => {
    const db = mockDb();
    const evs = await drain(distillEcym(db, "ecy:candidate", { runCreate: async () => "ok", probe: async () => false }));
    expect(evs.some((e) => e.stage === "probe" && e.status === "fail")).toBe(true);
    expect(db.data.ecymVersions![0].probeOk).toBe(false);
  });

  it("whitelist constant covers exactly the ecy family", () => {
    expect([...ECYM_WHITELIST]).toEqual(["ecy:latest", "ecy:candidate"]);
    expect(ECY_IDENTITY).toContain("local");
  });
});

describe("ecym — status", () => {
  it("parses ollama show into base + systemHead; honest exists=false on failure", async () => {
    const okFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ details: { parent_model: "qwen3:8b-16k" }, system: "You are eCy — personal AI." }),
    })) as unknown as typeof fetch;
    const st = await getEcymStatus(mockDb(), okFetch);
    expect(st.exists).toBe(true);
    expect(st.base).toBe("qwen3:8b-16k");
    expect(st.systemHead).toContain("eCy");

    const badFetch = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const st2 = await getEcymStatus(mockDb(), badFetch);
    expect(st2.exists).toBe(false);
  });
});
