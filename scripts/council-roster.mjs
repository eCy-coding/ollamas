// scripts/council-roster.mjs — the COUNCIL ROSTER: every seat is JUSTIFIED with a standout
// capability (specialty), a rationale (why it's on the council) and PROOF (real evidence). Mixes
// the most MacBook-efficient LOCAL models with CLOUD members (the vault api-keys). A member only
// SITS when its backend is actually reachable — it must prove it's alive. Zero-dep, pure helpers.

// kind: "local" (ollama, MacBook) · "cloud" (vault api-key) · "keyless" (gemini binary OAuth).
// role: "chair" (fast generalist lead) · "coder" · "reasoner" · "frontier" — used for a diverse panel.
export const COUNCIL_ROSTER = [
  {
    id: "qwen3:8b", kind: "local", provider: "ollama-local", model: "qwen3:8b", role: "chair",
    specialty: "Fast Generalist Chair",
    rationale: "82 tok/s resident on the M4 Max — instant, $0, always-on; leads the debate + synthesizes.",
    proof: "MODEL_SELECTION.json singleBest rate 1.0 ('cheapest 100%'); MAC_CHAMPION_TOKS=82 (2026-06-29).",
  },
  {
    id: "qwen3-coder:30b", kind: "local", provider: "ollama-local", model: "qwen3-coder:30b", role: "coder",
    specialty: "Code Reasoner",
    rationale: "Coder-tuned; the seat for algorithmic/code-correctness arguments.",
    proof: "LOCAL_CODER_HINT='coder' + architect/coder role assignment (orchestration vO6 code bench).",
  },
  {
    id: "deepseek-r1:32b", kind: "local", provider: "ollama-local", model: "deepseek-r1:32b", role: "reasoner",
    specialty: "Deep Reasoner",
    rationale: "Explicit chain-of-thought family — the seat for hard logic / multi-step proofs.",
    proof: "DeepSeek-R1 reasoning model (native CoT); installed locally on the M4 Max.",
  },
  {
    id: "gemini-cli", kind: "keyless", provider: "gemini-cli", model: "", role: "frontier",
    specialty: "Keyless Frontier (OAuth)",
    rationale: "Google frontier via the gemini binary — 1M context, 1000/day, $0, no key needed.",
    proof: "Keyless: the `gemini` binary carries Google OAuth; seats whenever the binary is installed.",
  },
  {
    id: "gemini", kind: "cloud", provider: "gemini", model: "gemini-3.5-flash", role: "frontier",
    specialty: "Fastest Frontier",
    rationale: "Lowest-latency frontier reasoner for the decisive turn.",
    proof: "NOTE-model-efficiency: gemini-2.5-pro 4/4 correct @ 28.3s (fastest of the bench). Vault key required.",
  },
  {
    id: "openrouter", kind: "cloud", provider: "openrouter", model: "google/gemini-2.5-flash-lite:free", role: "frontier",
    specialty: "$0 Cloud Aggregator",
    rationale: "Diverse free-tier cloud models — a non-Google perspective at $0.",
    proof: "OpenRouter free models (':free'); seats when the vault has a live OpenRouter key.",
  },
  {
    id: "openai", kind: "cloud", provider: "openai", model: "gpt-4o-mini", role: "frontier",
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
 * Seat a DIVERSE panel of available members: the chair first, then one of each distinct role
 * (coder, reasoner, frontier), then fill remaining slots by roster order — capped at `want`.
 * A member that isn't reachable never sits (it must prove it's alive).
 */
export function selectCouncil(avail, want = 5) {
  const ok = COUNCIL_ROSTER.filter((m) => isAvailable(m, avail));
  const seated = [];
  const takeRole = (role) => { const m = ok.find((x) => x.role === role && !seated.includes(x)); if (m) seated.push(m); };
  takeRole("chair");
  takeRole("coder");
  takeRole("reasoner");
  takeRole("frontier"); // one cloud/keyless frontier for diversity
  for (const m of ok) { if (seated.length >= want) break; if (!seated.includes(m)) seated.push(m); }
  return seated.slice(0, want);
}

/** A one-line seat justification for the convene banner. */
export function seatLine(m) {
  return `${m.model || m.id} — ${m.specialty} · ${m.rationale}`;
}
