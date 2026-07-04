import React from "react";
import { Boxes, Star, Check, Zap } from "lucide-react";

export interface ModelInfo {
  name: string;
  sizeGb: number;
  fitsRam: boolean;
  loaded: boolean;
  recommended: boolean;
}

export interface ModelsPanelProps {
  list: ModelInfo[];
  recommended: string | null;
  championTokPerSec: number | null;
  totalRamGb: number;
}

export function ModelsPanel({
  list,
  recommended,
  championTokPerSec,
  totalRamGb,
}: ModelsPanelProps): React.ReactElement {
  return (
    <div className="bg-immersive-sidebar border border-immersive-border p-4 rounded shadow-lg min-h-[8rem]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-immersive-text-dim font-mono tracking-widest uppercase flex items-center gap-1.5">
          <Boxes className="w-3.5 h-3.5 text-status-accent" /> Local Models ({list.length})
        </span>
        {recommended ? (
          <span className="text-[10px] font-mono text-status-ok flex items-center gap-1">
            <Star className="w-3 h-3" />
            {recommended}
            {championTokPerSec != null ? ` · ${championTokPerSec} tok/s` : ""}
          </span>
        ) : null}
      </div>

      {list.length === 0 ? (
        <div className="mt-2 text-[10px] font-mono italic text-immersive-text-dim">
          querying models…
        </div>
      ) : (
        /* Scroll container must be keyboard-reachable once the model list overflows
           (axe scrollable-region-focusable, serious — only fires with enough models). */
        <div
          className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2"
          role="region"
          aria-label="Detected local models"
          tabIndex={0}
        >
          {list.map((m) => (
            <div
              key={m.name}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded border text-[10px] font-mono ${
                m.recommended
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-immersive-inset border-immersive-border"
              } ${!m.fitsRam ? "text-immersive-text-dim line-through opacity-60" : ""}`}
            >
              <span className="flex items-center gap-1.5">
                {m.recommended && <Star className="w-3 h-3 text-status-ok" />}
                {m.loaded && <Zap className="w-3 h-3 text-status-accent" />}
                <span
                  className={
                    m.fitsRam
                      ? "text-immersive-text-muted"
                      : "text-immersive-text-dim line-through"
                  }
                >
                  {m.name}
                </span>
              </span>
              <span className="text-immersive-text-dim">
                {m.sizeGb}GB{m.loaded ? " · resident" : m.fitsRam ? "" : " · too large"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-[9px] font-mono text-immersive-text-dim">
        Mac unified memory: {totalRamGb}GB · fit = ≤70%
      </div>
    </div>
  );
}
