import React, { useEffect, useState } from "react";
import { Folder, File, FilePlus, RefreshCw, Save, FolderOpen, Trash2, Edit } from "lucide-react";
import { FileItem } from "../types";
import { api, ApiError } from "../lib/apiClient";

interface WorkspaceTreeProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  activePath: string;
  onPathChange: (newPath: string) => void;
  isLive: boolean;
}

export const WorkspaceTree: React.FC<WorkspaceTreeProps> = ({ onNotify, activePath, onPathChange, isLive }) => {
  const [tree, setTree] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [pathInput, setPathInput] = useState(activePath);
  const [treeMode, setTreeMode] = useState<string>("demo");

  const fetchTree = async () => {
    setLoading(true);
    try {
      const data: any = await api.get("/api/workspace/tree");
      setTree(data.tree || []);
      if (data.mode) {
        setTreeMode(data.mode);
      }
      if (data.workspaceRoot && data.workspaceRoot !== activePath) {
        onPathChange(data.workspaceRoot);
        setPathInput(data.workspaceRoot);
      }
    } catch (e) {
      console.error("Failed to load workspace files tree.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [activePath]);

  const handleSelectWorkspace = async () => {
    if (!pathInput.trim()) return;
    try {
      await api.post("/api/workspace/select", { path: pathInput.trim() });
      onNotify(`Workspace path updated: ${pathInput}`, "success");
      onPathChange(pathInput.trim());
      setEditingFile(null);
    } catch (e: any) {
      if (e instanceof ApiError) {
        onNotify("Failed to verify or write workspace path.", "error");
      } else {
        onNotify(e.message, "error");
      }
    }
  };

  const handleOpenFile = async (relativePath: string) => {
    try {
      const data: any = await api.get(`/api/workspace/file?relativePath=${encodeURIComponent(relativePath)}`);
      setEditingFile(relativePath);
      setEditorContent(data.content);
      onNotify(`Loaded: ${relativePath}`, "info");
    } catch (e: any) {
      if (e instanceof ApiError) {
        onNotify(`Failed to read file contents: ${relativePath}`, "error");
      } else {
        onNotify(e.message, "error");
      }
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      await api.post("/api/workspace/file", { relativePath: editingFile, content: editorContent });
      onNotify(`Saved file successfully: ${editingFile}`, "success");
      fetchTree();
    } catch (e: any) {
      if (e instanceof ApiError) {
        onNotify(`Fail to write file: ${editingFile}`, "error");
      } else {
        onNotify(e.message, "error");
      }
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    try {
      await api.post("/api/workspace/file", { relativePath: newFileName.trim(), content: "# Fresh Module" });
      onNotify(`Created fine: ${newFileName}`, "success");
      setNewFileName("");
      fetchTree();
    } catch (e: any) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(e instanceof ApiError)) {
        onNotify(e.message, "error");
      }
    }
  };

  const handleDeleteFile = async (relativePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${relativePath}?`)) return;
    try {
      await api.del(`/api/workspace/file?relativePath=${encodeURIComponent(relativePath)}`);
      onNotify(`Deleted: ${relativePath}`, "info");
      if (editingFile === relativePath) {
        setEditingFile(null);
      }
      fetchTree();
    } catch (err: any) {
      // non-ok previously fell through silently; only surface non-ApiError (network) failures
      if (!(err instanceof ApiError)) {
        onNotify(err.message, "error");
      }
    }
  };

  const getGitColor = (status?: string) => {
    switch (status) {
      case "untracked": return "text-status-ok border-emerald-400/20 bg-emerald-500/10";
      case "modified": return "text-status-warn border-amber-400/20 bg-amber-500/10";
      case "staged": return "text-status-accent border-indigo-400/20 bg-indigo-500/10";
      default: return "text-immersive-text-dim border-immersive-border bg-immersive-bg";
    }
  };

  const renderItem = (item: FileItem) => {
    return (
      <div key={item.relativePath} className="space-y-1 select-none text-xs">
        <div
          role="button"
          tabIndex={0}
          onClick={() => !item.isDirectory && handleOpenFile(item.relativePath)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!item.isDirectory) handleOpenFile(item.relativePath);
            }
          }}
          className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition ${
            editingFile === item.relativePath ? "bg-white/5 border-l border-indigo-400" : ""
          }`}
        >
          <div className="flex items-center gap-2 max-w-[80%] overflow-hidden truncate">
            {item.isDirectory ? (
              <Folder className="w-3.5 h-3.5 text-status-accent shrink-0" />
            ) : (
              <File className="w-3.5 h-3.5 text-immersive-text-muted shrink-0" />
            )}
            <span className="text-immersive-text-muted truncate font-mono">{item.name}</span>
            {item.gitStatus && item.gitStatus !== "none" && (
              <span className={`text-[8px] px-1 font-mono rounded border ${getGitColor(item.gitStatus)}`}>
                {item.gitStatus.substring(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          {!item.isDirectory && (
            <button 
              onClick={(e) => handleDeleteFile(item.relativePath, e)}
              className="text-immersive-text-dim hover:text-status-err opacity-0 group-hover:opacity-100 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {item.isDirectory && item.children && (
          <div className="pl-3.5 border-l border-immersive-border space-y-1">
            {item.children.map((child) => renderItem(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-status-accent" />
          <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Target Directory Explorer</h2>
        </div>
        <button aria-label="Refresh file tree" onClick={fetchTree} disabled={loading} className="text-immersive-text-muted hover:text-immersive-text-bright cursor-pointer">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Directory controller */}
      <div className="flex gap-2 mb-5">
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          placeholder="/users/macbook/projects/workspace"
          className="flex-1 bg-immersive-bg border border-immersive-border rounded px-2.5 py-1.5 text-xs text-immersive-text-muted font-mono placeholder-slate-700 focus:outline-none"
        />
        <button 
          onClick={handleSelectWorkspace}
          className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono font-medium text-xs rounded px-3 py-1.5 transition shrink-0 cursor-pointer"
        >
          Select CWD
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Traversal Tree Side */}
        <div className="bg-immersive-inset p-4 rounded border border-immersive-border max-h-96 overflow-y-auto space-y-2">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="index.js"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="flex-1 bg-immersive-bg border border-immersive-border rounded text-xs px-2 py-1 text-immersive-text-muted font-mono focus:outline-none placeholder-slate-700"
            />
            <button aria-label="Create file" onClick={handleCreateFile} className="bg-white/5 text-status-accent border border-immersive-border-strong rounded px-2 hover:bg-white/10 cursor-pointer">
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {tree.length === 0 ? (
            <div className="text-center py-10 text-immersive-text-dim italic text-xs font-mono">
              Workspace path is empty or inaccessible. See settings permissions.
            </div>
          ) : (
            <div className="space-y-1">{tree.map((item) => renderItem(item))}</div>
          )}
        </div>

        {/* Text Area Code Editor */}
        <div className="md:col-span-2 flex flex-col justify-between bg-immersive-inset border border-immersive-border p-4 rounded min-h-[300px]">
          {editingFile ? (
            <div className="flex flex-col h-full flex-grow justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-immersive-border pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Edit className="w-4 h-4 text-status-accent" />
                    <span className="text-xs font-mono font-semibold text-immersive-text-bright">{editingFile}</span>
                  </div>
                  <button 
                    onClick={handleSaveFile}
                    className="flex items-center gap-1.5 text-xs text-status-accent bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded hover:bg-indigo-500/20 transition cursor-pointer font-mono font-bold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
                <textarea
                  rows={14}
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full bg-transparent text-immersive-text-muted font-mono text-xs focus:outline-none p-1 resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-center text-immersive-text-dim">
              <FolderOpen className="w-8 h-8 text-immersive-text-dim mb-2" />
              <p className="text-xs font-mono">Select a file from the explorer on the left to read or write</p>
              {treeMode === "demo" && (
                <span className="text-[10px] mt-1.5 text-status-info bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
                  DEMO Workspace emulated
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
