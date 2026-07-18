import { describe, it, expect, vi } from "vitest";
import {
  PANEL_IDS,
  isPanelId,
  PANEL_BRIEFS,
  buildAssistPrompt,
  resolveBrief,
  assistStream,
  distillPanel,
  withGpu,
} from "../server/panel-assist";

function mockDb(briefs?: Record<string, { brief: string; ts: string; sources: string[] }>) {
  return { data: { panelBriefs: briefs }, save: vi.fn() };
}
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("panel-assist — panel registry", () => {
  it("covers exactly the 5 eCym-controlled panels", () => {
    expect([...PANEL_IDS]).toEqual(["search", "github-actions", "integrations", "threatintel", "keys"]);
  });
  it("validates panel ids", () => {
    expect(isPanelId("keys")).toBe(true);
    expect(isPanelId("nope")).toBe(false);
  });
  it("has a role + non-empty fallback + distill queries for every panel", () => {
    for (const id of PANEL_IDS) {
      const spec = PANEL_BRIEFS[id];
      expect(spec.role.length).toBeGreaterThan(0);
      expect(spec.fallback.length).toBeGreaterThan(0);
      expect(spec.queries.length).toBeGreaterThan(0);
    }
  });
});

describe("panel-assist — buildAssistPrompt (pure)", () => {
  it("puts the specialist role + brief in system and the context in the prompt", () => {
    const { system, prompt } = buildAssistPrompt("github-actions", "run #42 failed at step 'build'", "BRIEF-TEXT");
    expect(system).toContain(PANEL_BRIEFS["github-actions"].role);
    expect(system).toContain("BRIEF-TEXT");
    expect(prompt).toContain("run #42 failed");
  });
  it("keys panel system forbids reading secret values (metadata-only guard)", () => {
    const { system } = buildAssistPrompt("keys", "provider=openai status=active age=90d", "B");
    expect(system.toLowerCase()).toMatch(/never|asla/);
    expect(system.toLowerCase()).toContain("value");
  });
});

describe("panel-assist — resolveBrief", () => {
  it("returns the distilled brief when present", () => {
    const db = mockDb({ keys: { brief: "DISTILLED", ts: "t", sources: [] } });
    expect(resolveBrief(db, "keys")).toBe("DISTILLED");
  });
  it("falls back to the hardcoded brief when none distilled (never blocks)", () => {
    expect(resolveBrief(mockDb(), "keys")).toBe(PANEL_BRIEFS["keys"].fallback);
  });
});

describe("panel-assist — assistStream", () => {
  it("streams the specialist answer via ecy:latest with the brief as system", async () => {
    const calls: Array<{ prompt: string; opts: { model?: string; system?: string } }> = [];
    const stream = async function* (prompt: string, opts: { model?: string; system?: string }) {
      calls.push({ prompt, opts });
      yield "diag";
      yield "nosis";
    };
    const out = await drain(assistStream(mockDb(), "github-actions", "logs…", { stream }));
    expect(out.join("")).toBe("diagnosis");
    expect(calls[0].opts.model).toBe("ecy:latest");
    expect(calls[0].opts.system).toContain(PANEL_BRIEFS["github-actions"].role);
  });
});

describe("panel-assist — distillPanel (search → compress → store)", () => {
  it("gathers sources, compresses a brief, persists it, and reports done", async () => {
    const db = mockDb();
    const search = vi.fn(async () => [{ title: "T", url: "https://x", snippet: "s" }]);
    const compress = vi.fn(async () => "COMPRESSED BRIEF");
    const evs = await drain(distillPanel(db, "threatintel", { search, compress }));
    expect(search).toHaveBeenCalled();
    expect((db.data.panelBriefs as Record<string, { brief: string }>)["threatintel"].brief).toBe("COMPRESSED BRIEF");
    expect(db.save).toHaveBeenCalled();
    expect(evs[evs.length - 1]).toMatchObject({ stage: "done", status: "done" });
  });
  it("is fail-soft: a search error still ends honestly without throwing", async () => {
    const db = mockDb();
    const search = vi.fn(async () => { throw new Error("network down"); });
    const evs = await drain(distillPanel(db, "search", { search }));
    expect(evs.some((e) => e.status === "fail")).toBe(true);
    // no brief stored on failure — the fallback keeps serving
    expect((db.data.panelBriefs as Record<string, unknown> | undefined)?.["search"]).toBeUndefined();
  });
});

describe("panel-assist — withGpu mutex", () => {
  it("serializes jobs in FIFO order (no parallel inference)", async () => {
    let firstDone = false;
    const p1 = withGpu(async () => { await Promise.resolve(); await Promise.resolve(); firstDone = true; });
    const p2 = withGpu(async () => { expect(firstDone).toBe(true); return "ok"; });
    const [, r2] = await Promise.all([p1, p2]);
    expect(r2).toBe("ok");
  });
});
