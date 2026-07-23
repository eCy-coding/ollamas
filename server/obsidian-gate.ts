// Mandatory SOFT Obsidian gate — touches the vault before every real operation.
//
// WHY: until now only the orchestra task board (`orchestra-tasks.ts` planTask()) prepended a
// vault step. Every other operation surface — chat/agent/pipeline inference, terminal exec,
// file read/write — ran without ever consulting or recording into the vault. eCym reaches
// ollamas exclusively through `/v1/chat/completions`, so gating that one route also covers
// eCym for free.
//
// SOFT means: attempt a vault READ (recall context) and a vault WRITE (an operation-record
// note) before the operation proceeds, but NEVER let an unreachable Obsidian block the
// request. A closed vault is normal (it's a desktop app); the gate degrades to a logged
// "miss" and the caller proceeds exactly as if the gate did not exist.
//
// This module is pure-where-possible: `deriveOperation`, `slugify`, `opNotePath`, and
// `opNoteBody` are plain functions with no IO, so they're unit-testable without mocking
// anything. Only `obsidianGate` touches the network, via the existing `vaultWrite` /
// `obsidianContribute` helpers (server/obsidian-rest.ts, server/orchestra-roles.ts) — both of
// which already degrade honestly (return false/ok:false, never throw) when Obsidian is closed.
import { vaultWrite } from "./obsidian-rest";
import { obsidianContribute, type VaultFinding } from "./orchestra-roles";

export interface GatedOperation {
  kind: "llm" | "terminal" | "file";
  summary: string;
  detail?: string;
}

/**
 * Route → operation-kind table, shared by `deriveOperation` and its tests so the mapping has
 * one home. Matched by prefix against `req.path` (the middleware mounts on these exact
 * prefixes, so an exact-or-prefix match both work — prefix is more forgiving of trailing
 * segments like `/api/workspace/file/:id`).
 */
const LLM_ROUTES = [
  "/api/generate",
  "/api/ai/generate",
  "/api/agent/chat",
  "/api/pipeline",
  "/v1/chat/completions",
  "/api/brain/ask-shared",
  "/api/brain/ask",
];
const TERMINAL_ROUTES = ["/api/terminal"];
const FILE_ROUTES = ["/api/workspace/file", "/api/workspace/upload", "/api/workspace/download"];

function matchesPrefix(routePath: string, table: string[]): boolean {
  return table.some((p) => routePath === p || routePath.startsWith(`${p}/`) || routePath.startsWith(`${p}?`));
}

/** First ~120 chars of a user-facing prompt string, trimmed. */
function truncate(s: string, max = 120): string {
  const t = String(s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Pull a human-readable prompt out of the various shapes LLM-operation bodies arrive in. */
function extractLlmSummary(body: any): string {
  if (body && typeof body.prompt === "string" && body.prompt.trim()) return truncate(body.prompt);
  if (body && typeof body.question === "string" && body.question.trim()) return truncate(body.question);
  if (body && Array.isArray(body.messages) && body.messages.length) {
    const last = [...body.messages].reverse().find((m: any) => typeof m?.content === "string" && m.content.trim());
    if (last) return truncate(last.content);
  }
  return "llm operation";
}

/**
 * Map an Express request (method + path + body) to an operation descriptor, or `null` when the
 * route is NOT a gated operation (health/status/metrics/keys-pool polls, or anything outside
 * the curated list). Pure — no IO, no `req` object required, so it's trivially unit-testable.
 */
export function deriveOperation(method: string, routePath: string, body: any): GatedOperation | null {
  const p = String(routePath ?? "");
  if (matchesPrefix(p, LLM_ROUTES)) {
    return { kind: "llm", summary: extractLlmSummary(body) };
  }
  if (matchesPrefix(p, TERMINAL_ROUTES)) {
    const cmd = body && typeof body.command === "string" && body.command.trim() ? body.command : "terminal operation";
    return { kind: "terminal", summary: truncate(cmd, 200) };
  }
  if (matchesPrefix(p, FILE_ROUTES)) {
    const target =
      (body && typeof body.relativePath === "string" && body.relativePath) ||
      (body && typeof body.path === "string" && body.path) ||
      "file operation";
    return { kind: "file", summary: truncate(target, 200) };
  }
  return null;
}

/** lowercase, non-alnum → "-", collapse repeats, trim edges, cap length. Pure. */
export function slugify(s: string): string {
  const base = String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base.slice(0, 40).replace(/-+$/g, "") || "op";
}

/** Zero-pad helper for the HHMMSS filename segment. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `journal/ops/<YYYY-MM-DD>/<HHMMSS>-<kind>-<slug>.md` — one note per operation (no
 * read-modify-write races). Takes `nowIso` as input (never calls Date.now() itself) so it's
 * deterministic and testable. Guaranteed `isSafeVaultPath`-safe: no leading slash, no `..`.
 */
export function opNotePath(op: GatedOperation, nowIso: string): string {
  const d = new Date(nowIso);
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const slug = slugify(op.summary);
  return `journal/ops/${yyyy}-${mm}-${dd}/${hh}${mi}${ss}-${op.kind}-${slug}.md`;
}

/** Markdown body: frontmatter + summary + a "Recalled" section listing findings. Pure. */
export function opNoteBody(op: GatedOperation, findings: VaultFinding[], nowIso: string): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`tags: [ops, ${op.kind}]`);
  lines.push(`ts: ${nowIso}`);
  lines.push(`kind: ${op.kind}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${op.kind} operation`);
  lines.push("");
  lines.push(op.summary);
  if (op.detail) {
    lines.push("");
    lines.push(op.detail);
  }
  lines.push("");
  lines.push("## Recalled");
  if (findings.length === 0) {
    lines.push("");
    lines.push("(no matching notes found)");
  } else {
    for (const f of findings) {
      const excerpt = truncate(f.excerpt, 100);
      lines.push(`- [[${f.path}]] (${f.score}) — ${excerpt}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export interface GateResult {
  touched: boolean;
  findings: VaultFinding[];
  reason?: string;
  notePath?: string;
}

const GATE_TIMEOUT_MS = 2000;

/**
 * IO shell — SOFT, NEVER throws. Reads the vault (obsidianContribute), then writes an
 * operation-record note (vaultWrite). `touched` is true if EITHER side succeeded; when both
 * fail, `reason` carries why. Wrapped in an overall timeout so a hung Obsidian process cannot
 * stall a real operation — `obsidianContribute` has no timeout param of its own.
 */
export async function obsidianGate(op: GatedOperation, nowIso: string): Promise<GateResult> {
  const work = (async (): Promise<GateResult> => {
    try {
      const contrib = await obsidianContribute(op.summary, 3);
      const notePath = opNotePath(op, nowIso);
      const wrote = await vaultWrite(notePath, opNoteBody(op, contrib.findings, nowIso));
      const touched = contrib.ok || wrote;
      if (!touched) {
        return { touched: false, findings: contrib.findings, reason: contrib.reason || "vault unreachable" };
      }
      return { touched: true, findings: contrib.findings, notePath };
    } catch (e) {
      return { touched: false, findings: [], reason: String(e) };
    }
  })();

  const timeout = new Promise<GateResult>((resolve) => {
    setTimeout(() => resolve({ touched: false, findings: [], reason: "timeout" }), GATE_TIMEOUT_MS).unref?.();
  });

  return Promise.race([work, timeout]);
}
