// O7 cookbook router — mounted by the registry at /api/modules/cookbook (scoped
// Router; inherits localOwnerGuard via the single /api/modules prefix, INV-O0-1).
// Every route is thin: validate → service → json. bench flows through the
// ToolRegistry choke-point; pull proxies ollama's NDJSON as SSE (M-037).
import type { Router } from "express";
import { ToolRegistry } from "../../tool-registry";
import { execOnHost, shArg } from "../../host-bridge";
import { parseBenchInput, sanitizeModelName } from "./schema";
import { detectHardware, recommend, benchModel, configFor } from "./service";
import { benchMap, setBench, persisted } from "./store";

/** Resolve the ollama base (same candidates server.ts prefers). */
function ollamaBase(): string {
  return process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
}

/** Installed + loaded models via ollama; graceful-empty on any failure. */
async function discoverModels(timeoutMs = 2500): Promise<{ installed: string[]; loaded: string[]; reachable: boolean }> {
  try {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) }),
      fetch(`${ollamaBase()}/api/ps`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null),
    ]);
    if (!tagsRes.ok) return { installed: [], loaded: [], reachable: false };
    const tags = (await tagsRes.json()) as { models?: { name?: string }[] };
    const ps = psRes && psRes.ok ? ((await psRes.json()) as { models?: { name?: string }[] }) : { models: [] };
    return {
      installed: (tags.models ?? []).map((m) => m.name ?? "").filter(Boolean),
      loaded: (ps.models ?? []).map((m) => m.name ?? "").filter(Boolean),
      reachable: true,
    };
  } catch {
    return { installed: [], loaded: [], reachable: false };
  }
}

export function mountCookbookRoutes(router: Router): void {
  router.get("/hardware", (_req, res) => {
    res.json(detectHardware());
  });

  router.get("/recommend", async (_req, res) => {
    const hw = detectHardware();
    const { installed } = await discoverModels();
    res.json(recommend(hw, installed, benchMap()));
  });

  router.get("/discover", async (_req, res) => {
    const d = await discoverModels();
    if (!d.reachable) {
      res.status(503).json({ models: [], loaded: [], reason: "ollama runtime unreachable" });
      return;
    }
    res.json({ models: d.installed, loaded: d.loaded });
  });

  router.get("/config", (req, res) => {
    let model: string;
    try {
      model = sanitizeModelName(req.query.model);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    // Apply via the EXISTING POST /api/model-overrides (reuse; no new persistence here).
    res.json({ model, override: configFor(detectHardware(), model) });
  });

  router.post("/bench", async (req, res) => {
    let input: { model: string; n_tokens?: number };
    try {
      input = parseBenchInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const r = await benchModel(input, {
      execute: (name, args, ctx) => ToolRegistry.execute(name, args, ctx as never),
      hostDeps: { execOnHost, shArg },
    });
    if ("result" in r) {
      setBench(r.result.model ?? input.model, r.result);
      res.json({ ...r.result, persisted });
    } else {
      res.status(r.status).json({ error: r.error });
    }
  });

  // Guided install — proxy ollama POST /api/pull (NDJSON) as SSE progress (M-037).
  router.post("/pull", async (req, res) => {
    let model: string;
    try {
      model = sanitizeModelName((req.body as { model?: unknown })?.model);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    try {
      const upstream = await fetch(`${ollamaBase()}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!upstream.ok || !upstream.body) {
        send({ type: "error", message: `ollama pull failed (${upstream.status})` });
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done: rd } = await reader.read();
        if (rd) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let frame: { status?: string; total?: number; completed?: number; error?: string };
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          if (frame.error) {
            send({ type: "error", message: frame.error });
            continue;
          }
          const pct = frame.total ? Math.round(((frame.completed ?? 0) / frame.total) * 100) : undefined;
          send({ type: "progress", status: frame.status, pct });
          // Only a real "success" status marks the model installed (no fake-installed).
          if (frame.status === "success") done = true;
        }
      }
      send(done ? { type: "done", model } : { type: "error", message: "pull ended without success" });
      res.end();
    } catch (e) {
      send({ type: "error", message: (e as Error).message });
      res.end();
    }
  });
}
