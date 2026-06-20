#!/usr/bin/env node
// Render the LaunchAgent plist from the committed template (scripts lane, v16).
// install-agent.sh pipes this into ~/Library/LaunchAgents so the bridge survives
// reboot. PURE renderPlist() (template string in → final string out) is unit-
// tested; the CLI just reads the template file and prints. Dev/install-time tool,
// NOT a host-callable tool (stays out of inventory → drift unchanged).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = join(HERE, "com.missioncontrol.terminalbridge.plist");
export const PLIST_LABEL = "com.missioncontrol.terminalbridge";

// Pure: inject machine-specific values into the template. Throws if any required
// value is missing/relative or if a REPLACE_WITH_ placeholder survives (integrity
// guard — a half-rendered plist would silently load a broken agent).
/**
 * @param {string} template
 * @param {{repoPath:string,token:string,nodePath:string,port?:number}} [opts]
 * @returns {string}
 */
export function renderPlist(template, { repoPath, token, nodePath, port = 7345 } = {}) {
  if (!token) throw new Error("renderPlist: token required");
  if (!repoPath || !repoPath.startsWith("/")) throw new Error(`renderPlist: repoPath must be absolute: ${repoPath}`);
  if (!nodePath || !nodePath.startsWith("/")) throw new Error(`renderPlist: nodePath must be absolute: ${nodePath}`);

  let out = template
    .replace("/usr/local/bin/node", nodePath)
    .replace("REPLACE_WITH_ABSOLUTE_PATH", repoPath.replace(/\/$/, ""))
    .replace("REPLACE_WITH_TOKEN_FROM_~/.llm-mission-control/bridge.token", token);
  // PORT: replace the templated 7345 value inside the EnvironmentVariables PORT key.
  out = out.replace(/(<key>PORT<\/key>\s*<string>)\d+(<\/string>)/, `$1${Number(port) || 7345}$2`);

  if (out.includes("REPLACE_WITH")) throw new Error("renderPlist: unresolved REPLACE_WITH_ placeholder remains");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repoPath, token, nodePath = process.execPath, port = "7345"] = process.argv.slice(2);
  if (!repoPath || !token) {
    console.error("usage: render-plist.mjs <repoPath> <token> [nodePath] [port]");
    process.exit(2);
  }
  try {
    const template = readFileSync(TEMPLATE_PATH, "utf8");
    process.stdout.write(renderPlist(template, { repoPath, token, nodePath, port: Number(port) }));
  } catch (e) {
    console.error(`[!] ${e.message}`);
    process.exit(1);
  }
}
