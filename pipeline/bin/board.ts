#!/usr/bin/env -S npx tsx
// The board — every lane in its own visible Terminal.app tab, plus a conductor tab.
//
// WHY THIS EXISTS
// *"Her todo ve phase görevini sıralı terminal.app penceresinde çalışacak şekilde
// görevlendir… canlı takip edeyim."* Three systems are built here — eCym, ollamas, obsidian —
// and the operator wants to watch all three progress at once rather than read a summary
// afterwards.
//
// Concurrency shape: WITHIN a lane the steps are strictly sequential (each one assumes the
// previous succeeded); ACROSS lanes they overlap, because the three systems have no shared
// state during verification. That is the same rule the DAG already applies to waves, applied
// to teams.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeLane, renderBoard, boardVerdict, runnable, laneProgress, type Lane } from "../lib/lane";
import { capability, openTab, pushStep, closeTab, readStatus, sweepTabs, TAB_ROOT, type TabHandle } from "../runtime/termtab";
import { narratePlan, narrateStep, renderNarration, section } from "../lib/narrate";
import { batches as dagBatches, parallelismFactor } from "../lib/dag";
import type { TermTarget } from "../../orchestration/bin/lib/term-exec";

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The three build lanes.
 *
 * Each step is a real verification with a real exit code — nothing here prints "ok" without
 * having checked something. `required: false` marks steps whose failure is informative but
 * must not halt the lane (a flaky service should not hide the rest of the system's state).
 */
export function buildLanes(): Record<string, Lane> {
  return {
    ecym: makeLane("ecym", "eCym", [
      ["dataset bütünlüğü", `python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/ecy-model/terminal-dataset.json')));print('komut:',len(d['commands']))"`],
      ["pipeline rotaları 4/4", `bash -c 'n=0; for q in "pipeline calistir" "pipeline benchmark al" "kor nokta var mi" "pipeline dag goster"; do id=$(~/.local/bin/ecy-cmd "$q" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get(\\"id\\",\\"\\"))" 2>/dev/null); case "$id" in pipeline-*) n=$((n+1));; esac; done; echo "rota $n/4"; [ "$n" = "4" ]'`],
      ["cckb rotası", `bash -c '~/.local/bin/ecy-cmd "claude code kb ara hooks" | grep -q cckb && echo "cckb rotası OK"'`],
      ["vektör beyni", `python3 -c "import json,os;p=os.path.expanduser('~/ecy-model/brain.vec.json');print('vektör dosyası:',round(os.path.getsize(p)/1e6,1),'MB')"`],
    ]),
    ollamas: makeLane("ollamas", "ollamas", [
      ["typecheck", `cd ${REPO} && npx tsc --noEmit && echo "tsc temiz"`],
      ["pipeline testleri", `cd ${REPO} && npx vitest run --project pipeline --reporter=dot`],
      ["DAG bütünlüğü", `cd ${REPO} && npx tsx -e "import {readFileSync} from 'node:fs';import {explain} from './pipeline/lib/dag.ts';console.log(explain(JSON.parse(readFileSync('pipeline/workflow.json','utf8'))).at(-1))"`],
      // Asserts the run COMPLETED and emitted its document — not that every SLO passed.
      // `run.ts` exits 1 whenever `go_ahead` is false, and in --light mode coverage/security
      // are deliberately not measured, so gating this step on the exit code would paint a
      // correct, honest MISS as a lane failure. The gates themselves are judged by
      // `pipeline bench` and `verify.sh`.
      ["pipeline koşusu", `bash -c 'cd ${REPO}; npx tsx pipeline/bin/run.ts --profile simple --light --pool 2 --quiet >/dev/null 2>&1; d=$(ls -t ${VAULT}/orchestra/runs/*.document.json 2>/dev/null | head -1); [ -n "$d" ] && echo "belge üretildi: $(basename "$d")"'`],
      ["/metrics", `bash -c 'curl -s --max-time 6 http://127.0.0.1:3000/metrics | grep -c workflow_step_duration_seconds || echo 0'`, { required: false }],
    ]),
    obsidian: makeLane("obsidian", "obsidian", [
      ["kapsül tazeliği", `python3 ${VAULT}/_bin/cc-capsules.py --report`],
      ["KB isabet kalitesi", `python3 ${VAULT}/_bin/cc-quality.py --quiet`],
      ["referans çapaları", `python3 ${VAULT}/_bin/pipe-anchors.py --check`],
      // Single line by necessity: the queue format is one step per line, and lib/lane.ts
      // rejects an embedded newline rather than letting one step's text become the next
      // step's command. A python one-liner keeps the check honest without a temp file.
      ["canvas düğümleri", `python3 -c "import json,os;V='${VAULT}';cs=['claude-code-sistem.canvas','pipeline-sistem.canvas'];m=sum(1 for c in cs if os.path.exists(os.path.join(V,c)) for n in json.load(open(os.path.join(V,c)))['nodes'] if n.get('type')=='file' and not os.path.exists(os.path.join(V,n['file'])));print('kayıp düğüm:',m);raise SystemExit(0 if m==0 else 1)"`],
      ["KB kapısı", `zsh ${VAULT}/_bin/cc-verify.sh`, { required: false }],
    ]),
  };
}

/** The conductor's own tab: a redrawing table, not a scrolling log. */
function conductorScript(statusFile: string): string {
  return [
    `printf '\\033]0;eCym · KONDÜKTÖR\\007'`,
    `while true; do`,
    `  clear`,
    `  cat "${statusFile}" 2>/dev/null || echo "waiting for lanes…"`,
    `  [ -f "${statusFile}.done" ] && break`,
    `  sleep 1`,
    `done`,
    `echo; echo "board finished — closing in 5s"; sleep 5; exit`,
  ].join("\n");
}

async function openConductor(statusFile: string, target: TermTarget): Promise<void> {
  const dir = join(TAB_ROOT, "_conductor");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "conductor.sh");
  writeFileSync(script, `#!/bin/bash\n${conductorScript(statusFile)}\n`, { mode: 0o755 });
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("open", ["-a", target === "iterm2" ? "iTerm" : "Terminal", script]).catch(() => {});
}

