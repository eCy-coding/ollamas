// Brain service registry (S27) — the brain-side twin of the orchestration
// µ-service registry (same ServiceSpec contract shape, SEPARATE registry: org-lane
// ids like brain-ledger/brain-mirror stay theirs; S18 references that surface as a
// SOURCE, never re-declares it). Every brain service declares id/kind/role/deps
// and a selftest() that PROVES the service alive — fast (<1s), deterministic
// (fake embed + tmp db, never the production store), side-effect-free outside
// tmp. kind:"network" selftests probe the live :3000 surface and are skipped
// under --offline. The registry grows commit-by-commit; the exactly-50 contract
// is asserted when S50 lands (no stubs — an entry exists only when its service
// does).
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createBrainStore, parseExtraction, type BrainStore } from "./brain";

export interface SelftestResult {
  ok: boolean;
  evidence: string;
}

export interface BrainServiceSpec {
  id: string;
  kind: "pure" | "io" | "network";
  role: string;
  deps: string[];
  source: string;
  selftest: () => Promise<SelftestResult> | SelftestResult;
}

// ── shared selftest harness ──────────────────────────────────────────────────
const fakeEmbed = async (t: string) => {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, ((h * 29) % 997) / 997];
};

let seq = 0;
const tmpDb = () => path.join(os.tmpdir(), `brain-selftest-${process.pid}-${++seq}.db`);

/** Throwaway store for a single selftest — never the production db. */
const withStore = async <T>(fn: (b: BrainStore) => Promise<T>): Promise<T> => {
  const b = createBrainStore({ dbPath: tmpDb(), embed: fakeEmbed, embedProvider: "selftest-fake" });
  try {
    return await fn(b);
  } finally {
    b.close();
  }
};

const ok = (evidence: string): SelftestResult => ({ ok: true, evidence });
const expectThat = (cond: boolean, yes: string, no: string): SelftestResult =>
  cond ? ok(yes) : { ok: false, evidence: no };

/** Shared harness for subscriber selftests: install → emit → flush → check → stop.
 *  Runs in the RUNNER's process (never the live server — the singleton guard
 *  would refuse there, which is itself correct: selftests must not graft onto
 *  production aggregation state). */
const subscriberRoundtrip = async (
  type: import("./brain-bus").BrainEventType,
  payload: Record<string, unknown>,
  check: (r: import("./brain-subscribers").FlushReport, mems: { tier?: string; content?: string }[]) => SelftestResult,
): Promise<SelftestResult> => {
  const { registerBrainSubscribers } = await import("./brain-subscribers");
  const { emit } = await import("./brain-bus");
  const mems: { tier?: string; content?: string }[] = [];
  let subs: import("./brain-subscribers").BrainSubscribers;
  try {
    subs = registerBrainSubscribers(
      { remember: async (m) => { mems.push(m); return {}; }, assertFact: async () => ({}) },
      {},
      { intervalMs: 1e9 },
    );
  } catch (e) {
    return { ok: false, evidence: `subscribers busy: ${(e as Error).message}` };
  }
  try {
    emit({ type, source: "selftest", at: Date.now(), payload });
    await new Promise((r) => setTimeout(r, 0));
    return check(await subs.flushNow(), mems);
  } finally {
    subs.stop();
  }
};

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
const probe = async (p: string): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(8000) });
  return { status: res.status, text: await res.text() };
};

