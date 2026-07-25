# Role card — ollamas

> Mission-control: the local brain + LLM router + orchestration surface.

- **Mandate:** be the $0 inference + gateway + DAG orchestration layer for the whole platform.
- **Identity/path:** `~/Desktop/ollamas` · server `:3000` · CLI `cli/index.ts` · pipeline `pipeline/bin/*`.
- **Owns (writes):** `/v1/chat/completions` router responses, `/mcp` gateway, `/api/*`, benchmark
  outputs, orchestration state (`orchestration/**`).
- **Interfaces:** `POST :3000/v1/chat/completions` (free providers, $0) · `ALL :3000/mcp` · `ollamas
  tasks` / `do "<id>"` (`orchestration/TASKS.json`, 339) · `ollamas pipeline board|plan|watch`.
- **In the dev-council:** the **$0 LLM worker** — does bench compute + bulk classification for
  SESSION-B's research/suggestions; holds a **council seat** (reward ledger, `orchestra/council.md`).
- **Boundaries:** invoked, not autonomous; runtime health-gated (`:3000` may be down → `ollamas
  doctor`); never touches `com.ecy*`.
- **Backlog phase:** 2 (Mission-Control & LLM Router). Source: `README.md`, `pipeline/PROMPT.md`.
