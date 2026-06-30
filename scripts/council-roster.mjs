// scripts/council-roster.mjs — the COUNCIL ROSTER: every seat is JUSTIFIED with a standout
// capability (specialty), a rationale (why it's on the council) and PROOF (real evidence). Mixes
// the most MacBook-efficient LOCAL models with CLOUD members (the vault api-keys). A member only
// SITS when its backend is actually reachable — it must prove it's alive. Zero-dep, pure helpers.

// kind: "local" (ollama, MacBook) · "cloud" (vault api-key) · "keyless" (gemini binary OAuth).
// role: "chair" (fast generalist lead) · "coder" · "reasoner" · "frontier" — used for a diverse panel.
export const COUNCIL_ROSTER = [
  {
    id: "qwen3:8b", kind: "local", provider: "ollama-local", model: "qwen3:8b", role: "chair", fast: true,
    specialty: "Fast Generalist Chair",
    rationale: "82 tok/s resident on the M4 Max — instant, $0, always-on; leads the debate + synthesizes.",
    proof: "MODEL_SELECTION.json singleBest rate 1.0 ('cheapest 100%'); MAC_CHAMPION_TOKS=82; measured 5.1s/turn (2026-06-30).",
  },
  {
    id: "qwen3-coder:30b", kind: "local", provider: "ollama-local", model: "qwen3-coder:30b", role: "coder", fast: false,
    specialty: "Code Reasoner",
    rationale: "Coder-tuned; the seat for algorithmic/code-correctness arguments. SLOW on this single-GPU box (deep-only).",
    proof: "LOCAL_CODER_HINT='coder' + architect/coder role (vO6 code bench); but measured 34.7s/turn (single-GPU contention, 2026-06-30) → --deep only.",
  },
  {
    id: "deepseek-r1:32b", kind: "local", provider: "ollama-local", model: "deepseek-r1:32b", role: "reasoner", fast: false,
    specialty: "Deep Reasoner",
    rationale: "Explicit chain-of-thought family — the seat for hard logic / multi-step proofs. SLOW on this single-GPU box (deep-only).",
    proof: "DeepSeek-R1 native CoT, installed on the M4 Max; but measured 47.8s/turn (single-GPU contention, 2026-06-30) → --deep only.",
  },
  {
    id: "gpt-oss:120b-cloud", kind: "local", provider: "ollama-local", model: "gpt-oss:120b-cloud", role: "frontier", fast: true,
    specialty: "Cloud Frontier (signin · $0-key)",
    rationale: "ollama.com 120B frontier via the `ollama signin` session — NO api key, 0-manual, sustainable, AND ~40× faster than the local 30B/32B.",
    proof: "Live: gateway provider:ollama-local model:gpt-oss:120b-cloud → real answer (GATEWAY-CLOUD-REAL); measured 1.2s/turn (2026-06-30).",
  },
  {
    id: "gemini-cli", kind: "keyless", provider: "gemini-cli", model: "", role: "frontier", fast: true,
    specialty: "Keyless Frontier (OAuth)",
    rationale: "Google frontier via the gemini binary — 1M context, 1000/day, $0, no key needed.",
    proof: "Keyless: the `gemini` binary carries Google OAuth; seats whenever the binary is installed.",
  },
  {
    id: "gemini", kind: "cloud", provider: "gemini", model: "gemini-3.5-flash", role: "frontier", fast: true,
    specialty: "Fastest Frontier",
    rationale: "Lowest-latency frontier reasoner for the decisive turn.",
    proof: "NOTE-model-efficiency: gemini-2.5-pro 4/4 correct @ 28.3s (fastest of the bench). Vault key required.",
  },
  {
    id: "openrouter", kind: "cloud", provider: "openrouter", model: "google/gemini-2.5-flash-lite:free", role: "frontier", fast: true,
    specialty: "$0 Cloud Aggregator",
    rationale: "Diverse free-tier cloud models — a non-Google perspective at $0.",
    proof: "OpenRouter free models (':free'); seats when the vault has a live OpenRouter key.",
  },
  {
    id: "openai", kind: "cloud", provider: "openai", model: "gpt-4o-mini", role: "frontier", fast: true,
    specialty: "Cheap Cloud Generalist",
    rationale: "Cheap broad-coverage cloud generalist — an independent third opinion.",
    proof: "gpt-4o-mini (low-cost). Seats when the vault has a live OpenAI key.",
  },
];

/** True when a roster member's backend is actually reachable, given the live availability set. */
export function isAvailable(member, avail) {
  if (member.kind === "local") return (avail.localModels || []).includes(member.model);
  if (member.kind === "keyless") return member.provider === "gemini-cli" ? !!avail.geminiCli : false;
  if (member.kind === "cloud") return ((avail.liveProviders || {})[member.provider] || 0) > 0;
  return false;
}

/**
 * Seat a DIVERSE panel of available members, capped at `want`. A member that isn't reachable
 * never sits (it must prove it's alive).
 *
 * DEFAULT (efficiency-first): only the FAST members seat. MEASURED on this single-GPU box
 * (2026-06-30): `qwen3:8b` 5.1s, `gpt-oss:120b-cloud` 1.2s vs the local 30B/32B `qwen3-coder:30b`
 * 34.7s + `deepseek-r1:32b` 47.8s (often time out) → a default council took MINUTES. The fast cloud
 * frontiers (gpt-oss-120b-cloud / gemini / openrouter) out-reason AND out-pace the slow local
 * 30B/32B, so the default panel is a fast generalist chair + diverse fast frontiers — seconds, not
 * minutes. The slow local coder/reasoner seat ONLY with `{deep:true}` (the operator wants local
 * depth + has patience).
 */
export function selectCouncil(avail, want = 5, { deep = false } = {}) {
  const reachable = COUNCIL_ROSTER.filter((m) => isAvailable(m, avail));
  const ok = deep ? reachable : reachable.filter((m) => m.fast);
  const seated = [];
  const takeRole = (role) => { const m = ok.find((x) => x.role === role && !seated.includes(x)); if (m) seated.push(m); };
  takeRole("chair");
  if (deep) { takeRole("coder"); takeRole("reasoner"); } // slow local depth — deep only
  takeRole("frontier"); // one cloud/keyless frontier for diversity
  for (const m of ok) { if (seated.length >= want) break; if (!seated.includes(m)) seated.push(m); }
  return seated.slice(0, want);
}

/** A one-line seat justification for the convene banner. */
export function seatLine(m) {
  return `${m.model || m.id} — ${m.specialty} · ${m.rationale}`;
}
