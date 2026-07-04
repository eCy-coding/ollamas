// modelfile (pure) — render an Ollama Modelfile that creates a Claude-ALIGNED variant of a base model:
// FROM <base> + SYSTEM <constitution> + calibrated PARAMETERs. `ollama create <alignedTag> -f -` builds it.
// No weights are copied or trained — the variant is the SAME base model with a public-principle system prompt
// baked in + inference params tuned toward calibrated, low-sycophancy behavior. IO-free → unit-tested.

export interface ModelfileParams {
  temperature?: number;   // lower → less rambling / more deterministic (Claude-like restraint)
  top_p?: number;
  repeat_penalty?: number;
  num_ctx?: number;
}

/** Calibrated defaults: modest temperature for restraint, standard nucleus, mild repeat penalty. */
export const DEFAULT_ALIGN_PARAMS: ModelfileParams = { temperature: 0.3, top_p: 0.9, repeat_penalty: 1.1, num_ctx: 8192 };

/** A distinct, collision-free name for the aligned variant: "qwen3:8b" → "qwen3-8b-ca". Never reuses the base
 *  tag (no impersonation, no accidental overwrite of the base model). */
export function alignedTag(base: string): string {
  return base.trim().replace(/[:/]/g, "-").replace(/-+$/g, "") + "-ca";
}

/** Render the Modelfile text. `system` must not contain the triple-quote fence used to delimit it. */
export function renderModelfile(opts: { base: string; system: string; params?: ModelfileParams }): string {
  const { base, system, params = DEFAULT_ALIGN_PARAMS } = opts;
  if (!base.trim()) throw new Error("renderModelfile: base model required");
  if (system.includes('"""')) throw new Error('renderModelfile: SYSTEM text must not contain """');
  const lines: string[] = [`FROM ${base}`, "", `SYSTEM """${system}"""`, ""];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) lines.push(`PARAMETER ${k} ${v}`);
  }
  return lines.join("\n") + "\n";
}
