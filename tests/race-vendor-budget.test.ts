// v1.28.2 concurrency regression — CROSS-PROCESS lost-update on the shared free-tier budget file.
//
// noteVendorOutcome() is a read-modify-write (loadBudget → +1 → saveBudget) on
// `~/.llm-mission-control/vendor-budget.json`, a file that EVERY fleet dispatch PROCESS
// (orchestration/bin/fleet-agent.ts, gemini-run.ts) writes concurrently. Two processes both read the
// old map, both write their slice, the second rename wins → the first's increment is LOST → the
// free-tier daily budget under-counts → the fleet over-dispatches past the cap (highest blast radius).
//
// This is a genuine multi-PROCESS race: Node's fs.*Sync calls can't interleave inside one process, so
// the repro spawns real `tsx` child processes that all cross a barrier together (every worker has read
// the old state before any writes) and then hammer the same vendor. Deterministic: with N processes ×
// ITERS increments the final `used` MUST equal N*ITERS; any lost update makes it strictly less.
//
// Revert the withLock guard in vendor-budget.noteVendorOutcome and this fails (used < N*ITERS).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const BUDGET_LIB = join(REPO, "orchestration", "bin", "lib", "vendor-budget.ts");

const N = 4; // concurrent dispatch processes
const ITERS = 40; // successful requests each records
const VENDOR = "groq";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "race-budget-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runWorker(budgetPath: string, barrierDir: string, id: number, workerSrc: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(dir, `worker-${id}.ts`);
    writeFileSync(scriptPath, workerSrc);
    const child = spawn(TSX, [scriptPath, budgetPath, VENDOR, String(ITERS), barrierDir, String(id), String(N)], {
      cwd: REPO,
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(code) : reject(new Error(`worker ${id} exit ${code}`))));
  });
}

describe("cross-process race: vendor-budget lost-update", () => {
  it(
    "every concurrent increment survives (no lost update)",
    async () => {
      const budgetPath = join(dir, "vendor-budget.json");
      const barrierDir = join(dir, "barrier");
      mkdirSync(barrierDir, { recursive: true });

      // Worker: register at the barrier, wait until ALL workers have read the old state, then hammer
      // the same vendor. The barrier forces maximal read-modify-write overlap across processes.
      const workerSrc = `
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { noteVendorOutcome } from ${JSON.stringify(BUDGET_LIB)};
const [budgetPath, vendor, itersStr, barrierDir, id, nStr] = process.argv.slice(2);
const iters = Number(itersStr), n = Number(nStr);
mkdirSync(barrierDir, { recursive: true });
writeFileSync(barrierDir + "/" + id, "1");
const deadline = Date.now() + 10000;
while (readdirSync(barrierDir).length < n && Date.now() < deadline) { /* spin */ }
for (let i = 0; i < iters; i++) noteVendorOutcome(budgetPath, vendor, "success");
`;

      await Promise.all(
        Array.from({ length: N }, (_, i) => runWorker(budgetPath, barrierDir, i, workerSrc)),
      );

      // Read the final persisted state directly (no lock) — the assertion is on the durable count.
      const { loadBudget } = await import(BUDGET_LIB);
      const map = loadBudget(budgetPath);
      const used = map[VENDOR]?.used ?? 0;

      expect(used).toBe(N * ITERS);
    },
    30_000,
  );
});
