// `ollamas bench` — measure model latency/throughput through the gateway and
// pick the most efficient model. Dual-target: mac-native (local gateway) and
// remote/iOS-proxy (a remote gateway URL a Shortcut would hit). Measures only
// via /api/generate (+ /api/models) — never touches ollama directly (choke-point).
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform, arch, release } from "node:os";
import { join } from "node:path";
import { GatewayClient, type ChatMessage } from "../lib/client";
import { loadConfig, saveConfig } from "../lib/config";
import { resolveOutputCtx, formatTable, c, type OutputCtx } from "../lib/output";
import { aggregate, pickBest, type RunSample, type ModelResult } from "../lib/bench";
import { writeModelCache } from "../lib/modelcache";

const HELP = `ollamas bench — benchmark models through the gateway

  ollamas bench                          all gateway models, mac target, 3 runs
  ollamas bench --models qwen3:8b,qwen3:4b --runs 5
  ollamas bench --target both --remote-gateway http://pi.local:3000
  ollamas bench --apply                  write the fastest correct model to config

options:
  --models a,b,c     models to test (default: discovered from gateway)
  --target <t>       mac | remote | both   (default mac)
  --remote-gateway <url>  remote endpoint for the remote/iOS-proxy target
  --runs <n>         timed runs per model (default 3)
  --no-warmup        skip the discarded warmup call (cold-start contaminates)
  --prompt <p>       benchmark prompt (default: a deterministic PONG check)
  --expect <s>       substring that marks a correct answer (default PONG)
  --apply            save the best model to ~/.ollamas/cli.json
  --json             raw JSON report      --help`;

const BENCH_FILE = join(homedir(), ".llm-mission-control", "cli-bench.json");

export async function runBench(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: false,
    options: {
      models: { type: "string" },
      target: { type: "string" },
      "remote-gateway": { type: "string" },
      runs: { type: "string" },
      "no-warmup": { type: "boolean" },
      prompt: { type: "string" },
      expect: { type: "string" },
      apply: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const cfg = loadConfig();
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const runs = values.runs ? Math.max(1, Number(values.runs)) : 3;
  const warmup = !values["no-warmup"];
  // Default prompt is echo-proof: the expected token ("4") does NOT appear in the
  // prompt, so a model that merely echoes the prompt can't score correct (N-006).
  const prompt = (values.prompt as string) || "What is two plus two? Reply with only the number.";
  // Custom prompt without a known answer → correctness = non-empty output.
  const expect = (values.expect as string) || (values.prompt ? "" : "4");

  const targets = resolveTargets(values.target as string, cfg.gateway, values["remote-gateway"] as string, ctx);
  if (!targets.length) {
    process.stderr.write("bench: no targets (remote requested but --remote-gateway missing)\n");
    return 2;
  }

  const all: ModelResult[] = [];
  const report: any = { ts: new Date().toISOString(), host: { platform: platform(), arch: arch(), release: release() }, runsPerModel: runs, targets: [] };

  for (const tgt of targets) {
    const client = new GatewayClient(tgt.gateway, cfg.apiKey);
    let models = values.models ? String(values.models).split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!models.length) {
      try {
        models = await client.listModels(cfg.provider);
        writeModelCache(cfg.provider, models); // populate `-m <TAB>` completion (best-effort)
      } catch {
        models = [cfg.model];
      }
    }
    const results: ModelResult[] = [];
    for (const model of models) {
      if (!ctx.json) process.stderr.write(c("dim", `· ${tgt.target}/${model} …`, ctx.color) + "\n");
      try {
        if (warmup) await timedRun(client, model, cfg.provider, prompt, expect); // discard
        const samples: RunSample[] = [];
        for (let i = 0; i < runs; i++) samples.push(await timedRun(client, model, cfg.provider, prompt, expect));
        results.push(aggregate(tgt.target, model, samples));
      } catch (e: any) {
        if (!ctx.json) process.stderr.write(c("red", `  ${model}: ${String(e?.message || e).split("\n")[0]}`, ctx.color) + "\n");
      }
    }
    report.targets.push({ target: tgt.target, gateway: tgt.gateway, results });
    all.push(...results);
  }

  const best = pickBest(all);
  report.best = best;
  writeReport(report);

  if (ctx.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    renderTable(all, ctx);
    process.stdout.write(c("dim", `host ${report.host.platform}/${report.host.arch} · runs/model ${runs} · → ${BENCH_FILE}`, ctx.color) + "\n");
    if (best) process.stdout.write(c("green", `best: ${best.model} (${best.tokPerSec} tok/s, ${best.target})`, ctx.color) + "\n");
    else process.stdout.write(c("yellow", "best: none correct", ctx.color) + "\n");
  }

  if (values.apply && best) {
    saveConfig({ model: best.model });
    if (!ctx.json) process.stdout.write(c("green", `applied: config.model = ${best.model}`, ctx.color) + "\n");
  }
  return 0;
}

interface Target {
  target: string;
  gateway: string;
}

// mac = local gateway; remote = --remote-gateway; both = both (skip remote w/ warn
// when no URL — never silently drop, see CLI_AGENTS no-silent-caps).
function resolveTargets(target: string | undefined, localGateway: string, remoteGateway: string | undefined, ctx: OutputCtx): Target[] {
  const t = (target || "mac").toLowerCase();
  const out: Target[] = [];
  if (t === "mac" || t === "both") out.push({ target: "mac", gateway: localGateway });
  if (t === "remote" || t === "both") {
    if (remoteGateway) out.push({ target: "remote", gateway: remoteGateway });
    else if (!ctx.json) process.stderr.write(c("yellow", "remote target skipped — pass --remote-gateway <url>", ctx.color) + "\n");
  }
  return out;
}

async function timedRun(
  client: GatewayClient,
  model: string,
  provider: string,
  prompt: string,
  expect: string,
): Promise<RunSample> {
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const t0 = Date.now();
  let out = "";
  const meta = await client.generateStream(messages, { model, provider, timeoutMs: 120_000 }, (c) => (out += c));
  const totalMs = Date.now() - t0;
  const correct = expect ? out.includes(expect) : out.trim().length > 0;
  return { ttfbMs: meta.ttfbMs, totalMs, tokPerSec: meta.tokensPerSec, correct };
}

function renderTable(results: ModelResult[], ctx: OutputCtx): void {
  process.stdout.write(
    formatTable(
      ["target", "model", "ttfb_ms", "tok/s", "total_ms", "correct"],
      results.map((r) => [r.target, r.model, r.ttfbMs, r.tokPerSec, r.totalMs, `${Math.round(r.correctRatio * 100)}%`]),
      ctx,
    ) + "\n",
  );
}

function writeReport(report: any): void {
  try {
    mkdirSync(join(homedir(), ".llm-mission-control"), { recursive: true });
    writeFileSync(BENCH_FILE, JSON.stringify(report, null, 2));
  } catch {
    /* best-effort: a read-only home shouldn't fail the benchmark */
  }
}
