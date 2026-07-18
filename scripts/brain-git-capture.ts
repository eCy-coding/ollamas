// Brain git-capture (Tur 6) — remembers every commit/merge/push BEFORE it happens.
// Invoked by the worktree-local git hooks (scripts/git-hooks/*) via tsx:
//   npx tsx scripts/brain-git-capture.ts <commit|merge|push>
// BEST-EFFORT by contract: any failure (ollama down, db locked) prints one warning
// and exits 0 — memory capture must never block a git operation.
// Disable per-shell with BRAIN_GIT_CAPTURE=0.
import { execFileSync } from "node:child_process";
import { createBrainStore } from "../server/brain";
import { resolveEmbedder } from "../server/rag";

export interface CaptureCtx {
  op: "commit" | "merge" | "push";
  branch: string;
  stagedStat: string;
  lastSubject: string;
  now: number;
}

const STAT_CAP = 2000;

/** Pure: git context → what the brain stores. Episodic memory (the event) +
 *  bi-temporal facts (current branch / last subject — history supersedes cleanly). */
export function buildCapture(ctx: CaptureCtx) {
  const stat = ctx.stagedStat.trim().slice(0, STAT_CAP);
  return {
    memory: {
      id: `git:${ctx.op}:${ctx.now}`,
      tier: "episodic" as const,
      content: `git ${ctx.op} @ ${ctx.branch} — son: "${ctx.lastSubject}"\n${stat}`,
      source: `git-${ctx.op}`,
    },
    facts: [
      { subject: "ollamas", predicate: "active_branch", object: ctx.branch },
      // Graph hygiene: the fact carries only the compact "type(scope)" head — a full
      // commit title as a graph node is unreadable noise (the memory above keeps it).
      { subject: "ollamas", predicate: "last_commit_subject", object: ctx.lastSubject.split(/[—:]/)[0].trim().slice(0, 32) },
    ],
  };
}

/** Race a promise against a timeout — rejects fast so a busy ollama can never hang a
 *  git commit. The embedder's own 30s AbortSignal is far too long for a pre-commit path. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`capture timed out after ${ms}ms`)), ms)),
  ]);
}

const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return "";
  }
};

async function main() {
  if (process.env.BRAIN_GIT_CAPTURE === "0") return;
  const op = (process.argv[2] || "commit") as CaptureCtx["op"];
  const ctx: CaptureCtx = {
    op,
    branch: git("rev-parse", "--abbrev-ref", "HEAD") || "(detached)",
    // For push there is nothing staged — fall back to the outgoing top commit's stat.
    stagedStat:
      git("diff", "--cached", "--stat") || git("show", "--stat", "--format=", "HEAD") || "(no diff)",
    lastSubject: git("log", "-1", "--format=%s") || "(no commits)",
    now: Date.now(),
  };
  const built = buildCapture(ctx);
  const r = resolveEmbedder();
  const b = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  const budget = Number(process.env.BRAIN_CAPTURE_TIMEOUT_MS) || 3000;
  try {
    await withTimeout((async () => {
      await b.remember(built.memory);
      for (const f of built.facts) await b.assertFact({ ...f, episodeId: built.memory.id });
    })(), budget);
    console.log(`[brain] captured ${built.memory.id} (${ctx.branch})`);
  } finally {
    b.close();
  }
}

// tsx entry — never break the git op (hooks rely on exit 0).
if (process.argv[1] && process.argv[1].endsWith("brain-git-capture.ts")) {
  main().catch((e) => {
    console.warn(`[brain] git capture skipped (${e?.message ?? e})`);
  });
}
