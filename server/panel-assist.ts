/**
 * server/panel-assist.ts — eCym control plane (v12).
 *
 * eCym (ecy:latest) governs 5 specialist personas, one per existing panel. It is a
 * DETERMINISTIC panel→specialist binding (not an LLM router — routing would waste a
 * full generate on the single GPU to re-derive a route already known from the panel
 * id). "Control" = owns the registry, the distilled knowledge briefs, persona
 * preservation, and a FIFO GPU mutex that serializes overlapping panel streams.
 *
 * Runtime uses ONE warm base (ecy:latest) + a per-panel SYSTEM brief injected via
 * ai.ts AiOptions.system — zero model-reload thrash on a single warm slot. The brief
 * is distilled from real sources ($0-local SearXNG→DDG via research.ts searchWeb) and
 * cached in db.data.panelBriefs; absent a distilled brief, a hardcoded fallback keeps
 * every panel useful (never blocks). A baked `ecy-<panel>:latest` tag is the opt-in
 * "bake" path (server/ecym.ts distillSpecialist), not required at runtime.
 */
import type { Request, Response } from "express";
import { generateTextStream, generateText, type AiOptions } from "./ai";
import { searchWeb, type Source } from "./research";
import { distillEcym } from "./ecym";

export const PANEL_IDS = ["search", "github-actions", "integrations", "threatintel", "keys"] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export function isPanelId(x: string): x is PanelId {
  return (PANEL_IDS as readonly string[]).includes(x);
}

/** The base model every virtual specialist runs on (persona injected per request). */
export const ECY_BASE = "ecy:latest";

export interface PanelBriefSpec {
  /** One-line specialist role — always in the system prompt. */
  role: string;
  /** Minimal hardcoded domain brief; serves until a distilled brief exists. */
  fallback: string;
  /** Search queries the distiller runs to refresh this specialist's brief. */
  queries: string[];
}

// Compact, genuinely-useful domain briefs. Each is a fallback that a distill run
// can later overwrite with fresher, source-grounded knowledge.
export const PANEL_BRIEFS: Record<PanelId, PanelBriefSpec> = {
  search: {
    role: "You are eCy-Search, a GitHub adoption analyst for the ollamas project.",
    fallback:
      "Rank repositories by adopt-fit for a self-hosted $0-local Node/TS AI workspace. Weigh: recent maintenance (commits, releases), permissive license (MIT/Apache-2 > GPL for embedding), dependency health, and fit to ollamas' local-first ethos. Flag abandoned repos, restrictive licenses, and heavy/native deps. Be concrete and cite the repo by full_name.",
    queries: ["github repository health maintenance signals", "open source license compatibility for embedding", "npm supply chain adoption risk criteria"],
  },
  "github-actions": {
    role: "You are eCy-Actions, a CI/CD diagnostician for GitHub Actions.",
    fallback:
      "Diagnose a failed workflow run from its job/step logs. Identify the root-cause step, quote the failing log line, and give a concrete fix (config change, cache key, dependency pin, permissions). Distinguish flaky (retry) from deterministic failures. Reference actions/cache, setup-node, and runner limits when relevant.",
    queries: ["github actions workflow syntax reference", "common github actions CI failure taxonomy", "actions/cache setup-node runner errors fixes"],
  },
  integrations: {
    role: "You are eCy-Integrations, a connector triage specialist.",
    fallback:
      "Triage an integration health matrix worst-first. For each degraded/needs-setup row use its fix/purpose/lane to produce an ordered, step-by-step remediation the operator can follow. Prefer $0-local, zero-paste flows (gh CLI autoconnect, npx/uvx MCP servers). Be explicit about which step unblocks which capability.",
    queries: ["OAuth PAT setup troubleshooting", "MCP server install npx uvx configuration", "github cli gh auth token flow"],
  },
  threatintel: {
    role: "You are eCy-Threat, a threat-intelligence analyst.",
    fallback:
      "Severity-score and correlate security feed items (CISA KEV, advisories, vendor blogs). Group items about the same CVE or actor, add CVSS v3.1 context, and flag KEV/known-exploited entries as top priority. Output a prioritized, actionable list — most urgent first — with a one-line 'why it matters'.",
    queries: ["CVSS v3.1 scoring guide", "CISA known exploited vulnerabilities catalog", "MITRE ATT&CK tactics basics"],
  },
  keys: {
    role: "You are eCy-Vault, an API-key hygiene advisor.",
    fallback:
      "Advise on key hygiene and rotation from MASKED metadata ONLY (provider, source, status, age) — you never see or need the secret values. Recommend rotation for stale/unverified keys, deduplicate providers, and order actions by risk. Reference typical provider key prefixes only as recognition hints, never request or echo a value.",
    queries: ["API key rotation best practices", "cloud provider api key formats prefixes", "secret management hygiene guidance"],
  },
};