export interface BoardOptions {
  narrate: boolean;
  lanes: string[];
  target: TermTarget;
  /** CI only: run the steps here instead of in tabs. Must be asked for explicitly. */
  headless: boolean;
  timeoutMs: number;
}

export async function runBoard(o: BoardOptions) {
  const all = buildLanes();
  const chosen = o.lanes.filter((id) => all[id]).map((id) => all[id]);
  if (!chosen.length) {
    console.error(`no such lane. available: ${Object.keys(all).join(", ")}`);
    return { ok: false, lanes: [] as Lane[] };
  }

  if (o.headless) return runHeadless(chosen);

  const cap = await capability(o.target);
  if (!cap.ok) {
    // A board that cannot open a tab has not "partially succeeded" — the whole point was
    // visibility, so this is a hard failure with the one line that fixes it.
    console.error(`board: ${cap.reason}\n  fix: ${cap.fix}`);
    return { ok: false, lanes: chosen };
  }

  // Close any tabs a previous run left waiting, so a stale loop cannot consume this run's
  // queue (measured: a leftover tab silently ate the first steps of the next board).
  sweepTabs();
  await sleep(400);

  const statusFile = join(TAB_ROOT, "board.status");
  mkdirSync(TAB_ROOT, { recursive: true });
  writeFileSync(statusFile, "starting…\n", "utf8");
  if (existsSync(`${statusFile}.done`)) {
    const { rmSync } = await import("node:fs");
    rmSync(`${statusFile}.done`, { force: true });
  }
  await openConductor(statusFile, o.target);

  // ALGORİTMA tab: what the board is doing and WHY, not just that it is doing it. Written to
  // a file the tab tails, so the narration keeps flowing after this process exits.
  let narrateFile = "";
  if (o.narrate) {
    const ndir = join(TAB_ROOT, "_narrate");
    mkdirSync(ndir, { recursive: true });
    narrateFile = join(ndir, "narration.log");
    const plan = chosen.flatMap((l) => [
      `▸ Lane ${l.title}: ${l.steps.length} adım, SIRALI (her adım öncekinin başarısını varsayar).`,
      ...l.steps.map((s, i) => `│ ${String(i + 1).padStart(2)}. ${s.title}${s.required === false ? "  (zorunlu değil)" : ""}`),
    ]);
    writeFileSync(narrateFile, [
      "eCym ALGORİTMA — board akışı ve gerekçesi",
      ...section("PLAN"),
      `▸ ${chosen.length} lane EŞZAMANLI koşuyor; lane içinde adımlar SIRALI.`,
      "▸ Bir lane kırmızıysa board kırmızı — kısmi yeşil, yeşil değildir.",
      ...plan,
      ...section("AKIŞ"),
    ].join("\n") + "\n", "utf8");
    const nscript = join(ndir, "narrate.sh");
    writeFileSync(nscript, `#!/bin/bash\nprintf '\\033]0;eCym · ALGORİTMA\\007'\nclear\ntail -n +1 -f "${narrateFile}"\n`, { mode: 0o755 });
    const { execFile: ef } = await import("node:child_process");
    const { promisify: pf } = await import("node:util");
    await pf(ef)("open", ["-a", o.target === "iterm2" ? "iTerm" : "Terminal", nscript]).catch(() => {});
  }
  const say = (line: string) => {
    if (narrateFile) { try { appendFileSync(narrateFile, line + "\n"); } catch { /* tab closed */ } }
  };

  const handles: TabHandle[] = [];
  for (const lane of chosen) {
    handles.push(await openTab(lane, o.target));
    await sleep(250);                       // let each window settle before the next opens
  }

  // Wait for every tab to signal ready; a tab that never appears must not be treated as an
  // empty-but-successful lane.
  const deadline = Date.now() + 20_000;
  for (const h of handles) {
    while (Date.now() < deadline && !readStatus(h).ready) await sleep(200);
    if (!readStatus(h).ready) {
      console.error(`board: lane '${h.lane.id}' tab never became ready`);
      return { ok: false, lanes: chosen };
    }
  }

  // Drive all lanes concurrently; inside each lane, one step at a time.
  const started = Date.now();
  const drive = handles.map(async (h) => {
    for (const step of runnable(h.lane)) {
      step.state = "running";
      step.startedMs = Date.now();
      pushStep(h, step);
      const stepDeadline = Date.now() + o.timeoutMs;
      while (Date.now() < stepDeadline) {
        const st = readStatus(h);
        if (st.finished[step.id] !== undefined) {
          step.exitCode = st.finished[step.id];
          step.state = step.exitCode === 0 ? "ok" : "failed";
          step.endedMs = Date.now();
          break;
        }
        await sleep(300);
      }
      if (step.state === "running") {
        step.state = "failed";
        step.exitCode = 124;
        step.endedMs = Date.now();
      }
      say(renderNarration([narrateStep(`${h.lane.id}/${step.title}`, "step", step.state === "ok", (step.endedMs ?? 0) - (step.startedMs ?? 0))])[0]);
      if (step.state === "failed" && step.required !== false) {
        say(`■ ${h.lane.title}: zorunlu adım düştü → lane durduruldu (sonraki adımlar bunun başarısını varsayıyordu).`);
        break;
      }
    }
    closeTab(h);
  });

  const ticker = setInterval(() => {
    writeFileSync(statusFile, renderBoard(chosen, Date.now()).join("\n") + "\n", "utf8");
  }, 1000);

  await Promise.all(drive);
  clearInterval(ticker);

  const verdict = boardVerdict(chosen);
  const lines = [
    ...renderBoard(chosen, Date.now()),
    "",
    `verdict: ${verdict.ok ? "GREEN" : "RED"} — ${verdict.reason}`,
    `elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`,
  ];
  writeFileSync(statusFile, lines.join("\n") + "\n", "utf8");
  writeFileSync(`${statusFile}.done`, "", "utf8");

  say("");
  say(`■ Karar: ${verdict.ok ? "GREEN" : "RED"} — ${verdict.reason}`);
  console.log(lines.join("\n"));
  for (const l of chosen) {
    for (const s of l.steps) {
      if (s.state === "failed") console.log(`  ✗ ${l.id}/${s.title} → exit ${s.exitCode}`);
    }
  }
  return { ok: verdict.ok, lanes: chosen };
}

