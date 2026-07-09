// @ts-check
// Test fixture for the v1.9 upstream security-scan gate. Stands in for an external
// scanner (e.g. cisco-ai-defense/mcp-scanner). Reads a manifest JSON object
// { server, tools:[{name,...}] } from stdin and prints { flagged: string[] } to
// stdout. Tool names to flag are passed as a comma list in argv[2].
import { readFileSync } from "node:fs";

const flagNames = new Set((process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean));
let raw = "";
try { raw = readFileSync(0, "utf8"); } catch { /* no stdin */ }
let tools = [];
try { tools = JSON.parse(raw).tools || []; } catch { /* ignore */ }
const flagged = tools.map((t) => t.name).filter((n) => flagNames.has(n));
process.stdout.write(JSON.stringify({ flagged }));
