#!/usr/bin/env tsx
// v1.29.2 µ1 — self-contained perf-smoke: p95 latency budget gate.
//
// Boots the REAL exported Express app IN-PROCESS (OLLAMAS_NO_AUTOBOOT=1 → no vite/store
// boot, no fixed port, no model inference, no GPU) exactly like tests/routes-openapi.test.ts,
// then hammers ONE lightweight static endpoint (/api/openapi.json — a pure in-memory JSON
// handler, `app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec))`). It collects
// N request latencies, computes p95, and compares against scripts/perf-budget.json.
// Over budget → exit 1.
//
// Deterministic + network-free by construction: nothing leaves the process (127.0.0.1 loopback
// to the in-process server), no live ollama, no DB, no external host. Safe to run alongside a
// GPU align-sweep — it never touches a model.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface PerfBudget {
  endpoint: string;
  requests: number;
  warmup?: number;
  p95BudgetMs: number;
}

/**
 * Nearest-rank percentile (deterministic, no interpolation). Pure — unit-tested in
 * scripts/tests/perf-smoke.test.ts. Empty input → NaN (caller guards).
 */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

export interface PerfSummary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Pure — derive the summary stats from a latency sample set. */
export function summarize(samples: number[]): PerfSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    min: sorted[0] ?? NaN,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

export function loadBudget(file = path.join(HERE, "perf-budget.json")): PerfBudget {
  return JSON.parse(fs.readFileSync(file, "utf8")) as PerfBudget;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "n/a");

async function main(): Promise<void> {
  const budget = loadBudget();
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  // Quiet the per-request pino logs so the p95 table is the only output (and logging
  // overhead does not skew the measurement). Caller can override with an explicit LOG_LEVEL.
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

  // Real exported app, no port fixed, no vite/store boot (same technique as routes-openapi).
  const { app } = await import("../server");
  const server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}${budget.endpoint}`;

  const timeOne = async (): Promise<number> => {
    const t0 = performance.now();
    const res = await fetch(url);
    await res.arrayBuffer(); // fully drain the body before stopping the clock
    if (res.status !== 200) throw new Error(`${budget.endpoint} → HTTP ${res.status}`);
    return performance.now() - t0;
  };

  try {
    const warmup = budget.warmup ?? 5;
    for (let i = 0; i < warmup; i++) await timeOne();

    const samples: number[] = [];
    for (let i = 0; i < budget.requests; i++) samples.push(await timeOne());

    const s = summarize(samples);
    const pass = s.p95 <= budget.p95BudgetMs;

    process.stdout.write(
      [
        `perf-smoke  endpoint=${budget.endpoint}  requests=${budget.requests}  warmup=${warmup}`,
        "┌─────────┬──────────┐",
        "│ metric  │  ms      │",
        "├─────────┼──────────┤",
        `│ min     │ ${fmt(s.min).padStart(8)} │`,
        `│ p50     │ ${fmt(s.p50).padStart(8)} │`,
        `│ p95     │ ${fmt(s.p95).padStart(8)} │`,
        `│ p99     │ ${fmt(s.p99).padStart(8)} │`,
        `│ max     │ ${fmt(s.max).padStart(8)} │`,
        "└─────────┴──────────┘",
        `budget: p95 ≤ ${budget.p95BudgetMs}ms  →  measured p95 ${fmt(s.p95)}ms  →  ${pass ? "PASS ✓" : "FAIL ✗"}`,
        "",
      ].join("\n"),
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.exit(pass ? 0 : 1);
  } catch (err) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw err;
  }
}

// Only self-execute when run directly (`tsx scripts/perf-smoke.ts`); stay inert on import
// so the pure-logic unit test never boots the server.
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
