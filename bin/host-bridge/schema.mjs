// Tool input schemas (scripts lane, v5). Single source for argument validation
// of the manifest-registered host tools. Zod is the source of truth; the MCP /
// ReAct registry needs JSON-schema, so `toJsonSchema` derives it on demand
// (adopts colinhacks/zod MIT + StefanTerdell/zod-to-json-schema ISC).
// Pure module: no fs, no network — fully unit-testable.
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Keyed by canonical tool name (matches scripts/inventory.json + bin/host-bridge/tools/*.mjs).
export const SCHEMAS = {
  run_tests: z.object({}).strict(),
  git_ops: z.object({ sub: z.string().optional() }).strict(),
  process_port: z.object({ port: z.number().int().positive().optional() }).strict(),
  health_probe: z.object({}).strict(),
  lint_format: z.object({}).strict(),
  git_commit: z.object({ message: z.string().min(1), push: z.boolean().optional() }).strict(),
  build_app: z.object({}).strict(),
  kill_process: z.object({ target: z.string().min(1), signal: z.string().optional() }).strict(),
  log_stream: z.object({ lines: z.number().int().positive().optional() }).strict(),
  pkg_install: z.object({ manager: z.string().min(1), package: z.string().min(1) }).strict(),
  web_search: z.object({ query: z.string().optional(), url: z.string().optional() }).strict(),
  apply_patch: z.object({ diff: z.string().min(1) }).strict(),
  tools_doctor: z.object({}).strict(),
  shell_check: z.object({ command: z.string().min(1) }).strict(),
  logbook: z.object({ action: z.enum(["add", "tail"]).optional(), text: z.string().optional(), n: z.number().int().positive().optional() }).strict(),
  self_heal: z.object({ apply: z.boolean().optional() }).strict(),
};

// Zod schema -> JSON-schema (OpenAPI3 dialect; the shape the ReAct `tools:` param
// and MCP listTools expect: { type, properties, required }).
export function toJsonSchema(zodSchema) {
  const js = zodToJsonSchema(zodSchema, { target: "openApi3", $refStrategy: "none" });
  // zodToJsonSchema wraps in extra metadata for some inputs; the object body is what we want.
  delete js.$schema;
  delete js.additionalProperties;
  return js;
}

// Look up a tool's zod schema by name; throws on unknown (drift guard).
export function schemaFor(name) {
  const s = SCHEMAS[name];
  if (!s) throw new Error(`no input schema for tool '${name}'`);
  return s;
}

// Validate raw args against a tool's schema. Returns parsed args; throws on invalid.
export function validateArgs(name, args) {
  return schemaFor(name).parse(args ?? {});
}
