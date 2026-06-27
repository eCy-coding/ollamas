// `ollamas remote check` — verify the gateway is bound to a remote ollama GPU backend.
import { parseArgs } from "node:util";
import { GatewayClient } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx } from "../lib/output";
import { buildRemoteCheck, formatRemoteCheck } from "../lib/remote";

const USAGE = `ollamas remote check — verify gateway → remote ollama GPU backend

usage: ollamas remote [check] [options]

subcommands:
  check   probe health + model list (default when no subcommand given)

options:
  --required <csv>   comma-separated models that must be present (default: qwen3:8b)
  --json             machine-readable output
  --help             this message

exit codes: 0=PASS  1=FAIL/unreachable  2=usage error
`;

export async function runRemote(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  // Allow bare `ollamas remote` to default to `check`.
  const subcmd = sub === "check" || sub === undefined ? "check" : sub;

  if (sub === "--help" || sub === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (subcmd !== "check") {
    process.stderr.write(`ollamas remote: unknown subcommand '${sub}'\n${USAGE}`);
    return 2;
  }

  const { values } = parseArgs({
    args: sub === "check" ? rest : argv,
    strict: false,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean" },
      required: { type: "string" },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey, cfg.saasAdminToken);
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);
  const requiredOpt = values.required
    ? (values.required as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  let health: any = null;
  let models: string[] = [];

  try {
    health = await client.health();
  } catch {
    // Gateway unreachable — health stays null; report will be reachable=false.
  }

  try {
    models = await client.listModels("ollama-local");
  } catch {
    // Model listing failed — treat as empty (backend may be disconnected).
  }

  const report = buildRemoteCheck(health, models, { required: requiredOpt, gateway: cfg.gateway });
  process.stdout.write(formatRemoteCheck(report, ctx) + "\n");
  return report.pass ? 0 : 1;
}
