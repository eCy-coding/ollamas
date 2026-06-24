import React, { useRef, useState } from "react";
import { Upload, Download, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/apiClient";

interface FileTransferProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

// Binary-safe workspace file transfer (P1). Drag-drop / pick any file type to upload
// into a workspace subdir, or download any workspace file by path. Streams through
// the binary /api/workspace/upload + /download routes (not the utf-8 JSON file API),
// so images/archives/binaries round-trip uncorrupted.
export const FileTransfer: React.FC<FileTransferProps> = ({ onNotify }) => {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dir, setDir] = useState("uploads");
  const [downloadPath, setDownloadPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const base = dir.trim().replace(/\/+$/, "");
        const rel = base ? `${base}/${file.name}` : file.name;
        const r = await api.uploadFile(rel, file);
        onNotify(`Uploaded ${r.path} (${r.bytes} bytes)`, "success");
      }
    } catch (e: any) {
      onNotify(e instanceof ApiError ? `Upload failed (${e.status})` : String(e?.message || e), "error");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDownload = async () => {
    const target = downloadPath.trim();
    if (!target) return;
    setBusy(true);
    try {
      const blob = await api.downloadFile(target);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = target.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify(`Downloaded ${target}`, "success");
    } catch (e: any) {
      onNotify(e instanceof ApiError ? `Download failed (${e.status})` : String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-gray-200 font-semibold">
        <Upload className="w-4 h-4" /> File Transfer
        {busy && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>Upload to:</span>
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="uploads"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200"
        />
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-lg p-6 text-center text-sm transition-colors ${
          dragOver ? "border-blue-400 bg-blue-500/10 text-blue-300" : "border-gray-600 text-gray-400 hover:border-gray-500"
        }`}
      >
        Drag & drop any file here, or click to choose (binary-safe)
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          value={downloadPath}
          onChange={(e) => setDownloadPath(e.target.value)}
          placeholder="path/to/file.bin"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        />
        <button
          onClick={() => void handleDownload()}
          disabled={busy || !downloadPath.trim()}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1 rounded"
        >
          <Download className="w-4 h-4" /> Download
        </button>
      </div>
    </div>
  );
};
