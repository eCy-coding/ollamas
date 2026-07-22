// L37 — the sprint board actually runs.
//
// WHY: orchestra/sprint.md was written once by writeOrchestra and read by NOTHING. The kanban
// was decoration. The orchestra had questions but no tasks: no execution, no evidence, no
// state. "Give it a real task and see what happens" had no answer, because you could not give
// it one.
//
// A task moves Backlog → Doing → Done. Each step is typed by the role that owns it (L36):
// `command` belongs to eCym, `vault` to obsidian, `recall` to the brain. Independent steps run
// concurrently, and every step records its exact invocation and RAW output — a summary is not
// evidence.
//
// Safety (Emre's decision): catalog-safe AND denylist-clean runs automatically; anything else
// becomes a `- [ ] ONAY:` line in the vault and does not run until he ticks it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ecymPropose, obsidianContribute, type EcymProposal } from "./orchestra-roles";

/**
 * Ported from the denylist in ~/.local/bin/ecy-orchestra, which has been guarding real command
 * execution on this machine. Reused rather than reinvented — a hand-written safety regex earns
 * its trust by surviving use, not by being new.
 *
 * Kept as an ADDITIONAL veto on top of the catalog's `safe` flag: a command must clear both.
 */
// The bash original wrote several of these as ` rm ` / ` mv `, i.e. requiring a LEADING space,
// so a command that simply STARTS with the verb slipped through. Anchored to (^|\s) here.
const RISKY = new RegExp([
  "sudo", "(^|\\s)rm\\s", "(^|\\s)dd\\s", "mkfs", "\\s>\\s", ">>", "chmod", "chown",
  "(^|\\s)kill\\s", "pkill", "killall",
  "curl.*\\|.*sh", "wget.*\\|.*sh",
  "(^|\\s)mv\\s", "shutdown", "reboot",
  "launchctl\\s+(unload|bootout|disable)", "defaults\\s+write",
  ">\\s*/",
].join("|"), "i");

export const isRiskyCommand = (cmd: string): boolean => RISKY.test(String(cmd ?? ""));

/** A step runs unattended only if the catalog vetted it AND the denylist is clean. */
export const isAutoRunnable = (p: EcymProposal): boolean => p.safe && !isRiskyCommand(p.cmd);

// ── kanban board (parse / rewrite) ────────────────────────────────────────────
export type Lane = "Backlog" | "Doing" | "Done";
export interface Board { frontmatter: string; lanes: Record<Lane, string[]>; trailer: string }

const LANE_RE = /^##\s*(?:[^\s]+\s+)?(Backlog|Doing|Done)\s*$/i;

/**
 * Parse the Kanban-plugin board. Lane headings carry emoji ("## 📥 Backlog"), so the heading is
 * matched by its NAME. Anything outside the lanes (frontmatter, the `%% kanban:settings %%`
 * block) is preserved verbatim — rewriting the board must not destroy the plugin's own config.
 */
export function parseBoard(md: string): Board {
  const text = md.replace(/\r\n/g, "\n");
  const fmMatch = /^(---\n[\s\S]*?\n---\n)/.exec(text);
  const frontmatter = fmMatch ? fmMatch[1] : "";
  const body = text.slice(frontmatter.length);
  const lanes: Record<Lane, string[]> = { Backlog: [], Doing: [], Done: [] };
  let trailer = "";
  let current: Lane | null = null;

  for (const line of body.split("\n")) {
    const h = LANE_RE.exec(line.trim());
    if (h) {
      const name = (h[1][0].toUpperCase() + h[1].slice(1).toLowerCase()) as Lane;
      current = name;
      continue;
    }
    if (line.trim().startsWith("%%")) { current = null; }
    if (current && /^\s*-\s*\[[ x]\]/.test(line)) { lanes[current].push(line.trim()); continue; }
    if (!current) trailer += line + "\n";
  }
  return { frontmatter, lanes, trailer: trailer.trimEnd() };
}

const LANE_EMOJI: Record<Lane, string> = { Backlog: "📥", Doing: "🔨", Done: "✅" };

export function renderBoard(b: Board): string {
  const lanes = (["Backlog", "Doing", "Done"] as Lane[])
    .map((l) => `## ${LANE_EMOJI[l]} ${l}\n\n${b.lanes[l].join("\n")}${b.lanes[l].length ? "\n" : ""}`)
    .join("\n");
  return `${b.frontmatter}\n${lanes}\n${b.trailer ? b.trailer + "\n" : ""}`;
}

/** Stable id from the task text — the same task keeps the same evidence note across runs. */
export const taskId = (title: string): string =>
  createHash("sha1").update(title.trim()).digest("hex").slice(0, 8);

export const taskTitle = (line: string): string =>
  line.replace(/^\s*-\s*\[[ x]\]\s*/, "").trim();

