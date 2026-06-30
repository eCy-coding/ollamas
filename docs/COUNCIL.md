# The ollamas Council — justified roster

The council is a panel of models that **debate a topic live** (rounds where each member reacts to
the others), then a chair synthesizes a **single converged answer**. Run it:

```
ollamas council "<topic>"            # opens a new Terminal.app window, live debate
npm run council "<topic>"            # same
node scripts/council-debate.mjs --here --topic "<topic>"   # inline / headless / CI
```

Flags: `--models a,b,c` (override with explicit local models) · `--rounds 1..5` · `--here` (inline) ·
`--deep` (add the slow local 30B/32B reasoners — see below).

**Default = the FAST proven panel (seconds, not minutes).** Measured on this single-GPU box
(2026-06-30): `qwen3:8b` 5.1s/turn, `gpt-oss:120b-cloud` 1.2s/turn vs the local `qwen3-coder:30b`
34.7s + `deepseek-r1:32b` 47.8s (which often time out). The cloud frontier out-reasons AND
out-paces the local 30B/32B (~40×), so the default council seats a fast generalist chair + diverse
fast frontiers. `--deep` re-includes the slow local coder/reasoner when you want local depth and
have the patience.

## Why each member sits (every seat is proven)

A member only **seats when its backend is actually reachable** — it must prove it's alive (local
model installed · cloud key live in the vault · keyless binary present). Each seat is justified by a
**standout capability** + real **proof**:

| Seat | Model | Kind | Standout capability | Proof |
|---|---|---|---|---|
| **Chair** | `qwen3:8b` | local | Fast generalist, leads + synthesizes | 82 tok/s resident on the M4 Max; `MODEL_SELECTION.json` singleBest rate 1.0 ("cheapest 100%") |
| **Coder** | `qwen3-coder:30b` | local | Algorithmic / code-correctness | coder-tuned (`LOCAL_CODER_HINT`), architect/coder role (vO6 code bench) |
| **Reasoner** | `deepseek-r1:32b` | local | Hard logic / multi-step proofs | DeepSeek-R1 native chain-of-thought |
| **Cloud Frontier** | `gpt-oss:120b-cloud` | local→cloud | ollama.com 120B frontier, $0-key, **0-manual** | `ollama signin` session proxies it via `provider:ollama-local` — NO api key (live-proven) |
| **Keyless Frontier** | `gemini-cli` | keyless | Google frontier, 1M ctx, $0 | the `gemini` binary carries Google OAuth (1000/day) |
| **Fastest Frontier** | `gemini-3.5-flash` | cloud | Lowest-latency frontier, decisive turn | `NOTE-model-efficiency`: gemini-2.5-pro 4/4 @ 28.3s (fastest) |
| **$0 Cloud Aggregator** | `openrouter …:free` | cloud | Non-Google diverse free models | OpenRouter free tier ($0) |
| **Cheap Cloud Generalist** | `gpt-4o-mini` | cloud | Independent broad-coverage opinion | low-cost OpenAI |

The roster lives in `scripts/council-roster.mjs` (`COUNCIL_ROSTER`); `selectCouncil(avail, want, {deep})`
seats the available panel. **Default** = the **fast** members only (chair + diverse fast frontiers).
**`{deep:true}`** also seats the slow local coder + reasoner (30B/32B). Every member carries a
measured `fast` boolean from the latency benchmark above.

## Debate rules (each member's system prompt)
ONE answer · only **real global evidence** (math / science / code) · honest **"fikrim yok"** when
there is no evidence · **no guessing / no derivation** · terse · converge. A member that errors or
times out is **skipped honestly** (never a fabricated turn). Local turns 60s, cloud/synthesis 45s.

## Dispatch
- **Local** members → `ollama /api/chat` (direct, `localhost:11434`).
- **Cloud / keyless** members → the ollamas gateway `/api/generate {provider, model, stream:true}`
  (uses the AES-256-GCM vault key + the ProviderRouter). Auto-detected: `OLLAMAS_GATEWAY` → :3000 → :3020.
  No gateway up → cloud members are skipped; the local panel still debates.
- **0-manual ollama.com cloud (no API key):** once the operator runs `ollama signin`, the local
  ollama proxies `:cloud` models (`gpt-oss:120b-cloud`, `kimi-k2.5:cloud`, `qwen3-coder:480b-cloud`)
  through `provider:ollama-local` — frontier cloud at **$0 key, zero manual**, the sustainable path.
  A Bearer ollama-cloud API key (web-minted at ollama.com/settings/keys, guided in KeyVault) is an
  ALTERNATE for headless/external use; it can't be minted 0-manual (the `ollama` CLI has no keys cmd).
