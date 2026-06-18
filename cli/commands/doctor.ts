// `ollamas doctor` — health of the whole stack: gateway, ollama, host-bridge.
// Mirrors bin/host-bridge/tools/health_probe.mjs but from the client side.
import { parseArgs } from "node:util";
import { GatewayClient, buildDoctorReport } from "../lib/client";
import { loadConfig } from "../lib/config";
import { resolveOutputCtx, formatDoctor } from "../lib/output";

export async function runDoctor(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: false,
    options: { json: { type: "boolean" } },
  });

  const cfg = loadConfig();
  const client = new GatewayClient(cfg.gateway, cfg.apiKey);
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ctx = resolveOutputCtx(process.env, !!process.stdout.isTTY, !!values.json);

  const report = await buildDoctorReport(client, ollamaHost, new Date().toISOString());
  process.stdout.write(formatDoctor(report, ctx) + "\n");
  return report.healthy ? 0 : 1;
}
