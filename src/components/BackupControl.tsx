import React, { useEffect, useState } from "react";
import { Download, Upload, CloudLightning, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/apiClient";

interface BackupProps {
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

export const BackupControl: React.FC<BackupProps> = ({ onNotify }) => {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    type: "none",
    endpoint: "",
    bucket: "",
    accessKey: "",
    secretKey: "",
    intervalMinutes: 120,
    enabled: false,
  });

  const loadConfig = async () => {
    try {
      const data: any = await api.get("/api/backup/config");
      setConfig(data);
    } catch (e) {
      console.error("Failed to load backup configuration.");
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      await api.post("/api/backup/config", config);
      onNotify("Backup cloud properties updated successfully!", "success");
      loadConfig();
    } catch (e: any) {
      if (e instanceof ApiError) {
        onNotify("Failed to update cloud backups config.", "error");
      } else {
        onNotify(e.message, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSync = async () => {
    setLoading(true);
    onNotify("Compressing database & executing AES-256 GCM client-side encryption...", "info");
    try {
      const data: any = await api.post("/api/backup/trigger");
      if (data.success) {
        onNotify(`Full encrypted database uploaded: ${data.size} bytes synced.`, "success");
        if (data.url && !data.url.startsWith("local-dryrun")) {
          onNotify(`Remote endpoint response: ${data.url}`, "info");
        }
      } else {
        onNotify(`Backup upload failed: ${data.error || "Server error"}`, "error");
      }
    } catch (e: any) {
      if (e instanceof ApiError) {
        // non-ok responses previously parsed the JSON body for an error message
        const body: any = e.body;
        onNotify(`Backup upload failed: ${(body && body.error) || "Server error"}`, "error");
      } else {
        onNotify(e.message, "error");
      }
    } finally {
      setLoading(false);
    }
  };

  // Upload restore file helper
  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const arrayBuffer = evt.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      // Map back to Hex characters
      let binaryHex = "";
      for (let i = 0; i < bytes.length; i++) {
        binaryHex += bytes[i].toString(16).padStart(2, "0");
      }

      setLoading(true);
      try {
        await api.post("/api/backup/restore", { hexBlob: binaryHex });
        onNotify("Database configuration successfully decrypted and restored! Sessions updated.", "success");
        window.location.reload(); // Refresh to reload keys/masks
      } catch (err: any) {
        if (err instanceof ApiError) {
          onNotify("Failed to restore: corrupt payload or master key mismatch.", "error");
        } else {
          onNotify(`Restore fail: ${err.message}`, "error");
        }
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 shadow-lg">
      <div className="flex items-center gap-2.5 mb-4">
        <CloudLightning className="w-4 h-4 text-indigo-400" />
        <h2 className="text-xs font-bold text-immersive-text-bright font-mono tracking-wider uppercase">Client-Side Encrypted Backups</h2>
      </div>

      <div className="flex gap-2.5 bg-immersive-inset border border-immersive-border p-4 rounded mb-6 text-xs text-immersive-text-muted font-mono">
        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
        <div>
          <strong className="text-immersive-text-bright">Zero-Knowledge Protocol:</strong>
          <p className="mt-0.5 leading-relaxed text-immersive-text-muted">
            Plaintext configuration secrets are never transmitted off your device. The backup module compresses details with native Gzip, 
            encrypts them completely using AES-256-GCM (on-device hardware), and only then posts the secure payload to S3 or WebDAV buckets.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Local export triggers column */}
        <div className="bg-immersive-inset border border-immersive-border p-4 rounded space-y-4">
          <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Local Database Control</h3>
          
          <div className="flex flex-col gap-2.5">
            <a
              href="/api/backup/download"
              className="bg-immersive-bg hover:bg-white/5 border border-immersive-border rounded p-3 text-xs text-immersive-text-muted flex items-center justify-between transition cursor-pointer"
            >
              <div className="text-left font-mono">
                <span className="font-semibold text-immersive-text-bright block">Export AES Blob</span>
                <span className="text-[10px] text-immersive-text-dim">Download current hardware config as single .enc file</span>
              </div>
              <Download className="w-4 h-4 text-indigo-400" />
            </a>

            <label className="border border-immersive-border border-dashed rounded p-3 text-xs text-immersive-text-muted flex items-center justify-between cursor-pointer hover:bg-white/5 transition">
              <div className="text-left font-mono">
                <span className="font-semibold text-immersive-text-bright block">Restore Local Backup</span>
                <span className="text-[10px] text-immersive-text-dim">Upload encrypted .enc file to restore settings</span>
              </div>
              <Upload className="w-4 h-4 text-emerald-400" />
              <input type="file" accept=".enc" className="hidden" onChange={handleFileRestore} disabled={loading} />
            </label>
          </div>

          <div className="pt-2 border-t border-immersive-border">
            <button
              onClick={handleTriggerSync}
              disabled={loading}
              className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-bold text-xs rounded py-2 transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudLightning className="w-3.5 h-3.5" />}
              Sync Encrypted Cloud Remote Backup Now
            </button>
          </div>
        </div>

        {/* Cloud Configurations column */}
        <div className="bg-immersive-inset border border-immersive-border p-4 rounded space-y-3.5">
          <h3 className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase">Locker Destination Settings</h3>
          
          <div>
            <label htmlFor="backup-target-type" className="text-[10px] text-immersive-text-dim font-mono uppercase block mb-1">Backup Target Type</label>
            <select
              id="backup-target-type"
              value={config.type}
              onChange={(e) => setConfig((p) => ({ ...p, type: e.target.value }))}
              className="w-full bg-immersive-bg border border-immersive-border text-xs rounded p-1.5 text-immersive-text-bright focus:outline-none focus:border-indigo-500/40 font-mono"
            >
              <option value="none">Disabled (Local Space Only)</option>
              <option value="s3">S3-Compatible (MinIO, AWS S3, Cloudflare R2)</option>
              <option value="webdav">WebDAV REST Locker (Nextcloud, Owncloud)</option>
            </select>
          </div>

          {config.type !== "none" && (
            <div className="space-y-2.5 font-mono text-xs">
              <div>
                <label htmlFor="backup-endpoint" className="text-[10px] text-immersive-text-dim block mb-0.5">Endpoint Host URL</label>
                <input
                  id="backup-endpoint"
                  type="text"
                  placeholder="https://s3.us-east-1.amazonaws.com"
                  value={config.endpoint}
                  onChange={(e) => setConfig((p) => ({ ...p, endpoint: e.target.value }))}
                  className="w-full bg-immersive-bg border border-immersive-border rounded px-2.5 py-1.5 text-immersive-text-muted focus:outline-none focus:border-indigo-500/40"
                />
              </div>

              {config.type === "s3" && (
                <div>
                  <label htmlFor="backup-bucket" className="text-[10px] text-immersive-text-dim block mb-0.5">Bucket Identifier</label>
                  <input
                    id="backup-bucket"
                    type="text"
                    placeholder="mission-control-backups"
                    value={config.bucket}
                    onChange={(e) => setConfig((p) => ({ ...p, bucket: e.target.value }))}
                    className="w-full bg-immersive-bg border border-immersive-border rounded px-2.5 py-1.5 text-immersive-text-muted focus:outline-none focus:border-indigo-500/40"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="backup-access-key" className="text-[10px] text-immersive-text-dim block mb-0.5">Access ID / Username</label>
                  <input
                    id="backup-access-key"
                    type="text"
                    placeholder="AWS_KEY_ID"
                    value={config.accessKey}
                    onChange={(e) => setConfig((p) => ({ ...p, accessKey: e.target.value }))}
                    className="w-full bg-immersive-bg border border-immersive-border rounded px-2.5 py-1.5 text-immersive-text-muted focus:outline-none focus:border-indigo-500/40"
                  />
                </div>
                <div>
                  <label htmlFor="backup-secret-key" className="text-[10px] text-immersive-text-dim block mb-0.5">Secret Key / Password</label>
                  <input
                    id="backup-secret-key"
                    type="password"
                    placeholder="Masked"
                    value={config.secretKey}
                    onChange={(e) => setConfig((p) => ({ ...p, secretKey: e.target.value }))}
                    className="w-full bg-immersive-bg border border-immersive-border rounded px-2.5 py-1.5 text-immersive-text-muted focus:outline-none focus:border-indigo-500/40"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 items-center pt-2">
            <button
              onClick={handleSaveConfig}
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-mono font-bold text-xs rounded px-4 py-1.5 transition cursor-pointer"
            >
              Save Cloud Parameters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
