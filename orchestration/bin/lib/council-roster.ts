// council-roster — pure capability→model→lane assignment (0-manuel model council).
//
// A "seat" = one responsibility area (e.g. root-cause reasoning) with an ORDERED list of
// preferred models. `buildRoster(available)` picks the first model that is actually pulled
// (live `ollama list`), marking the seat present/absent. No IO, no model calls → fully
// unit-testable. The CLI (bin/council.ts) feeds live availability in and dispatches only the
// present seats. Absent seats are surfaced (never silently dropped — AGENTS.md §2.5).
//
// Lanes mirror shared.ts KNOWN_LANES (the 7 worktree lanes). A seat lists the lanes it is
// responsible for analysing; a lane is "covered" if ≥1 present seat lists it.

export type Capability =
  | "deep-code" | "long-ctx-code" | "local-code" | "reasoning" | "vision"
  | "moe-mid" | "fast-verify" | "cheap-triage" | "adversarial" | "big-reasoning"
  | "cloud-alt" | "small-logic" | "embedding" | "custom-review";

export type SeatRole =
  | "architect" | "coder" | "reviewer" | "verifier" | "analyst" | "adversary" | "search" | "triage";

export interface SeatSpec {
  capability: Capability;
  models: string[];       // ordered preference; first available wins
  role: SeatRole;
  responsibility: string; // human-readable area
  lanes: string[];        // KNOWN_LANES this seat analyses
}

export interface Seat {
  capability: Capability;
  role: SeatRole;
  responsibility: string;
  lanes: string[];
  model: string | null;   // resolved available model, or null if none pulled
  available: boolean;
}

export interface Roster {
  seats: Seat[];
  present: number;
  absentCapabilities: Capability[];
  lanesCovered: string[];
  lanesUncovered: string[];
}

// 7 worktree lanes (shared.ts KNOWN_LANES). Kept here as a literal so this module stays IO-free.
export const LANES = ["backend", "frontend", "cli", "scripts", "integrations", "bench", "orchestration"];

// Capability→model preference. Ordered: strongest/cheapest-appropriate first, then fallbacks.
// Cloud tags cost no local RAM (host is RAM-bound) so they lead where correctness matters.
// Every analysis seat carries capability-matched FREE-tier `provider::model` fallbacks
// (key-gated via /api/keys/pool) AFTER its local tags, so a failed `ollama list` (launchd
// PATH, GPU hiccup) or true ollama outage cannot collapse the council while keys are live.
// Provider load spread honors free-tier quotas: cerebras (1M tok/day) heavy code/reasoning,
// groq (fast, ~1K RPD) short verify/triage, zai (200K ctx) long-context sweeps,
// github-models (~50 RPD) sparse last-resort only.
export const SEAT_SPEC: SeatSpec[] = [
  { capability: "deep-code", role: "architect", responsibility: "Derin kod-tasarım + mimari (server/backend, protocol)",
    lanes: ["backend", "integrations"], models: ["qwen3-coder:480b-cloud", "qwen3-coder:30b", "qwen3-coder-64k:latest",
      "cerebras::gpt-oss-120b", "zai::glm-4.7-flash"] },
  { capability: "long-ctx-code", role: "analyst", responsibility: "Uzun/çok-dosya kod sweep (64k ctx whole-lane)",
    lanes: ["backend", "orchestration"], models: ["qwen3-coder-64k:latest", "qwen3-coder:30b",
      "zai::glm-4.7-flash"] },
  { capability: "local-code", role: "coder", responsibility: "cli/scripts lane kod analizi + bug-detect",
    lanes: ["cli", "scripts"], models: ["qwen3-coder:30b", "qwen3-coder-64k:latest",
      "cerebras::gpt-oss-120b", "groq::llama-3.3-70b-versatile"] },
  { capability: "reasoning", role: "verifier", responsibility: "Root-cause + mantıksal invariant + algoritma doğrulama",
    lanes: LANES, models: ["deepseek-r1:32b", "qwen3:30b-a3b",
      "cerebras::gpt-oss-120b", "github-models::openai/gpt-4o-mini"] },
  { capability: "vision", role: "analyst", responsibility: "web/frontend UI + diagram + screenshot analizi",
    lanes: ["frontend"], models: ["qwen2.5vl:32b", "qwen2.5vl:7b",
      "github-models::openai/gpt-4o-mini"] },
  { capability: "moe-mid", role: "analyst", responsibility: "orchestration lane + cross-lane dep-graph",
    lanes: ["orchestration"], models: ["qwen3:30b-a3b", "gpt-oss:20b",
      "zai::glm-4.7-flash"] },
  { capability: "fast-verify", role: "reviewer", responsibility: "Hızlı review + council verifier koltuğu (champion)",
    lanes: LANES, models: ["qwen3:8b", "qwen3:8b-16k", "qwen3:4b",
      "groq::llama-3.3-70b-versatile"] },
  { capability: "cheap-triage", role: "triage", responsibility: "Bulgu sınıflandırma + önceliklendirme",
    lanes: LANES, models: ["qwen3:4b", "phi4:latest",
      "groq::llama-3.3-70b-versatile"] },
  { capability: "adversarial", role: "adversary", responsibility: "Adversarial ikinci-görüş (best-of-N refute)",
    lanes: LANES, models: ["gpt-oss:120b-cloud", "gpt-oss:20b", "gpt-oss:20b-cloud",
      "cerebras::gpt-oss-120b"] },
  { capability: "big-reasoning", role: "adversary", responsibility: "Bağımsız çapraz-kontrol (majority-vote üyesi)",
    lanes: LANES, models: ["llama3.3:70b", "deepseek-r1:32b",
      "cerebras::gpt-oss-120b"] },
  { capability: "cloud-alt", role: "analyst", responsibility: "Cloud yük dengeleme / paralel koltuk (bench)",
    lanes: ["bench"],
    // Ollama-cloud tags first (proven seats); then FREE-tier API providers (server
    // PROVIDER_CATALOG) as key-gated fallbacks — `provider::model` entries resolve by key
    // liveness (/api/keys/pool), not `ollama list`. Zero keys → behavior unchanged.
    models: ["kimi-k2.5:cloud", "qwen3-coder:480b-cloud",
      "groq::llama-3.3-70b-versatile", "cerebras::gpt-oss-120b", "zai::glm-4.7-flash"] },
  { capability: "small-logic", role: "analyst", responsibility: "Hafif mantık kontrolü (scripts)",
    lanes: ["scripts"], models: ["phi4:latest", "qwen3:4b",
      "groq::llama-3.3-70b-versatile"] },
  // embedding needs the /embed endpoint (chat façade can't serve it) → local-only by design.
  { capability: "embedding", role: "search", responsibility: "Semantik kod-arama + duplikat tespiti",
    lanes: LANES, models: ["nomic-embed-text:latest", "nomic-embed-text"] },
  // custom-review is a local fine-tune by definition — remote can't be the fine-tune → local-only.
  { capability: "custom-review", role: "reviewer", responsibility: "Proje-özel fine-tuned review",
    lanes: LANES, models: ["ollamas-reviewer:latest", "qwen3:8b"] },
];

