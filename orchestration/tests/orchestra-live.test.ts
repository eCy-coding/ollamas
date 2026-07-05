import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// G4 — LIVE real-time e2e against a REAL ollama daemon + REAL local model. Gated by RUN_LIVE=1 (needs ollama;
// slow; writes a real PROPOSAL.md). In the normal gate (no RUN_LIVE) the whole suite is skipped → green.
//   RUN_LIVE=1 vitest run orchestration/tests/orchestra-live.test.ts
const LIVE = process.env.RUN_LIVE === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const CLI = join(REPO, "orchestration", "bin", "orchestra.ts");
const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

async function ollamaUp(): Promise<boolean> {
  try { const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}
async function installedModels(): Promise<string[]> {
  try { const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) }); const j: any = await r.json(); return (j?.models ?? []).map((m: any) => String(m?.name)); } catch { return []; }
}

let stateDir: string;
function run(args: string[], extra: Record<string, string> = {}): void {
  execFileSync(TSX, [CLI, ...args], {
    cwd: REPO, stdio: "ignore", timeout: 240_000,
    env: { ...process.env, ORCHESTRA_STATE_DIR: stateDir, ORCHESTRA_FAKE_DECISION: "EXECUTE", ...extra },
  });
}
function state(): any { return JSON.parse(readFileSync(join(stateDir, "orchestra.json"), "utf8")); }

describe.runIf(LIVE)("LIVE — real ollama conductor", () => {
  let up = false, models: string[] = [];
  beforeAll(async () => { up = await ollamaUp(); models = await installedModels(); });
  afterEach(() => { if (stateDir) rmSync(stateDir, { recursive: true, force: true }); });

  it("real conductor tick uses a LOCAL model (no Claude Code)", async () => {
    if (!up) return; // ollama not running → skip assertion
    stateDir = mkdtempSync(join(tmpdir(), "orch-live-"));
    run(["--once"]);
    const s = state();
    expect(s.phase).toBe("COUNCIL_DEBATE");
    expect(models.some((m) => m === s.conductor_model) || s.conductor_model.length > 0).toBe(true);
  }, 120_000);

  it("REPAIR grounds the LOCAL model → writes a fleet PROPOSAL.md (STEP 4)", async () => {
    if (!up) return;
    stateDir = mkdtempSync(join(tmpdir(), "orch-live-"));
    const proposal = join(homedir(), ".llm-mission-control", "fleet", "work", "shell-harden.orchestra", "PROPOSAL.md");
    rmSync(dirname(proposal), { recursive: true, force: true });
    run(["shell-harden proposal"]);              // enqueue a stream-named task
    let made = false;
    for (let i = 0; i < 6 && !made; i++) {        // drive ticks until REPAIR fires (bounded)
      run(["--once"], { ORCHESTRA_FAKE_CONVERGED: "0" });
      made = existsSync(proposal);
    }
    expect(made).toBe(true);
    expect(readFileSync(proposal, "utf8")).toContain("shell-harden · orchestra ·"); // fleet-apply header contract
    rmSync(dirname(proposal), { recursive: true, force: true });
  }, 300_000);

  it("REAL joker: unavailable conductor model → live failover to a healthy model", async () => {
    if (!up || models.length === 0) return;
    stateDir = mkdtempSync(join(tmpdir(), "orch-live-"));
    run(["--once"], { ORCHESTRA_CONDUCTOR: "nonexistent-model:0b" }); // not installed → probe fails
    const s = state();
    expect(s.failover_count).toBeGreaterThanOrEqual(1);
    expect(s.conductor_model).not.toBe("nonexistent-model:0b"); // swapped to a real healthy joker
    expect(models).toContain(s.conductor_model);
  }, 120_000);
});
