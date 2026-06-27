// Pure-core logic for `ollamas remote check`. Zero IO — fully unit-testable.
import { c } from "./output";
import type { OutputCtx } from "./output";

export interface RemoteCheckReport {
  mode: string;
  reachable: boolean;
  modelCount: number;
  required: string[];
  missing: string[];
  pass: boolean;
  gateway: string;
}

// Derive the remote-check report from raw /api/health + /api/models responses.
// health=null signals a network failure (unreachable gateway).
// reachable requires both health ok AND at least one model listed — an empty
// model list indicates the ollama backend is disconnected from the gateway.
export function buildRemoteCheck(
  health: any,
  models: string[],
  opts: { required?: string[]; gateway: string },
): RemoteCheckReport {
  const required = opts.required ?? ["qwen3:8b"];
  const mode: string = health?.mode ?? "unknown";
  const reachable = health != null && models.length > 0;
  const missing = required.filter((m) => !models.includes(m));
  const pass = mode === "live" && reachable && missing.length === 0;

  return {
    mode,
    reachable,
    modelCount: models.length,
    required,
    missing,
    pass,
    gateway: opts.gateway,
  };
}

// TTY-aware formatter — mirrors formatDoctor's ctx handling (output.ts:91).
export function formatRemoteCheck(r: RemoteCheckReport, ctx: OutputCtx): string {
  if (ctx.json) return JSON.stringify(r, null, 2);

  const modeColor =
    r.mode === "live" ? "green" : r.mode === "degraded-live" ? "yellow" : "red";

  const lines: string[] = [
    c("bold", "ollamas remote check", ctx.color),
    `  gateway   ${c("dim", r.gateway, ctx.color)}`,
    `  mode      ${c(modeColor, r.mode, ctx.color)}`,
    `  reachable ${r.reachable ? c("green", "yes", ctx.color) : c("red", "no", ctx.color)}`,
    `  models    ${r.modelCount}`,
  ];

  for (const m of r.required) {
    const present = !r.missing.includes(m);
    const mark = present ? c("green", "✓", ctx.color) : c("red", "✗", ctx.color);
    lines.push(`    ${mark} ${m}`);
  }

  lines.push(
    "",
    r.pass
      ? c("green", "PASS — gateway is live and all required models are present", ctx.color)
      : c("red", "FAIL — gateway is not ready for remote GPU offload", ctx.color),
  );

  return lines.join("\n");
}
