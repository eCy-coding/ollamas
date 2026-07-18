/**
 * server/cookbook.ts — Cookbook: hardware-aware recipe runner (P1 first working panel).
 *
 * Reuses the real ollamas engines (no new abstractions):
 *   - orchestration/bin/lib/optimize.ts → parseSysctl + optimalConfig (hardware-aware config)
 *   - server/ai.ts → generateTextStream ($0-local qwen3:8b streaming)
 * A "recipe" is a saved instruction template; running one streams the model's
 * answer over SSE and persists the run to the local encrypted JSON store (db.data).
 */
import { execSync } from "node:child_process";
import type { Request, Response } from "express";
import { generateTextStream } from "./ai";
import { optimalConfig, parseSysctl, type OptConfig, type SysInfo } from "../orchestration/bin/lib/optimize";

// ============ TYPES ============

export interface Recipe {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tags: string[];
  /** Optional model override; defaults to the $0-local champion. */
  model?: string;
}

export interface RecipeExecution {
  id: string;
  recipeId: string;
  createdAt: string;
  status: "running" | "done" | "error";
  output: string;
  model: string;
}

/** The $0-local champion — default for every recipe. */
export const DEFAULT_MODEL = "qwen3:8b";
/** Hard ceiling so a wedged model stream can never hang the request forever. */
export const RECIPE_TIMEOUT_MS = 60_000;

// Minimal shape of the DB singleton this module needs (server/db.ts DB class:
// `.data` config object + synchronous `.save()`). Kept structural so the real DB
// (data: DBConfig, save(newData?: DBConfig)) assigns without a hard dependency.
interface DBLike {
  // `workspacePath` (which DBConfig always has) is named only so the real DB
  // shares a non-optional property and assigns without TS weak-type rejection;
  // cookbook itself only ever reads/writes recipeExecutions.
  data: { workspacePath: string; recipeExecutions?: RecipeExecution[] };
  save: () => void;
}
// Express middleware shape (localOwnerGuard from server.ts).
type Guard = (req: Request, res: Response, next: () => void) => void;

// ============ SEED DATA (5 recipes) ============

export const DEFAULT_RECIPES: Recipe[] = [
  {
    id: "summarize-text",
    name: "Summarize Text",
    description: "Condense long-form text into a few key points.",
    instructions:
      "Summarize the following text into 3–5 concise bullet points. Keep only what matters.",
    tags: ["text", "summarize"],
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Flag bugs, security issues and improvements in a snippet.",
    instructions:
      "Review the following code for bugs, security issues and performance improvements. Be specific and cite line intent.",
    tags: ["code", "review"],
  },
  {
    id: "explain-concept",
    name: "Explain a Concept",
    description: "Break a complex idea down for a beginner.",
    instructions:
      "Explain the following concept in plain language a beginner can follow, with one short analogy.",
    tags: ["learn", "explain"],
  },
  {
    id: "brainstorm-ideas",
    name: "Brainstorm Ideas",
    description: "Generate diverse ideas on a topic.",
    instructions:
      "Generate 10 diverse, non-obvious ideas related to the following topic. One line each.",
    tags: ["ideas", "creative"],
  },
  {
    id: "extract-entities",
    name: "Extract Entities",
    description: "Pull people, orgs, places and dates from text.",
    instructions:
      "Extract every named entity (people, organizations, locations, dates) from the following text. Group by type.",
    tags: ["nlp", "extract"],
  },
];

// ============ PERSISTENCE (local db.data, synchronous save) ============

/** Ensure the recipeExecutions collection exists on db.data (idempotent). */
export function ensureRecipeExecutions(db: DBLike): RecipeExecution[] {
  if (!Array.isArray(db.data.recipeExecutions)) db.data.recipeExecutions = [];
  return db.data.recipeExecutions;
}

/** Upsert an execution record and persist (db.save is synchronous + atomic). */
export function recordRecipeExecution(db: DBLike, exec: RecipeExecution): void {
  const rows = ensureRecipeExecutions(db);
  const idx = rows.findIndex((e) => e.id === exec.id);
  if (idx >= 0) rows[idx] = exec;
  else rows.push(exec);
  db.save();
}

