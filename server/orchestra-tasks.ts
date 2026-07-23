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
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ecymPropose, obsidianContribute, type EcymProposal } from "./orchestra-roles";
import { readEcymCommands } from "./brain-obsidian-ecym";
import type { SynthesisResult } from "./orchestra-synthesis";

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

/**
 * A task may deepen ONCE. Two rounds is enough for "measure, then look closer" — which is the
 * pattern the gap actually showed — and a hard ceiling means no amount of enthusiasm from a
 * model can walk the machine down a chain of its own devising.
 */
export const MAX_ROUNDS = 2;

/** Days a gated task may sit in Doing before it is frozen (visible, not deleted). */
export const staleDays = (env = process.env): number => {
  const n = Number(env.ORCHESTRA_STALE_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 7;
};

/**
 * Catalog ids the panel may name for a follow-up: read-only entries the shell will genuinely
 * run. Offering an id that would be refused anyway just invites a wasted round, and offering
 * a gated one invites a chain that stalls on approval by construction.
 */
export function followupCandidates(catalog = readEcymCommands(), allowed: (cmd: string) => boolean = () => true): string[] {
  return catalog
    .filter((c) => (c.safe === true || String(c.safe).toLowerCase() === "true"))
    .map((c) => ({ id: c.id, cmd: c.arg && c.arg !== "yok" ? `${c.cmd} ${c.arg}` : c.cmd }))
    .filter((c) => !/\{\{[^}]+\}\}/.test(c.cmd) && !isRiskyCommand(c.cmd) && allowed(c.cmd))
    .map((c) => c.id)
    .sort();
}

/** Turn a validated catalog id into a step. Returns null for an id that is not auto-runnable. */
export function followupStep(id: string, catalog = readEcymCommands()): Step | null {
  const c = catalog.find((x) => x.id === id);
  if (!c) return null;
  const cmd = c.arg && c.arg !== "yok" ? `${c.cmd} ${c.arg}` : c.cmd;
  const proposal: EcymProposal = {
    cmd, id: c.id, safe: !!c.safe && !/\{\{[^}]+\}\}/.test(cmd),
    desc: c.desc ?? "", score: 1,
  };
  const auto = isAutoRunnable(proposal);
  return {
    role: "command", invocation: cmd, auto, proposal,
    ...(auto ? {} : { gateReason: "takip komutu otomatik çalıştırılamaz" }),
  };
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
  /** L39/L42: panel synthesis over the step evidence; `followupIds` offers the catalog ids it
   *  may name for a second round. Absent → the note keeps only raw blocks. */
  synthesize?: (title: string, results: StepResult[], followupIds: string[], alreadyRun: string[]) => Promise<SynthesisResult | null>;
  /** L40: write a finished task's conclusion back into the brain (the choke-point). */
  remember?: (m: { id: string; tier: string; content: string; source: string }) => Promise<unknown>;
  /** L41: let obsidian write the human-facing report ITSELF, via its own REST surface. */
  vaultWrite?: (path: string, content: string) => Promise<boolean>;
  /** L42: does the shell allowlist permit this command? Follow-ups it would refuse are never
   *  offered — naming one spends a round to earn a refusal we can predict. */
  commandAllowed?: (cmd: string) => boolean;
  /** L43: append one outcome record per task. Without it "is the orchestra actually useful?"
   *  has no answer but an opinion. */
  ledger?: (row: TaskOutcome) => void;
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
export function evidenceNote(title: string, id: string, results: StepResult[], totalMs: number, at: string, synthesis?: SynthesisResult | null, rounds = 1): string {
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
    + `> [!abstract] ${status} · ${rounds > 1 ? `${rounds} tur · ` : ""}${results.length} adım · toplam **${totalMs}ms** (adımların toplamı ${sum}ms → paralel kazanç ${Math.max(0, sum - totalMs)}ms)\n> ${at}\n\n`
    + (gated.length
        ? `> [!warning] Onay bekleyen adımlar — işaretle, sonraki turda çalışır\n\n`
          + gated.map((g) => `- [ ] ONAY: \`${g.invocation}\`  _(${g.gateReason})_`).join("\n") + "\n\n"
        : "")
    // L39: the CONCLUSION, above the raw blocks. The evidence stays below it untouched — a
    // summary that replaced the evidence would be the same failure in the other direction.
    + (synthesis?.followup && rounds > 1
        ? `> [!tip] 🔗 Takip: \`${synthesis.followup}\` — ${synthesis.followupVia === "decision" ? "denetçi kararı" : "sentez direktifi"}\n\n`
        : "")
    + (synthesis
        ? (synthesis.abstained
            ? `## ⚠️ Sonuç\n\n> [!warning] Panel kanıttan cevap çıkaramadı (BİLGİ_YOK). Ham adımlar aşağıda.\n\n`
            : `## ${synthesis.grounding?.weak ? "⚠️" : "✅"} Sonuç\n\n> [!${synthesis.grounding?.weak ? "warning" : "success"}] **${synthesis.grounding?.via === "deterministic" ? "deterministik özet" : synthesis.expert || "?"}**${synthesis.grounding?.regrounded ? " · yeniden-soruldu" : ""} · kanıta dayalı\n\n${synthesis.answer}\n\n`)
          // L45: an answer that talked around its evidence is flagged, not passed off as solid.
          // It stays in the note (a human can still read it) but is kept out of the brain.
          + (synthesis.grounding?.weak
              ? `> [!warning] ⚠️ zayıf-grounding (${synthesis.grounding.mode === "citation" ? "atıf ölçütü: kaynak atfı yok/kaçamak" : `sayı ölçütü: komut çıktısı kullanılmadı, skor ${synthesis.grounding.score.toFixed(2)}`}). Brain'e yazılmadı.\n\n`
              : "")
          + (synthesis.veto
              ? `> [!important] ⚡ Kalite vetosu — gate **${synthesis.veto.from}** dedi, ölçüm **${synthesis.veto.to}** dedi (Δ${synthesis.veto.delta.toFixed(3)}).\n\n`
              : "")
          + (synthesis.degradedReasons && Object.keys(synthesis.degradedReasons).length
              ? `> [!note]- Sentezde katılmayan uzmanlar\n` + Object.entries(synthesis.degradedReasons).map(([e, why]) => `> - **${e}** — ${why}`).join("\n") + "\n\n"
              : "")
          + `---\n\n### Ham kanıt\n\n`
        : "")
    + results.map((r) => {
        const head = `## ${ROLE_LABEL[r.role]} — ${r.gated ? "⏸ atlandı" : r.ok ? "✅" : r.degraded ? "🔌 çevrimdışı" : "❌"} ${r.ms}ms`;
        const inv = "```\n" + r.invocation + "\n```";
        const out = r.gated ? "_(onay bekliyor — çalıştırılmadı)_" : "```\n" + (r.output || "(çıktı yok)") + "\n```";
        return `${head}\n\n${inv}\n\n${out}`;
      }).join("\n\n")
    + `\n\n[[Orchestra]] · [[sprint]]\n`;
}

