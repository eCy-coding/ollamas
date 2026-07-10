import { useEffect, useState } from "react";
import { FileText, Upload, RefreshCw, Save, Download, Loader2, AlertCircle, File as FileIcon } from "lucide-react";
import { api } from "../lib/apiClient";
import type { FileItem } from "../types";

// Documents (P1) — a document-centric view over the existing workspace file APIs
// (/api/workspace/{tree,file,upload,download}). Edits text/markdown in a textarea
// and saves; binary files (PDF/DOCX/…) are download-only with an honest "no preview"
// state (no extraction dep installed). All content rendered escaped — no XSS surface.

const TEXT_EXT = new Set([
  "md", "markdown", "txt", "text", "log", "csv", "tsv", "json", "jsonc", "yml", "yaml", "toml", "ini", "env",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "less", "html", "htm", "xml", "svg",
  "py", "sh", "bash", "zsh", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "sql", "gitignore", "dockerfile",
]);
const isText = (name: string): boolean => {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : name.toLowerCase();
  return TEXT_EXT.has(ext);
};
function flatten(items: FileItem[], acc: FileItem[] = []): FileItem[] {
  for (const it of items) {
    if (it.isDirectory) flatten(it.children ?? [], acc);
    else acc.push(it);
  }
  return acc;
}

export function DocumentsPanel({ onNotify }: { onNotify?: (msg: string, type?: "success" | "error" | "info") => void }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadTree = async () => {
    setLoading(true); setError("");
    try {
      const data = await api.get<{ tree?: FileItem[] }>("/api/workspace/tree");
      setFiles(flatten(data.tree ?? []));
    } catch (e) {
      setError(String((e as Error)?.message || e));
      onNotify?.("Failed to load workspace", "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadTree(); }, []);

  const open = async (f: FileItem) => {
    setSelected(f); setDirty(false); setContent(""); setError("");
    if (!isText(f.name)) return; // binary → download-only, no fetch
    try {
      const data = await api.get<{ content?: string }>(`/api/workspace/file?relativePath=${encodeURIComponent(f.relativePath)}`);
      setContent(data.content ?? "");
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post("/api/workspace/file", { relativePath: selected.relativePath, content });
      setDirty(false);
      onNotify?.("Saved", "success");
    } catch (e) {
      onNotify?.(`Save failed: ${(e as Error)?.message || e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    try {
      await api.uploadFile(file.name, file);
      onNotify?.(`Uploaded ${file.name}`, "success");
      void loadTree();
    } catch (e) {
      onNotify?.(`Upload failed: ${(e as Error)?.message || e}`, "error");
    }
  };

  const download = async (f: FileItem) => {
    try {
      const blob = await api.downloadFile(f.relativePath);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onNotify?.(`Download failed: ${(e as Error)?.message || e}`, "error");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6 bg-immersive-sidebar border border-immersive-border rounded">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-semibold text-immersive-text-bright">Documents</h2>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" /> Upload
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
          <button onClick={() => void loadTree()} className="flex items-center gap-1.5 px-3 py-1.5 bg-immersive-panel border border-immersive-border hover:border-indigo-400/40 text-immersive-text-muted rounded text-sm transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-status-err/10 border border-status-err/30 rounded text-status-err text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 min-h-[24rem]">
        {/* File list */}
        <div className="bg-immersive-panel border border-immersive-border rounded overflow-auto max-h-[28rem]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-immersive-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : files.length === 0 ? (
            <div className="py-8 text-center text-immersive-text-muted text-sm">No files in workspace.</div>
          ) : (
            files.map((f) => (
              <button
                key={f.relativePath}
                onClick={() => void open(f)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  selected?.relativePath === f.relativePath ? "bg-indigo-500/10 text-indigo-300" : "text-immersive-text-muted hover:bg-immersive-sidebar"
                }`}
              >
                {isText(f.name) ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <FileIcon className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{f.relativePath}</span>
              </button>
            ))
          )}
        </div>

        {/* Editor / binary view */}
        <div className="flex flex-col gap-2 min-w-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-immersive-text-muted text-sm border border-immersive-border/50 rounded">
              Select a file to view or edit.
            </div>
          ) : isText(selected.name) ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-immersive-text-bright truncate">{selected.relativePath}</span>
                {dirty && <span className="text-xs text-status-warn">● unsaved</span>}
                <button
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm disabled:opacity-40 transition-colors"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                </button>
              </div>
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                spellCheck={false}
                className="flex-1 min-h-[20rem] p-3 bg-immersive-inset border border-immersive-border rounded font-mono text-xs text-immersive-text-dim resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-pre"
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-immersive-text-muted text-sm border border-immersive-border/50 rounded p-6">
              <FileIcon className="w-8 h-8" />
              <div className="text-center">
                <div className="text-immersive-text-bright font-mono text-xs">{selected.relativePath}</div>
                <div className="mt-1">Binary file — no inline preview. Download to view.</div>
              </div>
              <button onClick={() => void download(selected)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 rounded text-sm transition-colors">
                <Download className="w-3.5 h-3.5" /> Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
