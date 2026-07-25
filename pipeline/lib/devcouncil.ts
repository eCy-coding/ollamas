// devcouncil — the deterministic protocol two peer Claude Code sessions use to collaborate through
// the Obsidian vault WITHOUT a live link. There is no socket between sessions; the vault is the bus.
// Coordination = claim-before-work + role-scoped lanes + an append-only justified log. This module
// is PURE (no disk/clock — timestamps injected) so both SESSION-A (terminal.app) and SESSION-B
// (claude.app) compute identical results, and it is unit-testable.
//
// SESSION-A = coder + efficiency-measurer (writes code/commits/gates).
// SESSION-B = reviewer + bug-hunter + researcher (writes findings/suggestions/review).
// A card is claimed by exactly one session; role-scoped lanes mean the two never write the same file.

export type Session = "A" | "B";
export type Role = "code" | "bench" | "review" | "bug" | "research";
export type Status = "todo" | "in_progress" | "review" | "done";

/** Which session may own a card of a given role (role-scoped lanes). */
export const ROLE_SESSION: Record<Role, Session> = { code: "A", bench: "A", review: "B", bug: "B", research: "B" };

export interface Card {
  id: string;
  title: string;
  role: Role;
  owner: Session | "";
  status: Status;
  reason: string;
  evidence: string;
  body: string;
}

const FM_KEYS = ["id", "title", "role", "owner", "status", "reason", "evidence"] as const;

/** Parse a task card (frontmatter + body) into a Card. Missing keys get safe defaults. */
export function parseCard(md: string): Card {
  const m = String(md ?? "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, "").trim();
    }
  }
  const role = (["code", "bench", "review", "bug", "research"].includes(fm.role) ? fm.role : "code") as Role;
  const status = (["todo", "in_progress", "review", "done"].includes(fm.status) ? fm.status : "todo") as Status;
  const owner = (fm.owner === "A" || fm.owner === "B" ? fm.owner : "") as Session | "";
  return { id: fm.id ?? "", title: fm.title ?? "", role, owner, status, reason: fm.reason ?? "", evidence: fm.evidence ?? "", body: (m ? m[2] : "").trim() };
}

/** Render a Card back to markdown (deterministic; stable key order). */
export function renderCard(c: Card): string {
  const fm = FM_KEYS.map((k) => `${k}: ${String((c as unknown as Record<string, string>)[k] ?? "")}`).join("\n");
  return `---\n${fm}\n---\n\n${c.body}\n`;
}

export interface ClaimResult {
  ok: boolean;
  card: Card;
  conflict?: Session;
}

/**
 * Claim a card for a session. Allowed only if the card's role belongs to that session's lane AND
 * the card is unclaimed (or already this session's). Otherwise returns ok:false with the conflict.
 */
export function claim(card: Card, session: Session): ClaimResult {
  if (ROLE_SESSION[card.role] !== session) return { ok: false, card, conflict: ROLE_SESSION[card.role] };
  if (card.owner && card.owner !== session) return { ok: false, card, conflict: card.owner };
  return { ok: true, card: { ...card, owner: session, status: "in_progress" } };
}

/** One append-only log line: `ts · session · action · WHY · evidence`. ts is injected (pure). */
export function logLine(ts: string, session: Session, action: string, why: string, evidence = "—"): string {
  const clean = (s: string) => String(s).replace(/\s+/g, " ").trim();
  return `${ts} · ${session} · ${clean(action)} · ${clean(why)} · ${clean(evidence)}`;
}

/**
 * Map a backlog item to an A-lane role. Benchmark/perf IMPLEMENTATION is the efficiency-measurer's
 * work → `bench` (SESSION-A); everything else is `code` (SESSION-A). Seeded cards are NEVER routed
 * to B's lanes (review/bug/research) — those are findings-driven, not pool-seeded (fixes F-1: the
 * old regex sent benchmark *code* to B, who cannot code → deadlock, and never produced any `bench`
 * card). Word-boundaries avoid matching "MEASURED"/"benchmark" appearing in prose.
 */
function roleFor(title: string): Role {
  if (/\b(benchmark|p99|p999|latency|throughput|tok\/s)\b/i.test(title)) return "bench";
  return "code";
}

/**
 * Seed task cards from the verified master plan: every `- N.N ⬜|🔶 …` line becomes one card.
 * The title is everything before the first ` [tag]` group; the acceptance criterion is kept in body.
 */
export function seedFromBacklog(md: string): Card[] {
  const cards: Card[] = [];
  for (const m of String(md ?? "").matchAll(/^- (\d+\.\d+) (⬜|🔶) (.+)$/gm)) {
    const [num, mark, rest] = [m[1], m[2], m[3]];
    // Cut the title at the first ` [` — strips ALL bracket tags ([md]/[txt]/[js]/[git]/[accept:…])
    // generically (fixes F-3: the old allowlist leaked [txt]/[js] into titles).
    const title = rest.split(/\s+\[/)[0].replace(/\*\*/g, "").trim();
    const accept = (rest.match(/\[accept:([^\]]*)\]/i)?.[1] ?? "").trim();
    cards.push({
      id: `dc-${num}`, title: title.slice(0, 120), role: roleFor(title), owner: "",
      status: "todo", reason: mark === "🔶" ? "partial — expand" : "missing — build",
      evidence: "", body: accept ? `[accept] ${accept}` : "",
    });
  }
  return cards;
}

/** Next claimable card for a role+session: role-scoped, unclaimed (or this session's), not done. */
export function nextForRole(cards: Card[], role: Role, session: Session): Card | null {
  if (ROLE_SESSION[role] !== session) return null;
  return cards.find((c) => c.role === role && c.status !== "done" && (c.owner === "" || c.owner === session)) ?? null;
}

/** Counts for the status panel. */
export function poolStats(cards: Card[]): { total: number; todo: number; inProgress: number; done: number; a: number; b: number } {
  return {
    total: cards.length,
    todo: cards.filter((c) => c.status === "todo").length,
    inProgress: cards.filter((c) => c.status === "in_progress").length,
    done: cards.filter((c) => c.status === "done").length,
    a: cards.filter((c) => c.owner === "A").length,
    b: cards.filter((c) => c.owner === "B").length,
  };
}