// ── steps ─────────────────────────────────────────────────────────────────────
export type StepRole = "recall" | "command" | "vault";
export interface Step {
  role: StepRole;
  /** What will actually be invoked: a shell command, or a vault query. */
  invocation: string;
  auto: boolean;
  /** Why it is gated, when it is. */
  gateReason?: string;
  proposal?: EcymProposal;
}

/**
 * Plan a task into role-typed steps. Deterministic on purpose — the plan is a safety surface,
 * and a plan that varies run to run cannot be reviewed or approved.
 *
 * Every task gets a vault step (what do we already have written down?) and a recall step (what
 * does the brain remember?). It gets a command step only when eCym's catalog actually matches;
 * a task with no machine question does not get a made-up command.
 */
export function planTask(title: string): Step[] {
  const steps: Step[] = [
    { role: "vault", invocation: title, auto: true },
    { role: "recall", invocation: title, auto: true },
  ];
  const p = ecymPropose(title);
  if (p) {
    const auto = isAutoRunnable(p);
    steps.push({
      role: "command", invocation: p.cmd, auto, proposal: p,
      ...(auto ? {} : {
        gateReason: p.needsArgument ? "şablon argüman istiyor"
          : isRiskyCommand(p.cmd) ? "denylist: yıkıcı olabilir"
          : "katalogda gated işaretli",
      }),
    });
  }
  return steps;
}

// ── execution ─────────────────────────────────────────────────────────────────
export interface StepResult {
  role: StepRole;
  invocation: string;
  ok: boolean;
  ms: number;
  /** RAW output, truncated only for readability. A summary is not evidence. */
  output: string;
  gated?: boolean;
  gateReason?: string;
  /** A MEMBER was unavailable (Obsidian closed), not the work failing. Non-blocking. */
  degraded?: boolean;
}

export interface TaskDeps {
  runCommand: (cmd: string) => Promise<string>;
  recall: (q: string) => Promise<{ id: string; excerpt: string }[]>;
  /** Approvals already ticked in the evidence note, as exact command strings. */
  approved?: Set<string>;
  maxOutput?: number;
  now?: () => number;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} karakter kırpıldı)` : s);

/**
 * Run the steps. Independent by construction, so they go out concurrently — that is the whole
 * "simultaneous" claim, and the per-step and total timings in the evidence note are what make
 * it checkable rather than asserted.
 */
export async function runSteps(steps: Step[], deps: TaskDeps): Promise<StepResult[]> {
  const now = deps.now ?? Date.now;
  const max = deps.maxOutput ?? 4000;
  return Promise.all(steps.map(async (s): Promise<StepResult> => {
    const started = now();
    const done = (ok: boolean, output: string, extra: Partial<StepResult> = {}): StepResult =>
      ({ role: s.role, invocation: s.invocation, ok, ms: now() - started, output: clip(output, max), ...extra });

    if (!s.auto && !deps.approved?.has(s.invocation)) {
      return done(false, "", { gated: true, gateReason: s.gateReason ?? "onay bekliyor" });
    }
    try {
      if (s.role === "command") return done(true, String(await deps.runCommand(s.invocation)));
      if (s.role === "recall") {
        const hits = await deps.recall(s.invocation);
        return done(true, hits.length
          ? hits.map((h) => `[mem:${h.id}] ${h.excerpt.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")
          : "(anlamsal isabet yok)");
      }
      const v = await obsidianContribute(s.invocation, 3);
      // Obsidian is a desktop app the user closes. That is the vault member being absent, not
      // the task failing — it must not park a task in Doing forever. Reported, not fatal.
      if (!v.ok) return done(false, `vault erişilemedi: ${v.reason}`, { degraded: true });
      return done(true, v.findings.length
        ? v.findings.map((f) => `[[${f.path}]] · ${f.backlinks.length} backlink · ${JSON.stringify(f.tags)}\n  ${f.excerpt.slice(0, 200)}`).join("\n")
        : "(vault'ta isabet yok)");
    } catch (e: any) {
      return done(false, String(e?.message ?? e));
    }
  }));
}

// ── evidence note ─────────────────────────────────────────────────────────────
const ROLE_LABEL: Record<StepRole, string> = { recall: "🔵 ollamas (beyin)", command: "🟢 eCym (makine)", vault: "🟠 obsidian (kasa)" };

/**
 * The evidence note. Pending approvals are `- [ ] ONAY: <command>` checkboxes read back on the
 * next run, reusing the idempotent checkbox contract from the ask queue.
 */
