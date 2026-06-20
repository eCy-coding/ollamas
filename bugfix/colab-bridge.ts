// vC2-bridge — GenFn adapter backed by the connected Colab local runtime.
// Spawns bugfix/colab_exec.py, which runs google.colab.ai.generate_text on the
// live kernel (key-less Gemini). Shape matches triage's injectable GenFn, so the
// triage pipeline is unchanged — only the engine swaps.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { GenFn } from "./triage";

const BASE = () => (process.env.COLAB_BASE || "http://localhost:9100").replace(/\/+$/, "");
const SCRIPT = join(process.cwd(), "bugfix", "colab_exec.py");

export const COLAB_DEFAULT_MODEL = "google/gemini-3.5-flash";

/** True when a Colab token is set AND the Jupyter server exposes a kernel. */
export function colabRuntimeAvailable(): boolean {
  const token = process.env.COLAB_TOKEN;
  if (!token) return false;
  const r = spawnSync(
    "curl",
    ["-s", "-m", "4", "-H", `Authorization: token ${token}`, `${BASE()}/api/kernels`],
    { encoding: "utf8" }
  );
  if (r.status !== 0 || !r.stdout) return false;
  try {
    return Array.isArray(JSON.parse(r.stdout)) && JSON.parse(r.stdout).length > 0;
  } catch {
    return false;
  }
}

/** GenFn that runs the prompt through the connected Colab kernel's Gemini. */
export const colabGen: GenFn = async (prompt, opts) => {
  const model = opts?.model || COLAB_DEFAULT_MODEL;
  const argv = [SCRIPT, "--model", model];
  if (opts?.system) argv.push("--system", opts.system);
  const r = spawnSync("python3", argv, { input: prompt, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 150_000 });
  if (r.status !== 0) {
    throw new Error(`colabGen failed: ${(r.stderr || "").trim() || `exit ${r.status}`}`);
  }
  return { text: (r.stdout || "").trim() };
};
