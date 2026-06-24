#!/usr/bin/env node
// test-signal — run the vitest suite, then persist a fresh test-results/.last-run.json
// {status, failedTests} reflecting THIS run's result. The conductor's quality roll-up
// (orchestration/bin/quality.ts) reads that file for the per-lane test signal but never
// runs vitest itself (live vitest is "pahalı+flaky"). Newer `vitest run` no longer writes
// .last-run.json in CI mode, so the file went orphaned/stale → the quality dashboard froze
// on the last run that DID write it (a 2026-06-20 failure), permanently mislabelling a green
// tree as a RED lane. This wrapper restores the contract: every `npm run test` refreshes the
// signal. It passes through args/stdio and preserves vitest's exit code unchanged.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(REPO, "node_modules", ".bin", "vitest");

const r = spawnSync(VITEST, ["run", ...process.argv.slice(2)], { cwd: REPO, stdio: "inherit" });
const code = r.status ?? 1;

// Best-effort signal write — never mask the test exit code.
try {
  mkdirSync(join(REPO, "test-results"), { recursive: true });
  writeFileSync(
    join(REPO, "test-results", ".last-run.json"),
    JSON.stringify({ status: code === 0 ? "passed" : "failed", failedTests: [] }) + "\n",
  );
} catch { /* signal is advisory; the real verdict is the exit code below */ }

process.exit(code);
