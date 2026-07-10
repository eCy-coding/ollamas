import React, { useEffect, useState } from "react";
import { useLingui } from "@lingui/react";
import { SlidersHorizontal, Save } from "lucide-react";
import { api } from "../lib/apiClient";

// Per-model tuning override (M-038) — mirrors server/model-overrides.ts ModelOverride.
export interface ModelOverride {
  numCtx?: number;
  temperature?: number;
  keepAlive?: string;
  system?: string;
}

interface ModelSettingsProps {
  model: string;
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
}

/** Collapsible per-model override editor: num_ctx / temperature / keep_alive / system.
 *  Persists via POST /api/model-overrides; the server router applies the override on
 *  every chat/agent request for this model tag. Blank fields = clear the override. */
export function ModelSettings({ model, onNotify }: ModelSettingsProps) {
  const { _ } = useLingui();
  const [open, setOpen] = useState(false);
  const [numCtx, setNumCtx] = useState("");
  const [temperature, setTemperature] = useState("");
  const [keepAlive, setKeepAlive] = useState("");
  const [system, setSystem] = useState("");
  const [saving, setSaving] = useState(false);

  // (Re)load the persisted override whenever the editor opens or the model changes,
  // so switching models never shows another model's knobs.
  useEffect(() => {
    if (!open || !model) return;
    let alive = true;
    api
      .get<Record<string, ModelOverride>>("/api/model-overrides", { soft: true })
      .then((all) => {
        if (!alive) return;
        const ov = all?.[model] ?? {};
        setNumCtx(ov.numCtx != null ? String(ov.numCtx) : "");
        setTemperature(ov.temperature != null ? String(ov.temperature) : "");
        setKeepAlive(ov.keepAlive ?? "");
        setSystem(ov.system ?? "");
      })
      .catch(() => {
        /* load failure → empty editor; save still works */
      });
    return () => {
      alive = false;
    };
  }, [open, model]);

  const save = async () => {
    setSaving(true);
    try {
      const override: ModelOverride = {};
      if (numCtx.trim()) override.numCtx = Number(numCtx);
      if (temperature.trim()) override.temperature = Number(temperature);
      if (keepAlive.trim()) override.keepAlive = keepAlive.trim();
      if (system.trim()) override.system = system.trim();
      await api.post("/api/model-overrides", { model, override });
      onNotify(`${_("model-settings.notify.saved")} ${model}`, "success");
    } catch {
      onNotify(_("model-settings.notify.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-immersive-panel border border-immersive-border-strong rounded px-2 py-1.5 text-[11px] font-mono text-immersive-text-bright outline-none focus:border-indigo-500/50";
  const labelCls = "text-[9px] font-mono text-immersive-text-dim uppercase tracking-wider";

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!model}
        className="flex items-center gap-1.5 text-[10px] font-mono text-immersive-text-dim hover:text-immersive-text-bright transition disabled:opacity-40"
        title={_("model-settings.toggle.title")}
      >
        <SlidersHorizontal className="w-3 h-3" />
        <span>{_("model-settings.toggle")}</span>
      </button>

      {open && (
        <div className="space-y-2 border border-immersive-border bg-immersive-panel/40 rounded p-2.5">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="model-settings-numctx" className={labelCls}>
                {_("model-settings.numCtx")}
              </label>
              <input
                id="model-settings-numctx"
                type="number"
                min={0}
                step={1024}
                value={numCtx}
                onChange={(e) => setNumCtx(e.target.value)}
                placeholder="8192"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="model-settings-temperature" className={labelCls}>
                {_("model-settings.temperature")}
              </label>
              <input
                id="model-settings-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="0.7"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="model-settings-keepalive" className={labelCls}>
                {_("model-settings.keepAlive")}
              </label>
              <input
                id="model-settings-keepalive"
                type="text"
                value={keepAlive}
                onChange={(e) => setKeepAlive(e.target.value)}
                placeholder="30m"
                className={inputCls}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="model-settings-system" className={labelCls}>
              {_("model-settings.system")}
            </label>
            <textarea
              id="model-settings-system"
              rows={2}
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder={_("model-settings.system.placeholder")}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-immersive-text-dim truncate pr-2">{model}</span>
            <button
              type="button"
              onClick={save}
              disabled={saving || !model}
              className="bg-indigo-500/10 hover:bg-indigo-500/20 text-status-accent border border-indigo-500/20 font-mono text-[10px] rounded px-3 py-1 transition flex items-center gap-1.5 disabled:opacity-40"
            >
              <Save className="w-3 h-3" />
              <span>{saving ? _("model-settings.saving") : _("model-settings.save")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
