import { useEffect, useState } from "react";
import { Folder, File, FileText, FileSpreadsheet, FileIcon, Loader2, Download, Trash2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export function GoogleDriveBrowser() {
  const { token, needsAuth, handleLogin, isLoggingIn, authError } = useAuth();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // external Google API — not ollamas choke-point (FRONTEND_AGENTS.md §1)
      const res = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType)&orderBy=modifiedTime desc", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("Failed to fetch files from Google Drive.");
      }
      const data = await res.json();
      setFiles(data.files || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchFiles();
    }
  }, [token]);

  const handleDelete = async (fileId: string, fileName: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete '${fileName}'? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      // external Google API — not ollamas choke-point (FRONTEND_AGENTS.md §1)
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("Failed to delete file.");
      }
      setFiles((prev) => prev.filter(f => f.id !== fileId));
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (needsAuth) {
    return (
      <div className="bg-immersive-sidebar border border-immersive-border rounded p-8 flex flex-col items-center justify-center min-h-[300px] text-center shadow-lg">
        <Folder className="w-12 h-12 text-indigo-400 mb-4 opacity-50" />
        <h2 className="text-sm font-bold text-immersive-text-bright font-mono tracking-wider uppercase mb-2">Connect Google Drive</h2>
        <p className="text-xs text-immersive-text-muted mb-6 max-w-sm">Sign in with Google to browse and manage your Drive files directly from this cockpit.</p>
        
        {authError && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs px-4 py-3 rounded mb-6 max-w-md font-mono text-left">
            <strong>Authentication Error:</strong> {authError}
          </div>
        )}

        <button 
          onClick={handleLogin} 
          disabled={isLoggingIn}
          className="gsi-material-button bg-immersive-bg text-immersive-text-dim border border-immersive-border rounded px-4 py-2 flex items-center gap-2 hover:bg-immersive-bg transition cursor-pointer font-medium text-sm disabled:opacity-50"
        >
          {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
          )}
          <span>Sign in with Google</span>
        </button>
      </div>
    );
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes("folder")) return <Folder className="w-4 h-4 text-amber-400" />;
    if (mimeType.includes("document") || mimeType.includes("text")) return <FileText className="w-4 h-4 text-blue-400" />;
    if (mimeType.includes("spreadsheet")) return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    return <File className="w-4 h-4 text-immersive-text-muted" />;
  };

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg flex flex-col h-full min-h-[400px]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Google Drive Storage</h2>
        </div>
        <button 
          onClick={fetchFiles} 
          disabled={loading}
          className="text-xs text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded cursor-pointer transition font-mono flex items-center gap-2"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          Refresh
        </button>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded font-mono mb-4">
          Error: {error}
        </div>
      ) : null}

      <div className="flex-1 bg-immersive-inset border border-immersive-border rounded overflow-y-auto mt-2">
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
             <Loader2 className="w-6 h-6 animate-spin text-immersive-text-dim" />
          </div>
        ) : files.length === 0 ? (
           <div className="flex items-center justify-center h-full min-h-[200px] text-xs text-immersive-text-dim font-mono">
             No files found in your Google Drive.
           </div>
        ) : (
          <div className="divide-y divide-white/5">
            {files.map(file => (
              <div key={file.id} className="flex justify-between items-center p-3 hover:bg-white/5 transition group">
                <div className="flex items-center gap-3 overflow-hidden">
                  {getFileIcon(file.mimeType)}
                  <span className="text-xs text-immersive-text-muted font-mono truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                  <button 
                    onClick={() => handleDelete(file.id, file.name)}
                    className="text-immersive-text-dim hover:text-red-400 cursor-pointer p-1"
                    title="Delete file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
