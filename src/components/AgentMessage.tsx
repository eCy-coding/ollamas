import React from "react";
import { Copy } from "lucide-react";

// Minimal, ZERO-dependency markdown-ish renderer for agent output. Handles the two
// things an LLM coding agent actually emits: fenced code blocks (```lang\n…```) and
// inline `code`. Everything else is preserved as wrapped text. NOT a full markdown
// engine (no headings/tables) — deliberately tiny to avoid a react-markdown dep + the
// bundle-size warning. Pure + total: any string in → valid React out, never throws.

interface Segment {
  type: "text" | "code";
  lang?: string;
  body: string;
}

// Split a string into ordered text/code segments by triple-backtick fences.
export function parseSegments(src: string): Segment[] {
  const out: Segment[] = [];
  const fence = /```([\w-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(src)) !== null) {
    if (m.index > last) out.push({ type: "text", body: src.slice(last, m.index) });
    out.push({ type: "code", lang: m[1] || undefined, body: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < src.length) out.push({ type: "text", body: src.slice(last) });
  return out;
}

// Render a text segment, turning inline `code` spans into <code>.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith("`") && p.endsWith("`") && p.length > 1 ? (
      <code key={`${keyBase}-${i}`} className="bg-immersive-bg border border-immersive-border rounded px-1 py-0.5 text-[10px] text-purple-300">
        {p.slice(1, -1)}
      </code>
    ) : (
      <React.Fragment key={`${keyBase}-${i}`}>{p}</React.Fragment>
    ),
  );
}

interface AgentMessageProps {
  content: string;
  copyLabel: string;
  onCopy: (text: string) => void;
}

export function AgentMessage({ content, copyLabel, onCopy }: AgentMessageProps) {
  const segments = parseSegments(content);
  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <div key={i} className="relative group/code">
            <button
              type="button"
              onClick={() => onCopy(seg.body)}
              aria-label={copyLabel}
              title={copyLabel}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 p-1 rounded bg-immersive-panel/80 border border-immersive-border text-immersive-text-dim hover:text-immersive-text-bright transition"
            >
              <Copy className="w-3 h-3" />
            </button>
            <pre className="bg-immersive-bg border border-immersive-border rounded p-2.5 overflow-x-auto scrollbar-thin text-[10px] leading-relaxed">
              <code>{seg.body}</code>
            </pre>
          </div>
        ) : (
          <p key={i} className="whitespace-pre-wrap">{renderInline(seg.body, String(i))}</p>
        ),
      )}
    </div>
  );
}
