// `ollamas pipeline` — the CLI surface for the eCym 18-step benchmark DAG.
//
// WHY THIS EXISTS
// The pipeline has to be reachable from the same place the operator already runs everything
// else. Without a subcommand it would only be invocable as `npx tsx pipeline/bin/run.ts`,
// which means it is not part of ollamas — it just happens to live in the repo.
//
// The heavy modules are imported LAZILY inside each branch: `ollamas --help` and every other
// subcommand must not pay for prom-client, the docker client and the workflow JSON just
// because this file is in the dispatch table.
export async function runPipeline(argv: string[]): Promise<number> {
  const sub = argv[0] ?? "help";
  const rest = argv.slice(1);

  switch (sub) {
    case "run": {
      const { runOnce, PROFILES } = await import("../../pipeline/bin/run");
      const get = (k: string, d?: string) => {
        const i = rest.indexOf(k);
        return i >= 0 ? rest[i + 1] : d;
      };
      const profile = get("--profile", "simple")!;
      const r = await runOnce({
        profile,
        question: get("--question", PROFILES[profile]?.question ?? PROFILES.simple.question)!,
        dry: rest.includes("--dry"),
        explainOnly: rest.includes("--explain"),
        allowPush: rest.includes("--allow-push"),
        poolSize: Number(get("--pool", "5")),
        chaosIterations: Number(get("--chaos-iterations", String(PROFILES[profile]?.chaos ?? 4))),
        quiet: rest.includes("--quiet"),
        light: rest.includes("--light"),
      });
      return r && !r.report.decision.go_ahead ? 1 : 0;
    }

    case "explain": {
      const { explain } = await import("../../pipeline/lib/dag");
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const repo = process.env.OLLAMAS_REPO ?? join(process.env.HOME ?? "", "Desktop", "ollamas");
      const wf = JSON.parse(readFileSync(join(repo, "pipeline", "workflow.json"), "utf8"));
      console.log(explain(wf).join("\n"));
      return 0;
    }

    case "bench": {
      // Spawned rather than imported: bench.ts owns process exit codes and prints a live
      // progress stream, and re-entering it in-process would double-register the Prometheus
      // metrics its runs emit.
      const { spawnSync } = await import("node:child_process");
      const { join } = await import("node:path");
      const repo = process.env.OLLAMAS_REPO ?? join(process.env.HOME ?? "", "Desktop", "ollamas");
      const r = spawnSync("npx", ["tsx", join(repo, "pipeline", "bin", "bench.ts"), ...rest], {
        cwd: repo,
        stdio: "inherit",
      });
      return r.status ?? 2;
    }

    case "audit": {
      // Reads the LAST report rather than running anything: "what did the most recent run
      // leave unproven?" must be answerable without paying for another run.
      const { readFileSync, readdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const vault = process.env.OBSIDIAN_VAULT ?? join(process.env.HOME ?? "", "ollamas-vault");
      const dir = join(vault, "orchestra", "runs");
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
      } catch {
        console.log("no runs yet — `ollamas pipeline run` first");
        return 1;
      }
      if (!files.length) {
        console.log("no runs yet — `ollamas pipeline run` first");
        return 1;
      }
      const last = JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
      const a = last.audit ?? last.results?.[0]?.audit ?? { missing: [] };
      console.log(`last: ${files[files.length - 1]}`);
      console.log(`status=${last.status}`);
      if (last.decision) console.log(`decision: go_ahead=${last.decision.go_ahead} — ${last.decision.reason}`);
      console.log(a.missing?.length ? `missing: ${a.missing.join(", ")}` : "no blind spots");
      for (const t of a.todo ?? []) console.log(`  ${t.id} [${t.owner}] ${t.description}`);
      return a.missing?.length ? 1 : 0;
    }

    case "report": {
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const vault = process.env.OBSIDIAN_VAULT ?? join(process.env.HOME ?? "", "ollamas-vault");
      const dir = join(vault, "orchestra", "runs");
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().slice(-10);
        for (const f of files) {
          const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
          const p = d.total?.p95 ?? d.results?.[0]?.total?.p95 ?? "—";
          console.log(`${f}  status=${d.status ?? "?"}  p95=${p}ms`);
        }
        return 0;
      } catch {
        console.log("no runs yet");
        return 1;
      }
    }

    case "board": {
      // The visible path: lanes in real Terminal.app tabs. Spawned rather than imported so
      // the board owns its own exit code and its tab lifecycle is not tangled with the CLI's.
      const { spawnSync } = await import("node:child_process");
      const { join } = await import("node:path");
      const repo = process.env.OLLAMAS_REPO ?? join(process.env.HOME ?? "", "Desktop", "ollamas");
      const r = spawnSync("npx", ["tsx", join(repo, "pipeline", "bin", "board.ts"), ...rest], {
        cwd: repo,
        stdio: "inherit",
      });
      return r.status ?? 2;
    }

    case "sweep": {
      // Explicit orphan cleanup. Deliberately NOT part of WarmPool.stop(): a broad sweep
      // during a concurrent benchmark deletes the other run's containers (measured — it
      // dropped chaos success to 0.5).
      const { sweepOrphans } = await import("../../pipeline/runtime/pool");
      console.log(`removed ${await sweepOrphans()} orphaned sandbox container(s)`);
      return 0;
    }

    default:
      console.log(`ollamas pipeline — 18-step benchmark DAG (search → … → push)

  run [--profile simple|medium|complex] [--light] [--pool N] [--allow-push]
                          execute the workflow once, measured
  explain                 print the DAG: waves, parallel sets, parallelism factor
  bench [--profiles a,b] [--runs 5] [--warmup 1]
        [--model closed|open] [--concurrency N | --rps R] [--full]
                          repeat runs, aggregate percentiles + variance, judge the SLOs
  audit                   what the last run left unproven (self-audit checklist)
  report                  recent runs with their p95 and status
  board [--lanes ecym,ollamas,obsidian] [--target terminal|iterm2] [--headless]
                          run each lane in its own VISIBLE Terminal.app tab, plus a
                          conductor tab with a live table. --headless is CI-only.
  sweep                   remove orphaned sandbox containers from crashed runs

artifacts: ~/ollamas-vault/orchestra/runs/   metrics: GET /metrics (workflow_step_*)`);
      return sub === "help" || sub === "--help" ? 0 : 1;
  }
}