const MAX_CONTEXT_CHARS = 8000;
const MAX_BRIEF_CHARS = 3200; // ~800 tokens

/** Pure: assemble the specialist system prompt + the task prompt from panel metadata. */
export function buildAssistPrompt(panelId: PanelId, contextText: string, brief: string): { system: string; prompt: string } {
  const spec = PANEL_BRIEFS[panelId];
  const guard =
    panelId === "keys"
      ? "\n\nHARD RULE: You operate on masked metadata only. NEVER ask for, infer, or echo an actual key value — reason about provider/status/age only."
      : "";
  const system = `${spec.role}\n\n${brief}${guard}\n\nAnswer definitively and concretely. Do not hedge. If information is insufficient, say exactly what is missing.`;
  const prompt = `Here is the current ${panelId} panel state (metadata):\n\n${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\nGive your specialist analysis.`;
  return { system, prompt };
}

interface PanelBriefStore { brief: string; ts: string; sources: string[] }
// Structural (no index signature) so the real SecureDB (DBConfig.panelBriefs?) assigns cleanly.
interface DBLike {
  data: {
    panelBriefs?: Record<string, PanelBriefStore>;
    ecymSpecialists?: Record<string, { model?: string }>;
  };
  save: () => void;
}

// v12 hybrid "bake": each panel's literal specialist tag (shares ecy's base blob).
export const SPECIALIST_TAG: Record<PanelId, string> = {
  search: "ecy-github:latest",
  "github-actions": "ecy-actions:latest",
  integrations: "ecy-integrations:latest",
  threatintel: "ecy-threat:latest",
  keys: "ecy-vault:latest",
};

/** The persona baked into a specialist tag = role + current (distilled or fallback) brief. */
export function buildSpecialistIdentity(db: DBLike, panelId: PanelId): string {
  return `${PANEL_BRIEFS[panelId].role}\n\n${resolveBrief(db, panelId)}`;
}

/** Runtime model for a panel: the baked tag once registered, else the shared warm base. */
export function panelModel(db: DBLike, panelId: PanelId): string {
  return db.data.ecymSpecialists?.[panelId]?.model || ECY_BASE;
}

/** Read the distilled brief for a panel, or the hardcoded fallback (never empty). */
export function resolveBrief(db: DBLike, panelId: PanelId): string {
  return db.data.panelBriefs?.[panelId]?.brief || PANEL_BRIEFS[panelId].fallback;
}

// ---- FIFO GPU mutex — serialize overlapping panel inference on the single slot ----
let gpuTail: Promise<unknown> = Promise.resolve();
export function withGpu<T>(job: () => Promise<T>): Promise<T> {
  const run = gpuTail.then(job, job);
  gpuTail = run.then(() => undefined, () => undefined);
  return run;
}

export interface AssistDeps {
  stream?: (prompt: string, opts?: AiOptions) => AsyncGenerator<string>;
  compress?: (prompt: string, opts?: AiOptions) => Promise<string>;
  search?: (query: string) => Promise<Source[]>;
}

/** Stream the panel specialist's answer (GPU-serialized). */
export async function* assistStream(db: DBLike, panelId: PanelId, contextText: string, deps: AssistDeps = {}): AsyncGenerator<string> {
  const stream = deps.stream ?? generateTextStream;
  const brief = resolveBrief(db, panelId);
  const { system, prompt } = buildAssistPrompt(panelId, contextText, brief);
  // Baked specialist tag once registered (hybrid), else the shared warm base.
  const model = panelModel(db, panelId);
  // Serialize the whole stream behind the mutex so panels queue rather than thrash.
  const gen = await withGpu(async () => stream(prompt, { model, system, temperature: 0.3 }));
  for await (const chunk of gen) yield chunk;
}

export interface DistillEvent { stage: "plan" | "search" | "compress" | "done" | "error"; status: "running" | "done" | "fail"; text?: string; brief?: string }

