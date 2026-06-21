/**
 * quality.ts — vO9 Quality-Gate Roll-Up saf çekirdek (zero-dep, IO'suz).
 *
 * Tüm lane'lerin tsc/lint/test sağlığını TEK matrise indirir. tsc CANLI (stateless, ucuz,
 * read-only) koşulur; vitest CANLI KOŞULMAZ (pahalı+flaky) → `.last-run.json` cache TÜKET.
 * rollup conduct-uyumlu `redLanes {lane,detail}[]` üretir (ClassifyInput.redLanes besler).
 */

export interface LaneQuality {
  lane: string;
  branch: string;
  tsc: "pass" | "fail" | "skip";   // skip = tsconfig yok
  tscErrors: number;
  testLast: "passed" | "failed" | "unknown"; // vitest .last-run.json
  testTs: string;                  // .last-run.json dosya mtime (ISO); yoksa ""
  testStale: boolean;
  dirty: number;
}

/** tsc --noEmit çıktısı → {ok, errorCount}. exit 0 → ok. "Found N errors" veya "error TS" sayar. */
export function parseTscResult(exitCode: number, output: string): { ok: boolean; errorCount: number } {
  if (exitCode === 0) return { ok: true, errorCount: 0 };
  const m = (output || "").match(/Found (\d+) errors?/i);
  if (m) return { ok: false, errorCount: parseInt(m[1], 10) };
  const n = ((output || "").match(/error TS\d+/g) || []).length;
  return { ok: false, errorCount: Math.max(1, n) };
}

/** vitest .last-run.json metni → {status}. {status:"passed"|"failed",...}. Bozuk/eksik → unknown. */
export function parseLastRun(json: string): { status: "passed" | "failed" | "unknown"; failedCount: number } {
  try {
    const j = JSON.parse(json);
    const s = j?.status;
    if (s === "passed" || s === "failed") return { status: s, failedCount: Array.isArray(j.failedTests) ? j.failedTests.length : 0 };
    return { status: "unknown", failedCount: 0 };
  } catch {
    return { status: "unknown", failedCount: 0 };
  }
}

export interface Rollup {
  reds: LaneQuality[];
  greens: LaneQuality[];
  unknowns: LaneQuality[];
  redLanes: { lane: string; detail: string }[]; // conduct ClassifyInput.redLanes uyumlu
}

/** Lane sınıfla: tsc-fail VEYA test-failed → RED; tsc-ok & test-passed → GREEN; aksi UNKNOWN. */
export function rollup(qs: LaneQuality[]): Rollup {
  const reds: LaneQuality[] = [], greens: LaneQuality[] = [], unknowns: LaneQuality[] = [];
  const redLanes: { lane: string; detail: string }[] = [];
  for (const q of qs) {
    const tscFail = q.tsc === "fail";
    const testFail = q.testLast === "failed";
    if (tscFail || testFail) {
      reds.push(q);
      const parts: string[] = [];
      if (tscFail) parts.push(`tsc ${q.tscErrors} hata`);
      if (testFail) parts.push("test failed");
      redLanes.push({ lane: q.lane, detail: parts.join(" + ") });
    } else if (q.tsc === "pass" && q.testLast === "passed") {
      greens.push(q);
    } else {
      unknowns.push(q);
    }
  }
  return { reds, greens, unknowns, redLanes };
}

const TSC_ICON = { pass: "✓", fail: "✗", skip: "—" } as const;
function statusCell(q: LaneQuality): string {
  if (q.tsc === "fail" || q.testLast === "failed") return "🔴 RED";
  if (q.tsc === "pass" && q.testLast === "passed") return "🟢 GREEN";
  return "⚪ unknown";
}

/** Markdown matris: Lane | tsc | test(son) | durum. */
export function toQualityTable(qs: LaneQuality[]): string {
  const rows = qs.map((q) =>
    `| \`${q.lane}\` | ${TSC_ICON[q.tsc]}${q.tscErrors ? ` (${q.tscErrors})` : ""} | ${q.testLast}${q.testStale ? " ⏳bayat" : ""} | ${q.dirty}△ | ${statusCell(q)} |`,
  );
  return [
    `| Lane | tsc | test (son koşu) | dirty | Durum |`,
    `|------|-----|------------------|-------|-------|`,
    ...rows,
  ].join("\n");
}