export function evidenceNote(title: string, id: string, results: StepResult[], totalMs: number, at: string): string {
  const sum = results.reduce((a, r) => a + r.ms, 0);
  const gated = results.filter((r) => r.gated);
  const failed = results.filter((r) => !r.ok && !r.gated && !r.degraded);
  const degraded = results.filter((r) => r.degraded);
  const status = gated.length ? "⏸ onay bekliyor"
    : failed.length ? "⚠️ kısmen başarısız"
    : degraded.length ? "✅ tamam (bazı üyeler çevrimdışıydı)"
    : "✅ tamam";

  return `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, task]\naliases: [${JSON.stringify(title.slice(0, 60))}]\ntask_id: ${id}\n---\n\n`
    + `# 🎯 ${title}\n\n`
    + `> [!abstract] ${status} · ${results.length} adım · toplam **${totalMs}ms** (adımların toplamı ${sum}ms → paralel kazanç ${Math.max(0, sum - totalMs)}ms)\n> ${at}\n\n`
    + (gated.length
        ? `> [!warning] Onay bekleyen adımlar — işaretle, sonraki turda çalışır\n\n`
          + gated.map((g) => `- [ ] ONAY: \`${g.invocation}\`  _(${g.gateReason})_`).join("\n") + "\n\n"
        : "")
    + results.map((r) => {
        const head = `## ${ROLE_LABEL[r.role]} — ${r.gated ? "⏸ atlandı" : r.ok ? "✅" : r.degraded ? "🔌 çevrimdışı" : "❌"} ${r.ms}ms`;
        const inv = "```\n" + r.invocation + "\n```";
        const out = r.gated ? "_(onay bekliyor — çalıştırılmadı)_" : "```\n" + (r.output || "(çıktı yok)") + "\n```";
        return `${head}\n\n${inv}\n\n${out}`;
      }).join("\n\n")
    + `\n\n[[Orchestra]] · [[sprint]]\n`;
}

/** Approvals a human ticked in a previously written evidence note. */
export function readApprovals(noteText: string): Set<string> {
  const out = new Set<string>();
  for (const m of noteText.matchAll(/^\s*-\s*\[x\]\s*ONAY:\s*`([^`]+)`/gim)) out.add(m[1].trim());
  return out;
}

export const taskNotePath = (vault: string, id: string, title: string): string =>
  join(vault, "orchestra", "tasks", `${id}-${title.toLowerCase().replace(/[^a-z0-9ğüşiöç]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task"}.md`);

export interface TaskRunResult { ran: number; gated: number; done: number }

/**
 * One pass over the board. Backlog tasks are executed; a task with pending approvals lands in
 * Doing and stays there until they are ticked; only a fully successful task reaches Done.
 */
export async function processTaskBoard(vault: string, deps: TaskDeps): Promise<TaskRunResult> {
  const boardPath = join(vault, "orchestra", "sprint.md");
  if (!existsSync(boardPath)) return { ran: 0, gated: 0, done: 0 };
  const board = parseBoard(readFileSync(boardPath, "utf8"));
  const now = deps.now ?? Date.now;
  const res: TaskRunResult = { ran: 0, gated: 0, done: 0 };

  // Doing first: a task parked for approval gets another chance before new work starts.
  //
  // But ONLY if an approval was actually ticked. A task that landed in Doing because a step
  // genuinely failed must not be retried every tick — that is an infinite loop that re-runs
  // real commands forever. It stays visible in Doing with its evidence note explaining why,
  // and a human decides. Re-queueing on a ticked approval is the one safe exception, because
  // that tick IS the human decision.
  const retryable = board.lanes.Doing.filter((l) => {
    if (!/^\s*-\s*\[ \]/.test(l)) return false;
    const note = taskNotePath(vault, taskId(taskTitle(l)), taskTitle(l));
    return existsSync(note) && readApprovals(readFileSync(note, "utf8")).size > 0;
  });
  const queue: { lane: Lane; line: string }[] = [
    ...retryable.map((line) => ({ lane: "Doing" as Lane, line })),
    ...board.lanes.Backlog.filter((l) => /^\s*-\s*\[ \]/.test(l)).map((line) => ({ lane: "Backlog" as Lane, line })),
  ];

  for (const { lane, line } of queue) {
    const title = taskTitle(line);
    if (!title || title.startsWith("<")) continue;
    const id = taskId(title);
    const notePath = taskNotePath(vault, id, title);
    const approved = existsSync(notePath)
      ? readApprovals(readFileSync(notePath, "utf8"))
      : (deps.approved ?? new Set<string>());

    const steps = planTask(title);
    const t0 = now();
    const results = await runSteps(steps, { ...deps, approved });
    const totalMs = now() - t0;

    mkdirSync(join(vault, "orchestra", "tasks"), { recursive: true });
    writeFileSync(notePath, evidenceNote(title, id, results, totalMs, new Date(now()).toISOString()));
    res.ran++;

    const pending = results.some((r) => r.gated);
    const failed = results.some((r) => !r.ok && !r.gated && !r.degraded);
    board.lanes[lane] = board.lanes[lane].filter((l) => l !== line);
    if (pending || failed) {
      // Stays visible as work-in-progress with a pointer to why.
      board.lanes.Doing.push(`- [ ] ${title}`);
      if (pending) res.gated++;
    } else {
      board.lanes.Done.push(`- [x] ${title}`);
      res.done++;
    }
  }

  if (res.ran) writeFileSync(boardPath, renderBoard(board));
  return res;
}