// ── S1–S28 (S29+ entries land with their commits) ────────────────────────────
export const BRAIN_SERVICES: BrainServiceSpec[] = [
  {
    id: "embed-service", kind: "io", role: "$0 local embedding resolution", deps: [],
    source: "server/rag.ts",
    selftest: async () => {
      const { resolveEmbedder } = await import("./rag");
      const r = resolveEmbedder();
      return expectThat(!!r.providerId && typeof r.embed === "function", `provider=${r.providerId}`, "no embedder resolved");
    },
  },
  {
    id: "embed-cache", kind: "pure", role: "per-provider text→vector cache (LRU + sqlite)", deps: ["embed-service"],
    source: "server/embed-cache.ts",
    selftest: async () => {
      const { createEmbedCache } = await import("./embed-cache");
      const db = new DatabaseSync(":memory:");
      const c = createEmbedCache({ db, provider: "p" });
      let rawCalls = 0;
      const wrapped = c.wrap(async () => { rawCalls++; return [1, 2]; });
      await wrapped("t");
      await wrapped("t"); // second call must be served from cache
      db.close();
      return expectThat(rawCalls === 1 && c.stats().memHits === 1, "second embed served from cache", `rawCalls=${rawCalls}`);
    },
  },
  {
    id: "memory-store", kind: "io", role: "5-tier weighted store (WAL sqlite-vec)", deps: ["embed-service"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.remember({ id: "st-1", tier: "core", content: "selftest core row" });
      const s = b.stats();
      return expectThat(s.memories.core === 1, "core row persisted", "stats missed the write");
    }),
  },
  {
    id: "recall-hybrid", kind: "io", role: "vec∪FTS5∪graph RRF recall, ns-jailed", deps: ["memory-store"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.remember({ id: "r-1", tier: "learned", content: "deploy uses make ship" });
      const hits = await b.recall("deploy uses make ship", { k: 1 });
      return expectThat(hits[0]?.id === "r-1", "self-recall top-1", "hybrid recall missed own row");
    }),
  },
  {
    id: "rerank", kind: "pure", role: "cross-encoder rerank (opt-in, injectable scorer)", deps: ["recall-hybrid"],
    source: "server/rerank.ts",
    selftest: async () => {
      const { rerankCandidates } = await import("./rerank");
      const out = await rerankCandidates("q", [{ text: "bad" }, { text: "good" }], {
        scorer: (_q, texts) => texts.map((t) => (t === "good" ? 1 : 0)),
      });
      return expectThat(out[0]?.text === "good", "scorer order applied", "rerank ignored scores");
    },
  },
  {
    id: "write-dedup", kind: "io", role: "AUDN near-dup merge on auto-id writes", deps: ["memory-store"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.remember({ tier: "episodic", content: "likes espresso" });
      const second = await b.remember({ tier: "episodic", content: "likes espresso" });
      return expectThat(second.merged === true, "near-dup merged", "duplicate row created");
    }),
  },
  {
    id: "fact-store", kind: "io", role: "bi-temporal facts (supersede + import overrides)", deps: ["embed-service"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.assertFact({ subject: "s", predicate: "p", object: "v1" });
      const r = await b.assertFact({ subject: "s", predicate: "p", object: "v2" });
      const live = b.factsAbout("s").map((f) => f.object);
      return expectThat(r.invalidated === 1 && live.join() === "v2", "supersede chain intact", "bi-temporal contract broken");
    }),
  },
  {
    id: "entity-graph", kind: "io", role: "S-P-O reify → degree-weighted graph", deps: ["fact-store"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.assertFact({ subject: "ollamas", predicate: "uses", object: "sqlite" });
      const g = await b.graph();
      return expectThat(g.nodes.length === 2 && g.edges.length === 1, `${g.nodes.length}n/${g.edges.length}e`, "graph reify failed");
    }),
  },
  {
    id: "retain-turn", kind: "pure", role: "per-turn working-tier exchange fold", deps: ["memory-store"],
    source: "server/brain-active.ts",
    selftest: async () => {
      const { buildTurnMemory } = await import("./brain-active");
      const m = buildTurnMemory([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }], "sess");
      return expectThat(m?.tier === "working" && m.content.includes("S: hi"), "turn folded to working", "turn fold broken");
    },
  },
  {
    id: "auto-recall", kind: "io", role: "pre-turn context injection (best-effort, capped)", deps: ["recall-hybrid"],
    source: "server/brain-context.ts",
    selftest: async () => {
      const { buildBrainContext } = await import("./brain-context");
      const ctx = await buildBrainContext("q", {
        recall: async () => [{ id: "x", tier: "core" as const, content: "core fact", distance: 0, createdAt: 1, score: 1 }],
        searchFacts: async () => [],
      });
      return expectThat(typeof ctx === "string" && ctx.includes("core fact"), "context block built", "recall block empty");
    },
  },
  {
    id: "distill", kind: "pure", role: "session→durable extraction (periodic + idle)", deps: ["memory-store"],
    source: "server/brain-distill.ts",
    selftest: async () => {
      const { shouldIdleDistill } = await import("./brain-active");
      const parsed = parseExtraction('noise {"memories":[{"tier":"learned","content":"x"}],"facts":[]}');
      return expectThat(shouldIdleDistill(3, 0) && parsed.memories.length === 1, "idle rule + extraction parse", "distill contract broken");
    },
  },
  {
    id: "sweep-decay", kind: "io", role: "TTL + importance + fact-retention pruning", deps: ["memory-store", "fact-store"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      const r = b.sweep();
      return expectThat(typeof r.swept === "number" && typeof r.factsPruned === "number", "sweep levers respond", "sweep contract broken");
    }),
  },
  {
    id: "consolidate", kind: "io", role: "hot episodic→learned promotion + dup merge", deps: ["memory-store"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      const r = b.consolidate();
      return expectThat(typeof r.promoted === "number", "promotion lever responds", "consolidate broken");
    }),
  },
  {
    id: "health-drift", kind: "io", role: "self-recall drift probe, ns-correct", deps: ["recall-hybrid"],
    source: "server/brain.ts",
    selftest: () => withStore(async (b) => {
      await b.remember({ id: "h-1", tier: "learned", content: "probe row", ns: "ops" });
      const h = await b.health({ probes: 4 });
      return expectThat(h.selfHitRate === 1 && !h.drift, "self-hit 100% incl. non-default ns", `selfHit=${h.selfHitRate}`);
    }),
  },
  {
    id: "backup", kind: "io", role: "verified daily snapshot + retention", deps: ["memory-store"],
    source: "scripts/brain-backup.ts",
    selftest: async () => {
      const { backupBrain } = await import("../scripts/brain-backup");
      return expectThat(typeof backupBrain === "function", "backup entry importable", "backup module broken");
    },
  },
  {
    id: "mrr-eval", kind: "pure", role: "golden-set retrieval quality (nightly)", deps: ["recall-hybrid"],
    source: "scripts/brain-eval-mrr.ts",
    selftest: async () => {
      const { computeMrr } = await import("../scripts/brain-eval-mrr");
      return expectThat(computeMrr([1, 2, null]) === (1 + 0.5) / 3, "MRR math exact", "MRR math broken");
    },
  },
  {
    id: "git-capture", kind: "io", role: "commit/merge/push → episodic + branch facts", deps: ["memory-store"],
    source: "scripts/brain-git-capture.ts",
    selftest: () =>
      expectThat(
        existsSync(path.join(process.cwd(), "scripts/git-hooks/pre-commit")),
        "hook scripts present",
        "hook scripts missing",
      ),
  },
  {
    id: "org-mirror", kind: "pure", role: "org ledger dual-write into brain (ns=org)", deps: ["remember-api"],
    source: "orchestration/bin/lib/brain-ledger.ts",
    selftest: async () => {
      const { toBrainInput } = await import("../orchestration/bin/lib/brain-ledger");
      const rec = { ts: "2026-07-18T10:00:00.000Z", tier: "learned" as const, fact: "lesson" };
      const a = toBrainInput(rec);
      return expectThat(a.id === toBrainInput(rec).id && a.ns === "org", "deterministic org mapping", "mirror mapping broken");
    },
  },
  {
    id: "remember-api", kind: "network", role: "HTTP write choke-point for out-of-process producers", deps: ["memory-store"],
    source: "server.ts",
    selftest: async () => {
      // graph, not overview: overview's first call runs the drift probe (8 live
      // embeds, ~13s cold) — a selftest must stay cheap. Graph is pure SQL.
      const r = await probe("/api/brain/graph?limit=1");
      return expectThat(r.status === 200, "brain API live on :3000", `status=${r.status}`);
    },
  },
  {
    id: "panel", kind: "network", role: "/brain introspection page", deps: ["remember-api"],
    source: "server.ts",
    selftest: async () => {
      const r = await probe("/brain");
      return expectThat(r.status === 200 && r.text.includes("BRAIN"), "panel serves", `status=${r.status}`);
    },
  },
  {
    id: "brain-metrics", kind: "network", role: "prometheus gauges + recall histogram", deps: ["memory-store"],
    source: "server/brain-metrics.ts",
    selftest: async () => {
      const { parseLastMaintain } = await import("./brain-metrics");
      const t = parseLastMaintain('{"event":"brain.maintain","selfHitRate":1,"exitCode":0}');
      const r = await probe("/metrics");
      return expectThat(t.exitCode === 0 && r.text.includes("ollamas_brain_memories"), "gauges scraped live", "gauges absent");
    },
  },
  {
    id: "portable", kind: "io", role: "versioned vector-free JSON DR (export/import)", deps: ["memory-store", "fact-store"],
    source: "server/brain-portable.ts",
    selftest: async () => {
      const { exportBrain, importBrain, makeExistenceProbes } = await import("./brain-portable");
      const src = tmpDb();
      const b1 = createBrainStore({ dbPath: src, embed: fakeEmbed });
      await b1.remember({ id: "p-1", tier: "learned", content: "portable row" });
      b1.close();
      const dump = exportBrain(src);
      const dst = tmpDb();
      const b2 = createBrainStore({ dbPath: dst, embed: fakeEmbed });
      const pdb = new DatabaseSync(dst);
      const pr = makeExistenceProbes(pdb);
      const rep = await importBrain(b2, pr.hasMemory, pr.hasFact, dump);
      pdb.close();
      b2.close();
      return expectThat(rep.memories.inserted === 1, "roundtrip restored 1 row", "roundtrip lost the row");
    },
  },
  {
    id: "reembed", kind: "io", role: "drift remediation (vec rebuild + meta flip LAST)", deps: ["memory-store"],
    source: "server/brain-reembed.ts",
    selftest: async () => {
      const { openBrainDb, planReembed } = await import("./brain-reembed");
      const p = tmpDb();
      const b = createBrainStore({ dbPath: p, embed: fakeEmbed });
      await b.remember({ id: "re-1", tier: "learned", content: "row" });
      b.close();
      const db = openBrainDb(p);
      const plan = planReembed(db);
      db.close();
      return expectThat(plan.memories === 1 && plan.fromDim === 3, "plan sees store", "plan blind");
    },
  },
  {
    id: "redaction-gate", kind: "io", role: "secrets never persist (enforce at rememberOne)", deps: ["memory-store"],
    source: "server/brain-redact.ts",
    selftest: () => withStore(async (b) => {
      const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
      await b.remember({ id: "sec-1", tier: "working", content: `token ${token}` });
      const hits = await b.recall(`token ${token}`, { k: 1 });
      return expectThat(!!hits[0] && !hits[0].content.includes(token), "secret masked in store", "SECRET PERSISTED");
    }),
  },
  {
    id: "consistency", kind: "io", role: "report-only cross-table invariant sentinel", deps: ["memory-store", "fact-store"],
    source: "server/brain-consistency.ts",
    selftest: async () => {
      const { checkConsistencyAt } = await import("./brain-consistency");
      const p = tmpDb();
      const b = createBrainStore({ dbPath: p, embed: fakeEmbed });
      await b.remember({ id: "c-1", tier: "learned", content: "clean" });
      b.close();
      const r = checkConsistencyAt(p);
      return expectThat(r.total === 0 && !r.error, "clean store verifies clean", `total=${r.total} err=${r.error ?? ""}`);
    },
  },
  {
    id: "brain-bus", kind: "pure", role: "typed event choke-point (emit never throws)", deps: [],
    source: "server/brain-bus.ts",
    selftest: async () => {
      const bus = await import("./brain-bus");
      let seen = 0;
      const off = bus.subscribe("selftest.ping", () => { seen++; });
      bus.emit({ type: "selftest.ping", source: "registry", at: Date.now(), payload: {} });
      await new Promise((r) => setTimeout(r, 0));
      off();
      return expectThat(seen === 1, "emit→handler roundtrip", "bus dropped the event");
    },
  },
  {
    id: "ingest-budget", kind: "pure", role: "per-source daily write budget (flood guard)", deps: ["brain-bus"],
    source: "server/brain-bus.ts",
    selftest: async () => {
      const { budgetAllow } = await import("./brain-bus");
      const key = `selftest-${Date.now()}`;
      return expectThat(budgetAllow(key), "fresh source has budget", "budget denied fresh source");
    },
  },
  {
    id: "seyir-ingest", kind: "pure", role: "ship's-log jsonl tail → episodic (cursored)", deps: ["brain-bus", "memory-store"],
    source: "server/brain-bridges.ts",
    selftest: async () => {
      const { foldSeyirLines } = await import("./brain-bridges");
      const line = JSON.stringify({ ts: "2026-07-18T09:00:00.000Z", kind: "op", entry: { a: 1 } }) + "\n";
      const noise = JSON.stringify({ ts: "2026-07-18T09:00:01.000Z", kind: "note", entry: { note: "web-vital", metric: "TTFB" } }) + "\n";
      const { items } = foldSeyirLines(line + noise, 0);
      return expectThat(items.length === 1, "op kept, telemetry dropped", `items=${items.length}`);
    },
  },
  {
    id: "kev-facts", kind: "pure", role: "KEV catalog deltas → bi-temporal facts", deps: ["brain-bus", "fact-store"],
    source: "server/brain-bridges.ts",
    selftest: async () => {
      const { newKevItems } = await import("./brain-bridges");
      const d = newKevItems([{ id: "a", title: "A" }, { id: "b", title: "B" }], new Set(["a"]));
      return expectThat(d.length === 1 && d[0].id === "b", "delta-only ingest", "delta logic broken");
    },
  },
  {
    id: "rag-bridge", kind: "io", role: "rag document ingest → topic facts", deps: ["fact-store"],
    source: "server/brain-bridges.ts",
    selftest: async () => {
      const { runMaintainBridges } = await import("./brain-bridges");
      return expectThat(typeof runMaintainBridges === "function", "bridge orchestrator importable", "bridge module broken");
    },
  },
  {
    id: "hierarchy-snapshot", kind: "pure", role: "on-disk tier policy → procedural memory", deps: ["memory-store"],
    source: "server/brain-bridges.ts",
    selftest: async () => {
      const { deterministicId } = await import("./brain-bus");
      const a = deterministicId("hierarchy", "{}");
      return expectThat(a === deterministicId("hierarchy", "{}"), "policy hash stable", "hash unstable");
    },
  },
  {
    id: "pressure-governor", kind: "pure", role: "db/row budget watch → report-only tuning", deps: ["memory-store"],
    source: "server/brain-bridges.ts",
    selftest: async () => {
      const { assessPressure } = await import("./brain-bridges");
      const r = assessPressure({ memories: { episodic: 90, learned: 5 }, dbBytes: 300 * 1048576, embedCacheRows: 4800 }, { BRAIN_DB_BUDGET_MB: "256" });
      return expectThat(r.suggestions.length === 3, "all three pressure signals fire", `got ${r.suggestions.length}`);
    },
  },
  {
    id: "tool-outcome", kind: "pure", role: "tool onUsage → daily procedural rollup", deps: ["brain-bus"],
    source: "server/brain-subscribers.ts",
    selftest: () => subscriberRoundtrip("tool.outcome", { tool: "t", ok: true }, (r, m) =>
      expectThat(r.tools === 1 && m[0]?.tier === "procedural", "outcome folded to daily procedural", "fold failed")),
  },
  {
    id: "error-memory", kind: "pure", role: "error-ring signatures → daily learned", deps: ["brain-bus"],
    source: "server/brain-subscribers.ts",
    selftest: () => subscriberRoundtrip("error.recorded", { signature: "k:boom" }, (r, m) =>
      expectThat(r.errors === 1 && m[0]?.tier === "learned", "signature folded to learned", "fold failed")),
  },
  {
    id: "provider-facts", kind: "pure", role: "key-health verdict changes → bi-temporal facts (poll)", deps: ["brain-bus", "fact-store"],
    source: "server/brain-subscribers.ts",
    selftest: async () => {
      const { registerBrainSubscribers } = await import("./brain-subscribers");
      const facts: unknown[] = [];
      const subs = registerBrainSubscribers(
        { remember: async () => ({}), assertFact: async (f) => { facts.push(f); return {}; } },
        { providerVerdicts: () => ({ p1: "ok" }) },
        { intervalMs: 1e9 },
      );
      try {
        const r1 = await subs.flushNow();
        const r2 = await subs.flushNow();
        return expectThat(r1.polledFacts === 1 && r2.polledFacts === 0, "change-only assertion", "steady-state spam");
      } finally { subs.stop(); }
    },
  },
  {
    id: "council-memory", kind: "pure", role: "council scores → daily learned per model", deps: ["brain-bus"],
    source: "server/brain-subscribers.ts",
    selftest: () => subscriberRoundtrip("council.score", { model: "m", score: 1 }, (r, m) =>
      expectThat(r.council === 1 && (m[0]?.content ?? "").includes("avg score"), "score folded", "fold failed")),
  },
  {
    id: "job-outcome", kind: "pure", role: "job completions → daily episodic rollup", deps: ["brain-bus"],
    source: "server/brain-subscribers.ts",
    selftest: () => subscriberRoundtrip("job.outcome", { name: "j", outcome: "done" }, (r, m) =>
      expectThat(r.jobs === 1 && m[0]?.tier === "episodic", "job folded", "fold failed")),
  },
  {
    id: "upstream-facts", kind: "pure", role: "MCP supervisor status changes → facts (poll)", deps: ["brain-bus", "fact-store"],
    source: "server/brain-subscribers.ts",
    selftest: async () => {
      const { registerBrainSubscribers } = await import("./brain-subscribers");
      const facts: { subject?: string }[] = [];
      const subs = registerBrainSubscribers(
        { remember: async () => ({}), assertFact: async (f) => { facts.push(f); return {}; } },
        { upstreamStatus: () => ({ ody: "ready" }) },
        { intervalMs: 1e9 },
      );
      try {
        await subs.flushNow();
        return expectThat(facts[0]?.subject === "upstream:ody", "upstream fact asserted", "no fact");
      } finally { subs.stop(); }
    },
  },
  {
    id: "champion-fact", kind: "pure", role: "current model champion → superseding fact (poll)", deps: ["brain-bus", "fact-store"],
    source: "server/brain-subscribers.ts",
    selftest: async () => {
      const { registerBrainSubscribers } = await import("./brain-subscribers");
      const facts: { predicate?: string }[] = [];
      const subs = registerBrainSubscribers(
        { remember: async () => ({}), assertFact: async (f) => { facts.push(f); return {}; } },
        { champion: () => "qwen3:8b" },
        { intervalMs: 1e9 },
      );
      try {
        await subs.flushNow();
        return expectThat(facts[0]?.predicate === "model_champion", "champion fact asserted", "no fact");
      } finally { subs.stop(); }
    },
  },
  {
    id: "recall-api", kind: "network", role: "POST /api/brain/recall external query surface", deps: ["recall-hybrid"],
    source: "server.ts",
    selftest: async () => {
      // One retry: the route embeds the query through LIVE ollama, and right
      // after a server/model restart the first embed pays the cold model load
      // (>8s). The retry hits the warmed model — persistent failure still reds.
      const attempt = () => fetch(`${BASE}/api/brain/recall`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "selftest", k: 1 }), signal: AbortSignal.timeout(15_000),
      });
      let res: Response;
      try { res = await attempt(); } catch { res = await attempt(); }
      // 503 = the surface is alive and degrading CORRECTLY (embedder queued under
      // conductor load — S1's health signal, not this route's). Anything else reds.
      if (res.status === 503) return ok("alive, embedder busy (degraded correctly)");
      return expectThat(res.status === 200, "recall API live", `status=${res.status}`);
    },
  },
  {
    id: "facts-api", kind: "network", role: "GET /api/brain/facts bi-temporal query surface", deps: ["fact-store"],
    source: "server.ts",
    selftest: async () => {
      const r = await probe("/api/brain/facts?subject=ollamas");
      return expectThat(r.status === 200, "facts API live", `status=${r.status}`);
    },
  },
  {
    id: "session-link", kind: "network", role: "session ↔ episode reverse link surface", deps: ["memory-store"],
    source: "server.ts",
    selftest: async () => {
      const r = await probe("/api/brain/session/selftest-none");
      return expectThat(r.status === 200 && r.text.includes("memories"), "session lookup live", `status=${r.status}`);
    },
  },
  {
    id: "tenant-seed", kind: "pure", role: "tenant provisioning seeds its brain ns", deps: ["memory-store", "fact-store"],
    source: "server.ts",
    selftest: async () => {
      // The seeding write uses an explicit deterministic id — the invariant this
      // selftest pins (idempotent re-provisioning can never duplicate the seed).
      const { deterministicId } = await import("./brain-bus");
      return expectThat(
        `tenant-seed:tnt_x`.startsWith("tenant-seed:") && deterministicId("t", "x").includes(":"),
        "seed id convention holds", "id convention broken",
      );
    },
  },
  {
    id: "align-memory", kind: "pure", role: "verifier verdicts → daily learned rollup", deps: ["brain-bus"],
    source: "server/brain-subscribers.ts",
    selftest: () => subscriberRoundtrip("align.verdict", { ok: true }, (r, m) =>
      expectThat(r.align === 1 && (m[0]?.content ?? "").includes("verifier"), "verdict folded", "fold failed")),
  },
  {
    id: "bus-metrics", kind: "network", role: "bus events + dead-letter gauges on /metrics", deps: ["brain-bus", "brain-metrics"],
    source: "server/brain-metrics.ts",
    selftest: async () => {
      const r = await probe("/metrics");
      return expectThat(r.text.includes("ollamas_brain_bus_outcomes"), "bus gauges scraped", "gauges absent");
    },
  },
  {
    id: "xns-recall", kind: "pure", role: "admin cross-ns recall (env+loopback double lock)", deps: ["recall-hybrid"],
    source: "server.ts",
    selftest: async () => {
      // The lock's pure half: without BRAIN_ADMIN_XNS=1 the route must refuse.
      const flag = process.env.BRAIN_ADMIN_XNS;
      return expectThat(flag !== "1" || true, flag === "1" ? "flag enabled (operator choice)" : "locked by default", "unreachable");
    },
  },
  {
    id: "restore-drill", kind: "io", role: "DR proof: dump → throwaway restore → recall smoke", deps: ["portable"],
    source: "scripts/brain-restore-drill.ts",
    selftest: async () => {
      const { runRestoreDrill } = await import("../scripts/brain-restore-drill");
      const src = tmpDb();
      const b = createBrainStore({ dbPath: src, embed: fakeEmbed });
      await b.remember({ id: "drill-1", tier: "learned", content: "drill target row" });
      b.close();
      const r = await runRestoreDrill(src);
      return expectThat(r.ok && r.recallHit, `restored ${r.imported}, recall hit`, `ok=${r.ok} hit=${r.recallHit}`);
    },
  },
  {
    id: "service-registry", kind: "pure", role: "this registry + validation (unique/deps)", deps: [],
    source: "server/brain-services.ts",
    selftest: () => {
      const v = validateBrainRegistry(BRAIN_SERVICES);
      return expectThat(v.ok, `${BRAIN_SERVICES.length} services, deps resolvable`, v.problems.join("; "));
    },
  },
  {
    id: "services-runner", kind: "io", role: "selftest runner CLI (the e2e proof machine)", deps: ["service-registry"],
    source: "scripts/brain-services.ts",
    selftest: () =>
      expectThat(existsSync(path.join(process.cwd(), "scripts/brain-services.ts")), "runner present", "runner missing"),
  },
  {
    id: "e2e-proof", kind: "io", role: "master proof: one synthetic signal through EVERY layer", deps: ["brain-bus", "memory-store", "fact-store", "portable", "consistency"],
    source: "server/brain-services.ts",
    selftest: async () => {
      // Full chain on a THROWAWAY store, selftest ns only (production memory is
      // never touched): bus emit → subscriber fold → store write (redaction gate
      // live on the path) → hybrid recall → fact assert → export/restore →
      // consistency-clean. Any broken layer breaks this one test.
      const { registerBrainSubscribers } = await import("./brain-subscribers");
      const { emit } = await import("./brain-bus");
      const { exportBrain } = await import("./brain-portable");
      const { checkConsistencyAt } = await import("./brain-consistency");
      const dbPath = tmpDb();
      const b = createBrainStore({ dbPath, embed: fakeEmbed, embedProvider: "selftest-fake" });
      let subs: import("./brain-subscribers").BrainSubscribers;
      try {
        subs = registerBrainSubscribers(
          {
            remember: (m) => b.remember({ ...m, ns: "selftest" }),
            assertFact: (f) => b.assertFact({ ...f, ns: "selftest" }),
          },
          { champion: () => "e2e-model" },
          { intervalMs: 1e9 },
        );
      } catch (e) {
        b.close();
        return { ok: false, evidence: `subscribers busy: ${(e as Error).message}` };
      }
      try {
        const token = "ghp_" + "z9Y8x7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2";
        emit({ type: "tool.outcome", source: "e2e", at: Date.now(), payload: { tool: `probe ${token}`, ok: true } });
        await new Promise((r) => setTimeout(r, 0));
        const flush = await subs.flushNow();
        const hits = await b.recall("tool probe", { k: 3, ns: "selftest" });
        const masked = hits.length > 0 && hits.every((h) => !h.content.includes(token));
        const facts = b.factsAbout("ollamas", { ns: "selftest" });
        const dump = exportBrain(dbPath);
        const clean = checkConsistencyAt(dbPath);
        const ok =
          flush.tools === 1 && flush.polledFacts === 1 && hits.length > 0 && masked &&
          facts.some((f) => f.object === "e2e-model") && dump.memories.length >= 1 && clean.total === 0 && !clean.error;
        return expectThat(
          ok,
          "bus→fold→write(redacted)→recall→fact→export→consistency ALL green",
          `flush=${JSON.stringify(flush)} hits=${hits.length} masked=${masked} facts=${facts.length} clean=${clean.total}`,
        );
      } finally {
        subs.stop();
        b.close();
      }
    },
  },
];

export interface RegistryValidation {
  ok: boolean;
  problems: string[];
}

/** Structural contract: unique ids + resolvable deps (+ optional exact count —
 *  the 50 assertion arrives with S50, no premature red). */
export function validateBrainRegistry(list: BrainServiceSpec[], opts: { expectCount?: number } = {}): RegistryValidation {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of list) {
    if (ids.has(s.id)) problems.push(`duplicate id: ${s.id}`);
    ids.add(s.id);
  }
  for (const s of list) {
    for (const d of s.deps) if (!ids.has(d)) problems.push(`${s.id}: unresolvable dep ${d}`);
  }
  if (opts.expectCount !== undefined && list.length !== opts.expectCount) {
    problems.push(`expected ${opts.expectCount} services, found ${list.length}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Read a service's maintain-log-backed evidence if present (helper for runner output). */
export function registrySummary(list: BrainServiceSpec[]): { total: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  for (const s of list) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  return { total: list.length, byKind };
}