/**
 * The human-facing report obsidian writes for itself. Deliberately short: the evidence note is
 * the record, this is the thing you actually want to read, and it links back rather than
 * duplicating. Deterministic path so a re-run overwrites instead of accumulating.
 */
export const reportPath = (title: string, day: string): string =>
  `orchestra/reports/${day}-${title.toLowerCase().replace(/[^a-z0-9ğüşiöç]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task"}.md`;

export function reportNote(title: string, answer: string, expert: string, noteBase: string, at: string): string {
  return `---\ncssclasses: [brain, system-orchestra]\ntags: [orchestra, report]\naliases: [${JSON.stringify(title.slice(0, 60))}]\n---\n\n`
    + `# 📋 ${title}\n\n> [!success] **${expert || "panel"}** · ${at}\n\n${answer}\n\n`
    + `Ham kanıt: [[${noteBase}]] · [[Orchestra]] · [[sprint]]\n`;
}

/** Approvals a human ticked in a previously written evidence note. */
export function readApprovals(noteText: string): Set<string> {
  const out = new Set<string>();
  for (const m of noteText.matchAll(/^\s*-\s*\[x\]\s*ONAY:\s*`([^`]+)`/gim)) out.add(m[1].trim());
  return out;
}

export const taskNotePath = (vault: string, id: string, title: string): string =>
  join(vault, "orchestra", "tasks", `${id}-${title.toLowerCase().replace(/[^a-z0-9ğüşiöç]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task"}.md`);

/** One task's outcome, as evidence rather than impression. */
export interface TaskOutcome {
  at: number;
  task: string;
  id: string;
  rounds: number;
  /** Which members actually contributed something this run. */
  members: StepRole[];
  ms: number;
  answered: boolean;
  expert?: string;
  vetoed?: boolean;
  gated: number;
  failed: number;
  remembered: boolean;
  reported: boolean;
}

export interface TaskRunResult { ran: number; gated: number; done: number; remembered?: number; reported?: number; froze?: number; wallMs?: number; parallelMs?: number }

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

  // L47: freeze a task that has waited too long for approval. Before this a gated task sat in
  // Doing indefinitely with nothing marking it as stuck — "işlemi sonlandır" had been there for
  // days. The ❄️ marker makes the stall visible (and feeds the status panel) without deleting
  // anything: a human can still tick the approval and it thaws on the next run.
  let froze = 0;
  const staleMs = staleDays() * 86_400_000;
  board.lanes.Doing = board.lanes.Doing.map((line) => {
    if (!/^\s*-\s*\[ \]/.test(line) || line.includes("❄️")) return line;
    const t = taskTitle(line);
    const note = taskNotePath(vault, taskId(t), t);
    if (!existsSync(note)) return line;
    let ageMs = 0;
    try { ageMs = now() - statSync(note).mtimeMs; } catch { return line; }
    if (ageMs < staleMs) return line;
    froze++;
    try {
      const body = readFileSync(note, "utf8");
      if (!/donduruldu/.test(body)) {
        writeFileSync(note, body.replace(/^(#\s.*)$/m,
          `$1\n\n> [!error] ❄️ Donduruldu: ${Math.floor(ageMs / 86_400_000)} gündür onay bekliyor. Onaylanırsa çözülür.`));
      }
    } catch { /* note update best-effort */ }
    return line.replace(/^(\s*-\s*\[ \]\s*)/, "$1❄️ ");
  });
  if (froze) res.froze = (res.froze ?? 0) + froze;

  // L53: run the batch in BOUNDED-parallel chunks. Each task writes its own isolated note and
  // returns a board-free TaskAction (L52), so a chunk is a plain Promise.all with no shared
  // mutation. The board is applied by the single writer AFTER all chunks — races are structurally
  // impossible. Concurrency is bounded (default 3) because the alternative — every Backlog task
  // at once — is N×4 simultaneous LLM calls (pollinations rate-limit) and a terminal flood.
  //
  // Chunks run sequentially so the wall-clock measurement below is honest, and so a huge Backlog
  // cannot open unbounded fan-out.
  const N = orchestraConcurrency();
  const actions: TaskAction[] = [];
  const wall0 = now();
  let stepSum = 0;
  for (let i = 0; i < queue.length; i += N) {
    const chunk = queue.slice(i, i + N);
    const t = now();
    const settled = await Promise.all(chunk.map((q) => runOneTask(vault, q.line, q.lane, deps)));
    stepSum += (now() - t) * chunk.length; // if serial, each would have cost ~this chunk's wall
    for (const a of settled) if (a) actions.push(a);
  }
  const wallMs = now() - wall0;
  applyActions(board, actions, res);
  if (actions.length > 1) { res.wallMs = wallMs; res.parallelMs = Math.max(0, stepSum - wallMs); }

  // Write the board when work moved OR a task was frozen — a freeze that only lived in memory
  // would never reach the file, so the ❄️ marker (and the panel that reads it) would be lost.
  if (res.ran || res.froze) writeFileSync(boardPath, renderBoard(board));
  return res;
}

/** Max tasks run at once. Bounded to protect pollinations rate-limits and the terminal. */
export const orchestraConcurrency = (env = process.env): number => {
  const n = Number(env.ORCHESTRA_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 3;
};

/** The board-free result of running one task: what the single writer needs to move the lane. */
export interface TaskAction {
  line: string;
  lane: Lane;
  transition: "done" | "doing";
  gated: boolean;
  remembered: boolean;
  reported: boolean;
}

/** Apply a batch of task actions to the board and tally the run result. The ONLY board writer. */
function applyActions(board: Board, actions: TaskAction[], res: TaskRunResult): void {
  for (const a of actions) {
    board.lanes[a.lane] = board.lanes[a.lane].filter((l) => l !== a.line);
    res.ran++;
    if (a.transition === "doing") {
      board.lanes.Doing.push(`- [ ] ${taskTitle(a.line)}`);
      if (a.gated) res.gated++;
    } else {
      board.lanes.Done.push(`- [x] ${taskTitle(a.line)}`);
      res.done++;
      if (a.remembered) res.remembered = (res.remembered ?? 0) + 1;
      if (a.reported) res.reported = (res.reported ?? 0) + 1;
    }
  }
}

/**
 * Run one task end to end WITHOUT touching the shared board. Writes its own isolated evidence
 * note and (best-effort) the ledger, memory and report; returns a TaskAction the caller applies
 * to the board. This board-independence is exactly what lets a batch run in parallel.
 */
export async function runOneTask(
  vault: string, line: string, lane: Lane, deps: TaskDeps,
): Promise<TaskAction | null> {
  const now = deps.now ?? Date.now;
  const title = taskTitle(line);
  if (!title || title.startsWith("<")) return null;
  const id = taskId(title);
  const notePath = taskNotePath(vault, id, title);
  const approved = existsSync(notePath)
    ? readApprovals(readFileSync(notePath, "utf8"))
    : (deps.approved ?? new Set<string>());

  const steps = planTask(title);
  const t0 = now();
  const round1 = await runSteps(steps, { ...deps, approved });
  const round1Ms = now() - t0;

  let results = round1;
  let totalMs = round1Ms;
  const ranIds = steps.map((s) => s.proposal?.id).filter((x): x is string => !!x);
  const followupPool = ranIds.length ? followupCandidates(undefined, deps.commandAllowed) : [];
  let synthesis = deps.synthesize ? await deps.synthesize(title, results, followupPool, ranIds) : null;
  let rounds = 1;

  if (synthesis?.followup && rounds < MAX_ROUNDS) {
    const next = followupStep(synthesis.followup);
    if (next) {
      rounds++;
      const t1 = now();
      const r2 = await runSteps([next], { ...deps, approved });
      totalMs += now() - t1;
      results = [...results, ...r2];
      const cause = { followup: synthesis.followup, followupVia: synthesis.followupVia };
      const final = deps.synthesize ? await deps.synthesize(title, results, [], ranIds) : null;
      synthesis = final ? { ...final, ...cause } : synthesis;
    }
  }

  mkdirSync(join(vault, "orchestra", "tasks"), { recursive: true });
  writeFileSync(notePath, evidenceNote(title, id, results, totalMs, new Date(now()).toISOString(), synthesis, rounds));

  const pending = results.some((r) => r.gated);
  const failed = results.some((r) => !r.ok && !r.gated && !r.degraded);
  try {
    deps.ledger?.({
      at: now(), task: title, id, rounds,
      members: [...new Set(results.filter((r) => r.ok && !r.gated).map((r) => r.role))],
      ms: totalMs,
      answered: !!synthesis && !synthesis.abstained && !!synthesis.answer,
      expert: synthesis?.expert || undefined,
      vetoed: !!synthesis?.veto,
      gated: results.filter((r) => r.gated).length,
      failed: results.filter((r) => !r.ok && !r.gated && !r.degraded).length,
      remembered: false, reported: false,
    });
  } catch { /* the ledger must never fail a task */ }

  if (pending || failed) {
    return { line, lane, transition: "doing", gated: pending, remembered: false, reported: false };
  }

  let remembered = false, reported = false;
  // L45: a weakly-grounded answer is not remembered — writing it would poison recall.
  const conclusive = !!synthesis && !synthesis.abstained && !!synthesis.answer && !synthesis.grounding?.weak;
  if (deps.remember && conclusive && synthesis) {
    try {
      const who = results.filter((r) => r.ok && !r.gated).map((r) => r.role).join(", ");
      await deps.remember({
        id: `task-${id}`, tier: "episodic", source: "orchestra/task",
        content: `Görev: ${title}\nSonuç (${synthesis.expert || "panel"}): ${synthesis.answer}\nKatkı veren üyeler: ${who || "yok"}`,
      });
      remembered = true;
    } catch { /* the brain being busy must not fail a finished task */ }
  }
  if (deps.vaultWrite && synthesis && !synthesis.abstained && synthesis.answer) {
    try {
      const day = new Date(now()).toISOString().slice(0, 10);
      const base = notePath.split("/").pop()!.replace(/\.md$/, "");
      const ok = await deps.vaultWrite(reportPath(title, day),
        reportNote(title, synthesis.answer, synthesis.expert, base, new Date(now()).toISOString()));
      if (ok) reported = true;
    } catch { /* report is a bonus, never a failure mode */ }
  }
  return { line, lane, transition: "done", gated: false, remembered, reported };
}
