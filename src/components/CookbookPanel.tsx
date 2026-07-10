import { useEffect, useState } from "react";
import { BookOpen, Play, Loader2, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "../lib/apiClient";

// Cookbook (P1) — hardware-aware recipe runner. Lists saved instruction templates,
// runs one against the $0-local model, and streams the answer over SSE. Honest empty
// states; the panel never assumes the model is up (execute surfaces the error frame).

interface Recipe {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tags: string[];
  model?: string;
}
interface RecipeExecution {
  id: string;
  recipeId: string;
  createdAt: string;
  status: "running" | "done" | "error";
  output: string;
  model: string;
}

export function CookbookPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null); // active recipe id, or null
  const [output, setOutput] = useState<string>("");
  const [history, setHistory] = useState<RecipeExecution[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api
      .get<Recipe[]>("/api/cookbook")
      .then((data) => { if (alive) setRecipes(data); })
      .catch((e) => { if (alive) { setError(String((e as Error)?.message || e)); onNotify?.("Failed to load recipes", "error"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [onNotify]);

  const loadHistory = async (recipeId: string) => {
    try { setHistory(await api.get<RecipeExecution[]>(`/api/cookbook/${recipeId}/executions?limit=10`, { soft: true })); }
    catch { /* history is best-effort */ }
  };

  const run = async (recipe: Recipe) => {
    setSelected(recipe.id);
    setExecuting(recipe.id);
    setOutput("");
    setError("");
    let buf = "";
    try {
      await api.streamPost(
        `/api/cookbook/${recipe.id}/execute`,
        { userInput: "" },
        {
          onChunk: (text: string) => {
            buf += text;
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data:")) continue;
              try {
                const frame = JSON.parse(line.slice(5).trim());
                if (frame.chunk) setOutput((o) => o + frame.chunk);
                else if (frame.error) { setError(frame.error); onNotify?.(frame.error, "error"); }
              } catch { /* partial/garbage frame — ignore */ }
            }
          },
        },
      );
      onNotify?.("Recipe complete", "success");
    } catch (e) {
      setError(String((e as Error)?.message || e));
      onNotify?.("Recipe failed", "error");
    } finally {
      setExecuting(null);
      void loadHistory(recipe.id);
    }
  };

  const copyOutput = () => {
    void navigator.clipboard?.writeText(output);
    onNotify?.("Copied", "info");
  };

  return (
    <div className="space-y-6 p-6 bg-immersive-sidebar border border-immersive-border rounded">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-immersive-text-bright">Recipe Library</h2>
        <span className="text-xs text-immersive-text-muted">· qwen3:8b · $0 local</span>
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-status-err/10 border border-status-err/30 rounded text-status-err text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-immersive-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading recipes…
        </div>
      ) : recipes.length === 0 ? (
        <div className="py-10 text-center text-immersive-text-muted text-sm">No recipes yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {recipes.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`p-4 border rounded cursor-pointer transition-colors ${
                selected === r.id
                  ? "bg-indigo-500/10 border-indigo-500/50"
                  : "bg-immersive-panel border-immersive-border hover:border-indigo-400/40"
              }`}
            >
              <h3 className="font-medium text-immersive-text-bright mb-1">{r.name}</h3>
              <p className="text-xs text-immersive-text-muted mb-3">{r.description}</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {r.tags.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-300 text-[10px] rounded">{t}</span>
                ))}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); void run(r); }}
                disabled={executing === r.id}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm font-medium transition-colors disabled:opacity-50"
              >
                {executing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Run
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-immersive-text-bright">Output</h3>
            {output && (
              <button onClick={copyOutput} className="flex items-center gap-1 text-xs text-immersive-text-muted hover:text-immersive-text-bright">
                <Copy className="w-3 h-3" /> Copy
              </button>
            )}
          </div>
          <pre className="p-4 bg-immersive-panel border border-immersive-border rounded font-mono text-xs text-immersive-text-dim max-h-80 overflow-auto whitespace-pre-wrap break-words">
            {output || (executing ? "Streaming…" : "Run a recipe to see output.")}
          </pre>
        </div>
      )}

      {selected && history.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-immersive-text-bright">History</h3>
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between p-2 bg-immersive-panel border border-immersive-border/50 rounded text-xs">
              <span className="text-immersive-text-muted">{new Date(h.createdAt).toLocaleTimeString()} · {h.model}</span>
              {h.status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-status-ok" /> : h.status === "error" ? <AlertCircle className="w-3.5 h-3.5 text-status-err" /> : <Loader2 className="w-3.5 h-3.5 animate-spin text-immersive-text-muted" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
