import React, { useEffect, useState } from "react";
import { Folder, File, FilePlus, RefreshCw, Save, FolderOpen, Trash2, Edit } from "lucide-react";
import { FileItem } from "../types";

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
      const res = await fetch("/api/workspace/tree");
      if (res.ok) {
        const data = await res.json();
        setTree(data.tree || []);
        if (data.mode) {
          setTreeMode(data.mode);
        }
        if (data.workspaceRoot && data.workspaceRoot !== activePath) {
          onPathChange(data.workspaceRoot);
          setPathInput(data.workspaceRoot);
        }
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
      const res = await fetch("/api/workspace/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathInput.trim() }),
      });
      if (res.ok) {
        onNotify(`Workspace path updated: ${pathInput}`, "success");
        onPathChange(pathInput.trim());
        setEditingFile(null);
      } else {
        onNotify("Failed to verify or write workspace path.", "error");
      }
    } catch (e: any) {
      onNotify(e.message, "error");
    }
  };

  const handleOpenFile = async (relativePath: string) => {
    try {
      const res = await fetch(`/api/workspace/file?relativePath=${encodeURIComponent(relativePath)}`);
      if (res.ok) {
        const data = await res.json();
        setEditingFile(relativePath);
        setEditorContent(data.content);
        onNotify(`Loaded: ${relativePath}`, "info");
      } else {
        onNotify(`Failed to read file contents: ${relativePath}`, "error");
      }
    } catch (e: any) {
      onNotify(e.message, "error");
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    try {
      const res = await fetch("/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePath: editingFile, content: editorContent }),
      });
      if (res.ok) {
        onNotify(`Saved file successfully: ${editingFile}`, "success");
        fetchTree();
      } else {
        onNotify(`Fail to write file: ${editingFile}`, "error");
      }
    } catch (e: any) {
      onNotify(e.message, "error");
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    try {
      const res = await fetch("/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePath: newFileName.trim(), content: "# Fresh Module" }),
      });
      if (res.ok) {
        onNotify(`Created fine: ${newFileName}`, "success");
        setNewFileName("");
        fetchTree();
      }
    } catch (e: any) {
      onNotify(e.message, "error");
    }
  };

  const handleDeleteFile = async (relativePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${relativePath}?`)) return;
    try {
      const res = await fetch(`/api/workspace/file?relativePath=${encodeURIComponent(relativePath)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onNotify(`Deleted: ${relativePath}`, "info");
        if (editingFile === relativePath) {
          setEditingFile(null);
        }
        fetchTree();
      }
    } catch (err: any) {
      onNotify(err.message, "error");
    }
  };

  const getGitColor = (status?: string) => {
    switch (status) {
      case "untracked": return "text-emerald-400 border-emerald-400/20 bg-emerald-500/10";
      case "modified": return "text-amber-400 border-amber-400/20 bg-amber-500/10";
      case "staged": return "text-indigo-400 border-indigo-400/20 bg-indigo-500/10";
      default: return "text-slate-500 border-slate-800 bg-slate-950";
    }
  };

  const renderItem = (item: FileItem) => {
    return (
      <div key={item.relativePath} className="space-y-1 select-none text-xs">
        <div 
          onClick={() => !item.isDirectory && handleOpenFile(item.relativePath)}
          className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition ${
            editingFile === item.relativePath ? "bg-white/5 border-l border-indigo-400" : ""
          }`}
        >
          <div className="flex items-center gap-2 max-w-[80%] overflow-hidden truncate">
            {item.isDirectory ? (
              <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            ) : (
              <File className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
            <span className="text-slate-300 truncate font-mono">{item.name}</span>
            {item.gitStatus && item.gitStatus !== "none" && (
              <span className={`text-[8px] px-1 font-mono rounded border ${getGitColor(item.gitStatus)}`}>
                {item.gitStatus.substring(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          {!item.isDirectory && (
            <button 
              onClick={(e) => handleDeleteFile(item.relativePath, e)}
              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {item.isDirectory && item.children && (
          <div className="pl-3.5 border-l border-white/5 space-y-1">
            {item.children.map((child) => renderItem(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#08090d] border border-white/5 rounded p-5 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-bold text-slate-100 font-mono tracking-wider uppercase">Target Directory Explorer</h2>
        </div>
        <button onClick={fetchTree} disabled={loading} className="text-slate-400 hover:text-white cursor-pointer">
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
          className="flex-1 bg-[#050608] border border-white/5 rounded px-2.5 py-1.5 text-xs text-slate-300 font-mono placeholder-slate-700 focus:outline-none"
        />
        <button 
          onClick={handleSelectWorkspace}
          className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-medium text-xs rounded px-3 py-1.5 transition shrink-0 cursor-pointer"
        >
          Select CWD
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Traversal Tree Side */}
        <div className="bg-black/45 p-4 rounded border border-white/5 max-h-96 overflow-y-auto space-y-2">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="index.js"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="flex-1 bg-[#050608] border border-white/5 rounded text-xs px-2 py-1 text-slate-300 font-mono focus:outline-none placeholder-slate-700"
            />
            <button onClick={handleCreateFile} className="bg-white/5 text-indigo-400 border border-white/10 rounded px-2 hover:bg-white/10 cursor-pointer">
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {tree.length === 0 ? (
            <div className="text-center py-10 text-slate-600 italic text-xs font-mono">
              Workspace path is empty or inaccessible. See settings permissions.
            </div>
          ) : (
            <div className="space-y-1">{tree.map((item) => renderItem(item))}</div>
          )}
        </div>

        {/* Text Area Code Editor */}
        <div className="md:col-span-2 flex flex-col justify-between bg-black/55 border border-white/5 p-4 rounded min-h-[300px]">
          {editingFile ? (
            <div className="flex flex-col h-full flex-grow justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Edit className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-mono font-semibold text-slate-200">{editingFile}</span>
                  </div>
                  <button 
                    onClick={handleSaveFile}
                    className="flex items-center gap-1.5 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded hover:bg-indigo-500/20 transition cursor-pointer font-mono font-bold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </div>
                <textarea
                  rows={14}
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full bg-transparent text-slate-300 font-mono text-xs focus:outline-none p-1 resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center items-center text-center text-slate-500">
              <FolderOpen className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-xs font-mono">Select a file from the explorer on the left to read or write</p>
              {treeMode === "demo" && (
                <span className="text-[10px] mt-1.5 text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
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
