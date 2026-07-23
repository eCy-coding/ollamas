// L54 — a deterministic summary when the model won't use its own evidence.
//
// Measured across many turns: the $0 synthesiser (pollinations) keeps ignoring the command
// output it was handed — "sistem yükü" returns `ps` with node at 184.7% and the answer still
// says the responsible process "could be assumed". The grounding guardrail catches this and
// (correctly) withholds it from the brain, but the task is then left without an answer at all.
//
// For the common machine questions the answer is right there in the output and needs no model:
// df's fullest volume, the top process by %CPU/%MEM, the load averages. This parses them
// directly — $0, fully deterministic, model-independent — so a task whose synthesis went weak
// still produces a grounded, citable conclusion. An unrecognised command returns null and the
// answer stays honestly weak.
export interface FallbackSummary { text: string; }

/** Split into non-empty trimmed lines. */
const lines = (s: string): string[] => String(s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** df -h → the fullest mounted volume by Capacity%. */
function summariseDf(output: string): string | null {
  let best: { pct: number; mount: string; size: string; used: string } | null = null;
  for (const l of lines(output)) {
    // /dev/disk3s5  926Gi  608Gi  262Gi  70%  ... /System/Volumes/Data
    const m = /^\S+\s+(\S+)\s+(\S+)\s+\S+\s+(\d+)%\s+.*?(\/\S*|\/)\s*$/.exec(l);
    if (!m) continue;
    const pct = Number(m[3]);
    if (!best || pct > best.pct) best = { pct, size: m[1], used: m[2], mount: m[4] };
  }
  if (!best) return null;
  return `En dolu birim ${best.mount}: %${best.pct} dolu (${best.used}/${best.size}) [mem:step:command]`;
}

/** ps -A -o pid,%cpu|%mem,comm → the top process by the percentage column. */
function summarisePs(output: string, kind: "cpu" | "mem"): string | null {
  let best: { pct: number; comm: string } | null = null;
  for (const l of lines(output)) {
    // 80515 184.7 /usr/local/bin/node    (pid, pct, comm)
    const m = /^(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/.exec(l);
    if (!m) continue;
    const pct = Number(m[2]);
    const comm = m[3].split("/").pop() || m[3];
    if (!best || pct > best.pct) best = { pct, comm };
  }
  if (!best) return null;
  const label = kind === "cpu" ? "CPU" : "bellek";
  return `En yüksek ${label} kullanan süreç: ${best.comm} (%${best.pct}) [mem:step:command]`;
}

/** uptime → the 1/5/15-minute load averages, correctly labelled. */
function summariseUptime(output: string): string | null {
  const m = /load averages?:\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(output);
  if (!m) return null;
  return `Sistem yükü ortalamaları — 1 dk: ${m[1]}, 5 dk: ${m[2]}, 15 dk: ${m[3]} [mem:step:command]`;
}

/** pwd → the path. */
function summarisePwd(output: string): string | null {
  const p = lines(output).find((l) => l.startsWith("/"));
  return p ? `Çalışma dizini: ${p} [mem:step:command]` : null;
}

/** hostname → the machine name. */
function summariseHostname(output: string): string | null {
  const h = lines(output)[0];
  return h ? `Makine adı: ${h} [mem:step:command]` : null;
}

/**
 * Turn one command + its raw output into a grounded one-line summary. PURE. Returns null for a
 * command with no parser, so the caller keeps the (honestly weak) model answer rather than
 * inventing one.
 */
export function deterministicSummary(command: string, output: string): string | null {
  const cmd = String(command ?? "").trim();
  const out = String(output ?? "").trim();
  if (!cmd || !out) return null;
  const bin = cmd.split(/\s+/)[0];

  if (bin === "df") return summariseDf(out);
  if (bin === "uptime") return summariseUptime(out);
  if (bin === "pwd") return summarisePwd(out);
  if (bin === "hostname") return summariseHostname(out);
  if (bin === "ps") {
    // Distinguish %cpu from %mem by the column the command selected.
    if (/%mem/i.test(cmd)) return summarisePs(out, "mem");
    if (/%cpu/i.test(cmd)) return summarisePs(out, "cpu");
    return summarisePs(out, "cpu");
  }
  return null;
}

/**
 * Given a task's step results, build a deterministic summary from ALL command steps that have a
 * parser. Multiple commands (a follow-up round) are joined, so "sistem yükü ve hangi işlem"
 * yields both the load averages and the top process. Returns null when nothing could be parsed.
 */
export function summariseFromSteps(
  steps: { role: string; invocation: string; output: string; ok: boolean; gated?: boolean }[],
): string | null {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.role !== "command" || !s.ok || s.gated) continue;
    const line = deterministicSummary(s.invocation, s.output);
    if (line) parts.push(line);
  }
  return parts.length ? parts.join(" ") : null;
}