/** Refresh a specialist's brief from real sources → compress → persist. Fail-soft. */
export async function* distillPanel(db: DBLike, panelId: PanelId, deps: AssistDeps = {}): AsyncGenerator<DistillEvent> {
  const search = deps.search ?? searchWeb;
  const compress = deps.compress ?? generateText;
  const spec = PANEL_BRIEFS[panelId];
  yield { stage: "plan", status: "running", text: `distilling ${panelId} from ${spec.queries.length} queries` };
  try {
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const q of spec.queries) {
      yield { stage: "search", status: "running", text: q };
      const hits = await search(q);
      for (const h of hits) {
        if (h.url && !seen.has(h.url)) { seen.add(h.url); sources.push(h); }
      }
    }
    if (sources.length === 0) {
      yield { stage: "error", status: "fail", text: "no sources found — keeping existing brief" };
      return;
    }
    yield { stage: "compress", status: "running", text: `${sources.length} sources` };
    const digest = sources.map((s) => `- ${s.title}: ${s.snippet}`).join("\n").slice(0, 6000);
    const brief = (
      await withGpu(() =>
        compress(
          `You are refreshing the knowledge brief for ${spec.role}\n\nSource notes:\n${digest}\n\nWrite a dense, factual ${MAX_BRIEF_CHARS}-char-max brief this specialist should always know. No preamble, just the knowledge.`,
          { model: ECY_BASE, temperature: 0.2 },
        ),
      )
    ).slice(0, MAX_BRIEF_CHARS);
    if (!brief.trim()) {
      yield { stage: "error", status: "fail", text: "empty distillation — keeping existing brief" };
      return;
    }
    db.data.panelBriefs = db.data.panelBriefs ?? {};
    db.data.panelBriefs[panelId] = { brief, ts: new Date().toISOString(), sources: sources.map((s) => s.url) };
    db.save();
    yield { stage: "done", status: "done", brief };
  } catch (err) {
    yield { stage: "error", status: "fail", text: (err as Error)?.message || "distill failed" };
  }
}

type Guard = (req: Request, res: Response, next: () => void) => void;

function sse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

export function registerPanelAssistRoutes(app: { get: Function; post: Function }, db: DBLike, guard: Guard): void {
  // Current brief (distilled or fallback) — lets the UI show provenance.
  app.get("/api/ecym/panel/:id/brief", guard, (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isPanelId(id)) { res.status(404).json({ error: "unknown panel" }); return; }
    const store = db.data.panelBriefs?.[id];
    res.json({ panelId: id, role: PANEL_BRIEFS[id].role, distilled: !!store, ts: store?.ts ?? null, brief: resolveBrief(db, id) });
  });

  // Specialist assist stream (SSE): { context } metadata → streamed analysis.
  app.post("/api/ecym/panel/:id", guard, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isPanelId(id)) { res.status(404).json({ error: "unknown panel" }); return; }
    const contextText = String((req.body as { context?: unknown })?.context ?? "");
    sse(res);
    try {
      for await (const chunk of assistStream(db, id, contextText)) res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: (err as Error)?.message || "assist failed" })}\n\n`);
      res.end();
    }
  });

  // Re-distill a specialist's brief from fresh sources (SSE).
  app.post("/api/ecym/panel/:id/distill", guard, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isPanelId(id)) { res.status(404).json({ error: "unknown panel" }); return; }
    sse(res);
    try {
      for await (const ev of distillPanel(db, id)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ stage: "error", status: "fail", text: (err as Error)?.message || "distill failed" })}\n\n`);
      res.end();
    }
  });

  // Hybrid "bake": materialize a real ecy-<panel>:latest tag from the current brief
  // (persona = role + brief) via the whitelisted ecym create path, then bind it in the
  // registry so future assist calls run the baked specialist. GPU/disk write → Emre-gated.
  app.post("/api/ecym/panel/:id/bake", guard, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isPanelId(id)) { res.status(404).json({ error: "unknown panel" }); return; }
    const tag = SPECIALIST_TAG[id];
    const identity = buildSpecialistIdentity(db, id);
    sse(res);
    try {
      let created = false;
      for await (const ev of distillEcym(db as unknown as Parameters<typeof distillEcym>[0], tag, { identity })) {
        if (ev.stage === "done") created = true; // create succeeded (probe may still be soft-fail on GPU contention)
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
      if (created) {
        db.data.ecymSpecialists = db.data.ecymSpecialists ?? {};
        db.data.ecymSpecialists[id] = { model: tag };
        db.save();
        res.write(`data: ${JSON.stringify({ stage: "registered", status: "done", text: `${id} → ${tag}` })}\n\n`);
      }
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ stage: "error", status: "fail", text: (err as Error)?.message || "bake failed" })}\n\n`);
      res.end();
    }
  });
}
