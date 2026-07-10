# Custom Model Import — GGUF → Modelfile → ollamas

You can bring any local GGUF file (a fine-tune, a custom quantization, a model not in the
ollama library) into ollamas in three steps: wrap it in a **Modelfile**, register it with
`ollama create`, and it appears in every ollamas model dropdown automatically. For choosing
between ready-made models and sizing them to your RAM, see the
[Model Guide](model-guide.md) — this page covers the custom-import path in depth.

## 1. Get a GGUF file

Any GGUF works — quantized community builds from Hugging Face, your own fine-tune exported
with llama.cpp's `convert` + `quantize`, or a re-quantization of an existing model. Prefer
`Q4_K_M`/`Q5_K_M` quants for the best size/quality trade-off on Apple Silicon. Keep the file
at a stable absolute path (the Modelfile references it).

## 2. Write a Modelfile

A Modelfile is to a model what a Dockerfile is to an image — base weights plus baked-in
defaults:

```
FROM /Users/x/models/qwen.gguf
PARAMETER temperature 0.7
PARAMETER num_ctx 8192
SYSTEM """You are a helpful assistant."""
```

- `FROM` — absolute path to the GGUF (or an existing model tag to derive from).
- `PARAMETER` — default inference options (`num_ctx`, `temperature`, `top_p`, …). These are
  the model's defaults; ollamas can still override them per request (see step 5).
- `SYSTEM` — a baked-in system prompt, applied whenever no explicit system message is sent.

Full syntax: [ollama Modelfile reference](https://docs.ollama.com/modelfile).

## 3. Create the model — use the CLI

```bash
ollama create my-model -f Modelfile
ollama run my-model "hello"        # smoke-check it loads and answers
```

> **Why the CLI and not the HTTP API?** ollama's HTTP `POST /api/create` cannot read a GGUF
> path off your disk: the file must first be uploaded as a blob (`POST /api/blobs/sha256:<digest>`
> with the file's sha256) and then referenced by digest in the create request. The CLI does the
> hashing, upload, and registration in one step — so `ollama create -f` is the recommended
> practical route for local files.

## 4. It appears in ollamas

ollamas lists local models live from ollama's `/api/tags` — no restart, no config. After
`ollama create` succeeds, `my-model` shows up in the model dropdown (ReAct agent tab and
everywhere else a model is picked) and in the cockpit's Local Models panel, ranked by whether
it fits your RAM.

```bash
curl -s http://localhost:11434/api/tags | grep my-model   # verify it's served
```

## 5. Tune it per-model in the UI

The Modelfile's `PARAMETER` lines are only defaults. To tune the imported model without
rebuilding it, open **Model Settings** next to the model dropdown and set per-model overrides:

- **Context window** (`num_ctx`) — sent as `options.num_ctx` on every request
- **Temperature** — `options.temperature`
- **Keep-alive** — how long the model stays resident in VRAM (`"10m"`, `"0"` unload now,
  `"-1"` forever)
- **System prompt** — prepended when the conversation carries none

Overrides persist server-side and apply to every chat/agent request for that model tag.
Explicit per-request values still win over the override; blank fields clear it.

## Sizing reminder

A custom GGUF obeys the same physics as a library model: it should fit in ≤70% of unified
memory to stay resident, and one large model at a time on a single GPU. See the
[Model Guide](model-guide.md#quick-pick) sizing table and the single-GPU notes there.