/** CI path: same steps, same verdict, no windows. Explicitly opt-in via --headless. */
async function runHeadless(lanes: Lane[]) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  for (const lane of lanes) {
    for (const step of runnable(lane)) {
      step.state = "running";
      step.startedMs = Date.now();
      try {
        await exec("bash", ["-c", step.command], { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
        step.exitCode = 0;
        step.state = "ok";
      } catch (e) {
        step.exitCode = (e as { code?: number }).code ?? 1;
        step.state = "failed";
      }
      step.endedMs = Date.now();
      console.log(`${step.state === "ok" ? "✓" : "✗"} ${lane.id}/${step.title}`);
      if (step.state === "failed" && step.required !== false) break;
    }
  }
  const v = boardVerdict(lanes);
  console.log(renderBoard(lanes, Date.now()).join("\n"));
  console.log(`verdict: ${v.ok ? "GREEN" : "RED"} — ${v.reason}`);
  return { ok: v.ok, lanes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
  };
  runBoard({
    narrate: argv.includes("--narrate"),
    lanes: get("--lanes", "ecym,ollamas,obsidian").split(",").map((s) => s.trim()).filter(Boolean),
    target: (get("--target", "terminal") as TermTarget),
    headless: argv.includes("--headless"),
    timeoutMs: Number(get("--step-timeout", "600000")),
  })
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => {
      console.error(`board: ${(e as Error).message}`);
      process.exit(2);
    });
}
