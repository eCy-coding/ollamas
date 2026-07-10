# Model Guide — bring & pick your model

ollamas is local-first: it talks to a local **ollama** engine by default, and to any number of
OpenAI-compatible cloud providers when you add a key. This guide helps you choose a model and bring
your own.

## Quick pick

| Your machine (unified/VRAM) | Comfortable local model | Notes |
|---|---|---|
| 8–16 GB | `qwen3:4b`, `llama3.2:3b` | fast, fits easily; good for chat + light agent work |
| 18–24 GB | **`qwen3:8b`** (default champion) | ≈82 tok/s on M4, resident; best all-round default |
| 32–48 GB | `qwen3-coder:30b`, `deepseek-r1:32b` | strong coding/reasoning; needs headroom |
| 64 GB+ | `llama3.3:70b` | heavy; single-GPU users should run one at a time |

Numbers are rough guidance — actual fit depends on quantization and context length. The cockpit's
model panel ranks installed models by whether they fit your RAM (`size ≤ total × 0.7`).

## Why `qwen3:8b` is the default champion

On a single-GPU Mac with `MAX_LOADED_MODELS=1`, a raw `/api/tags`-order default can land on a large
contending model and thrash to ~0 tok/s. `qwen3:8b` is the benchmarked champion (≈82 tok/s, stays
resident), so ollamas prefers it when installed (`MAC_MODEL_CHAMPION`, `server/ai.ts`). Override with:

```bash
export MAC_MODEL_CHAMPION=qwen3-coder:30b
```

## Single-GPU reality

Local LLM calls are **sequenced, not parallelized** — running two large models at once on one GPU
serializes and is ~3× slower. Keep one champion resident; use `keep_alive` to control how long it
stays loaded.

## Bring your own model

### 1. Pull an ollama model
```bash
ollama pull qwen3:8b        # or any tag from https://ollama.com/library
```
`npm run ready` pulls the default automatically on setup. If no model is installed, ollamas tells you
exactly this command instead of failing silently.

### 2. Point at any OpenAI-compatible endpoint (LM Studio, vLLM, litellm, …)
Pick **Custom (OpenAI-compatible)** in the model picker and set the base URL + key in the Vault. Common
local endpoints:

| Backend | Base URL | Key |
|---|---|---|
| Ollama (`/v1`) | `http://localhost:11434/v1/` | `ollama` |
| LM Studio | `http://localhost:1234/v1` | `lm-studio` |
| vLLM | `http://localhost:8000/v1` | `EMPTY` |

### 3. Free-tier cloud catalog
Add a key in the Vault for any catalog provider (Groq, Cerebras, Mistral, SambaNova, …) and it becomes
selectable in the picker. All are reached through the shared OpenAI-compatible path
(`server/provider-catalog.ts`).

### 4. Import a custom GGUF (fine-tuned / quantized)
Use ollama's `create` with a Modelfile — the practical path for a local `.gguf` file:
```
# Modelfile
FROM /absolute/path/to/your-model.gguf
PARAMETER num_ctx 8192
PARAMETER temperature 0.7
SYSTEM """You are a helpful assistant."""
```
```bash
ollama create my-model -f Modelfile   # then it appears in ollamas' model list
```
Full walkthrough (why the CLI beats HTTP `/api/create` for local files, per-model tuning after
import): [custom-model.md](custom-model.md).

## No key needed for local use

Providers fall back gracefully (ollama → … → demo). You only add keys for cloud providers you want to
use. See [QUICKSTART.md](../QUICKSTART.md) and [troubleshooting.md](troubleshooting.md).