/** Parse an API-routed model entry `provider::model` (free-tier catalog seats). Plain
 *  ollama tags (single `:`; `hf.co/...` paths) return null. Both halves must be non-empty. */
export function parseApiModel(entry: string): { provider: string; model: string } | null {
  const i = entry.indexOf("::");
  if (i <= 0) return null;
  const provider = entry.slice(0, i);
  const model = entry.slice(i + 2);
  if (!provider || !model) return null;
  return { provider, model };
}

/** Resolve the first available model for a seat: ollama tags match live `ollama list`;
 *  `provider::model` entries match a KEY-LIVE provider (readyApiProviders ← /api/keys/pool). */
export function resolveSeat(spec: SeatSpec, available: Set<string>, readyApiProviders: Set<string> = new Set()): Seat {
  const model = spec.models.find((m) => {
    const api = parseApiModel(m);
    return api ? readyApiProviders.has(api.provider) : available.has(m);
  }) ?? null;
  return {
    capability: spec.capability, role: spec.role, responsibility: spec.responsibility,
    lanes: spec.lanes, model, available: model !== null,
  };
}

/** Build the full roster from pulled model tags + key-live API providers (order-independent). */
export function buildRoster(availableModels: string[], readyApiProviders: string[] = []): Roster {
  const available = new Set((availableModels ?? []).map((m) => String(m).trim()).filter(Boolean));
  const readyApi = new Set((readyApiProviders ?? []).map((p) => String(p).trim()).filter(Boolean));
  const seats = SEAT_SPEC.map((s) => resolveSeat(s, available, readyApi));
  const present = seats.filter((s) => s.available).length;
  const absentCapabilities = seats.filter((s) => !s.available).map((s) => s.capability);
  const coveredSet = new Set<string>();
  for (const s of seats) if (s.available) for (const l of s.lanes) coveredSet.add(l);
  const lanesCovered = LANES.filter((l) => coveredSet.has(l));
  const lanesUncovered = LANES.filter((l) => !coveredSet.has(l));
  return { seats, present, absentCapabilities, lanesCovered, lanesUncovered };
}

/** Present seats responsible for a given lane (for dispatch fan-out). */
export function seatsForLane(roster: Roster, lane: string): Seat[] {
  return roster.seats.filter((s) => s.available && s.lanes.includes(lane));
}
