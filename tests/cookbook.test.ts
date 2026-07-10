import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the local model stream so tests need no GPU / running ollama.
vi.mock("../server/ai", () => ({
  generateTextStream: vi.fn(async function* (_prompt: string, _opts?: unknown) {
    yield "chunk-1 ";
    yield "chunk-2";
  }),
}));

import { generateTextStream } from "../server/ai";
import {
  DEFAULT_RECIPES,
  DEFAULT_MODEL,
  ensureRecipeExecutions,
  recordRecipeExecution,
  getRecipeExecutions,
  runRecipe,
  recipeConfig,
  type RecipeExecution,
} from "../server/cookbook";

function mockDb() {
  return { data: { workspacePath: "" } as { workspacePath: string; recipeExecutions?: RecipeExecution[] }, save: vi.fn() };
}
const exec = (over: Partial<RecipeExecution> = {}): RecipeExecution => ({
  id: "exec-1",
  recipeId: "summarize-text",
  createdAt: new Date().toISOString(),
  status: "done",
  output: "out",
  model: DEFAULT_MODEL,
  ...over,
});

describe("cookbook — persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ensureRecipeExecutions creates the collection idempotently", () => {
    const db = mockDb();
    expect(db.data.recipeExecutions).toBeUndefined();
    const a = ensureRecipeExecutions(db);
    const b = ensureRecipeExecutions(db);
    expect(Array.isArray(a)).toBe(true);
    expect(a).toBe(b); // same array, not re-created
  });

  it("recordRecipeExecution appends and persists via db.save", () => {
    const db = mockDb();
    recordRecipeExecution(db, exec({ id: "e1" }));
    expect((db.data.recipeExecutions as RecipeExecution[]).length).toBe(1);
    expect(db.save).toHaveBeenCalledTimes(1);
  });

  it("recordRecipeExecution upserts by id (running → done, no dup)", () => {
    const db = mockDb();
    recordRecipeExecution(db, exec({ id: "e1", status: "running", output: "" }));
    recordRecipeExecution(db, exec({ id: "e1", status: "done", output: "final" }));
    const rows = db.data.recipeExecutions as RecipeExecution[];
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("done");
    expect(rows[0].output).toBe("final");
  });

  it("getRecipeExecutions returns most-recent-first and honours the limit", () => {
    const db = mockDb();
    const t0 = Date.parse("2026-07-11T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      recordRecipeExecution(db, exec({ id: `e${i}`, createdAt: new Date(t0 + i * 1000).toISOString() }));
    }
    const hist = getRecipeExecutions(db, "summarize-text", 3);
    expect(hist.length).toBe(3);
    expect(hist[0].id).toBe("e4"); // newest first
    expect(hist[2].id).toBe("e2");
  });

  it("getRecipeExecutions filters by recipeId", () => {
    const db = mockDb();
    recordRecipeExecution(db, exec({ id: "a", recipeId: "summarize-text" }));
    recordRecipeExecution(db, exec({ id: "b", recipeId: "code-review" }));
    expect(getRecipeExecutions(db, "code-review").map((e) => e.id)).toEqual(["b"]);
  });
});

describe("cookbook — recipe seed", () => {
  it("exports exactly 5 recipes with stable ids", () => {
    expect(DEFAULT_RECIPES).toHaveLength(5);
    expect(DEFAULT_RECIPES.map((r) => r.id)).toEqual([
      "summarize-text",
      "code-review",
      "explain-concept",
      "brainstorm-ideas",
      "extract-entities",
    ]);
  });

  it("every recipe carries the required fields", () => {
    for (const r of DEFAULT_RECIPES) {
      expect(r.id && r.name && r.description && r.instructions).toBeTruthy();
      expect(Array.isArray(r.tags) && r.tags.length).toBeTruthy();
    }
  });
});

describe("cookbook — execution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runRecipe streams chunks from ai.generateTextStream", async () => {
    const chunks: string[] = [];
    for await (const c of runRecipe(DEFAULT_RECIPES[0], "hello")) chunks.push(c);
    expect(chunks).toEqual(["chunk-1 ", "chunk-2"]);
  });

  it("runRecipe builds a prompt from instructions + user input and defaults the model", async () => {
    for await (const _ of runRecipe(DEFAULT_RECIPES[1], "my code")) { /* drain */ }
    expect(generateTextStream).toHaveBeenCalledWith(
      expect.stringContaining("my code"),
      expect.objectContaining({ model: DEFAULT_MODEL }),
    );
    expect(vi.mocked(generateTextStream).mock.calls[0][0]).toContain(DEFAULT_RECIPES[1].instructions);
  });

  it("runRecipe honours a recipe.model override", async () => {
    for await (const _ of runRecipe({ ...DEFAULT_RECIPES[0], model: "phi4:latest" }, "x")) { /* drain */ }
    expect(generateTextStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: "phi4:latest" }),
    );
  });
});

describe("cookbook — hardware-aware config (reuses optimize.ts)", () => {
  it("recipeConfig returns sys info + an optimalConfig for the model", () => {
    const { sys, config, model } = recipeConfig();
    expect(model).toBe(DEFAULT_MODEL);
    expect(typeof sys.ramGb).toBe("number");
    expect(typeof config.num_ctx).toBe("number");
    expect(typeof config.num_thread).toBe("number");
  });
});
