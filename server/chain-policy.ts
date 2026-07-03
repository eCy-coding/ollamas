// server/chain-policy.ts — pure fallback-chain filtering: privacy (privateMode excludes
// free tiers that train on prompts), free-tier context caps (e.g. Cerebras 8K), and
// tool-calling capability (catalog declaration + passively learned verdicts). The $0
// terminal tiers (fleet, ollama-local, demo) are NEVER filtered — a request must always
// have somewhere honest to land.

import { catalogEntry, trainsOnData } from "./provider-catalog";
import { getToolSupport } from "./capability-cache";

export interface ChainFilterOpts {
  privateMode?: boolean;
  needTools?: boolean;
  /** Estimated prompt tokens (chars/4 heuristic — same estimator the router's telemetry uses). */
  estTokensIn?: number;
  /** Model the request would run on (capability verdicts are per provider::model). */
  model?: string;
}

const TERMINAL = new Set(["fleet", "ollama-local", "demo"]);

export function filterChain(chain: string[], opts: ChainFilterOpts): string[] {
  return chain.filter((p) => {
    if (TERMINAL.has(p)) return true;
    if (opts.privateMode && trainsOnData(p)) return false;
    const cat = catalogEntry(p);
    if (opts.estTokensIn && cat && cat.maxContext < opts.estTokensIn) return false;
    if (opts.needTools) {
      if (cat?.toolCalling === "none") return false;
      // Learned verdict wins over the optimistic default; catalog "native" needs no verdict.
      const learned = getToolSupport(p, opts.model ?? "") ?? getToolSupport(p, "");
      if (learned === false) return false;
    }
    return true;
  });
}