/** Most-recent-first execution history for a recipe. */
export function getRecipeExecutions(db: DBLike, recipeId: string, limit = 50): RecipeExecution[] {
  return ensureRecipeExecutions(db)
    .filter((e) => e.recipeId === recipeId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

// ============ HARDWARE-AWARE MODEL CONFIG (reuse optimize.ts) ============

/** Detect this machine's specs via sysctl (macOS); honest fallback elsewhere. */
export function detectSystemInfo(): SysInfo {
  try {
    const mem = execSync("sysctl -n hw.memsize", { encoding: "utf8" }).trim();
    const cpu = execSync("sysctl -n hw.physicalcpu", { encoding: "utf8" }).trim();
    const brand = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf8" }).trim();
    return parseSysctl(mem, cpu, brand);
  } catch {
    return { arch: process.arch, ramGb: 8, cores: 4, chip: "unknown" };
  }
}

/** Hardware-aware runtime config for a recipe's model (reuses optimalConfig). */
export function recipeConfig(model: string = DEFAULT_MODEL): { sys: SysInfo; config: OptConfig; model: string } {
  const sys = detectSystemInfo();
  return { sys, config: optimalConfig(sys.ramGb, sys.cores, model), model };
}

// ============ EXECUTION (reuse ai.ts generateTextStream) ============

/** Stream a recipe's answer chunk-by-chunk from the local model. */
export async function* runRecipe(recipe: Recipe, userInput = ""): AsyncGenerator<string> {
  const model = recipe.model || DEFAULT_MODEL;
  const prompt = `${recipe.instructions}\n\n--- input ---\n${userInput || "(none)"}`;
  for await (const chunk of generateTextStream(prompt, { model })) {
    yield chunk;
  }
}

// ============ ROUTES ============

export function registerCookbookRoutes(app: { get: Function; post: Function }, db: DBLike, guard: Guard): void {
  ensureRecipeExecutions(db);

  // List recipes.
  app.get("/api/cookbook", guard, (_req: Request, res: Response) => {
    res.json(DEFAULT_RECIPES);
  });

  // Recipe detail (whitelist-only — no arbitrary ids reach the model).
  app.get("/api/cookbook/:id", guard, (req: Request, res: Response) => {
    const recipe = DEFAULT_RECIPES.find((r) => r.id === req.params.id);
    if (!recipe) return res.status(404).json({ error: "recipe not found" });
    res.json({ recipe, ...recipeConfig(recipe.model) });
  });

  // Execution history for a recipe.
  app.get("/api/cookbook/:id/executions", guard, (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json(getRecipeExecutions(db, req.params.id, limit));
  });

  // Execute a recipe → SSE stream of model output (bounded by RECIPE_TIMEOUT_MS).
  app.post("/api/cookbook/:id/execute", guard, async (req: Request, res: Response) => {
    const recipe = DEFAULT_RECIPES.find((r) => r.id === req.params.id);
    if (!recipe) return res.status(404).json({ error: "recipe not found" });

    const model = recipe.model || DEFAULT_MODEL;
    const exec: RecipeExecution = {
      id: `exec-${Date.now()}-${Math.round(Math.random() * 1e6).toString(36)}`,
      recipeId: recipe.id,
      createdAt: new Date().toISOString(),
      status: "running",
      output: "",
      model,
    };
    recordRecipeExecution(db, exec);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const started = Date.now();
    let output = "";
    try {
      for await (const chunk of runRecipe(recipe, String(req.body?.userInput ?? ""))) {
        if (Date.now() - started > RECIPE_TIMEOUT_MS) throw new Error("recipe timed out");
        output += chunk;
        res.write(`data: ${JSON.stringify({ chunk, executionId: exec.id })}\n\n`);
      }
      exec.status = "done";
      exec.output = output;
      recordRecipeExecution(db, exec);
      res.write(`data: ${JSON.stringify({ done: true, executionId: exec.id })}\n\n`);
      res.end();
    } catch (err) {
      exec.status = "error";
      exec.output = output;
      recordRecipeExecution(db, exec);
      res.write(`data: ${JSON.stringify({ error: (err as Error)?.message || "execution failed", executionId: exec.id })}\n\n`);
      res.end();
    }
  });
}
