/**
 * autopilot.ts (lib) — vO-AUTO otopilot özeti (PURE, deterministik).
 *
 * autopilot.ts CLI mevcut otonom parçaları (benchprompt/conduct/status) sırayla read-only
 * koşar; bu saf fonksiyon sonuçları tek AUTOPILOT.md özetine indirir. 0-manuel: özet
 * SessionStart hook ile context'e enjekte edilir, operatör komut çalıştırmaz.
 */

export interface StepResult {
  step: string;     // benchprompt | conduct | status
  ok: boolean;
  ms: number;
  detail: string;   // pick / next-action / hata
}

/** Sonuçları AUTOPILOT.md markdown özetine indir (saf; ts dışarıdan = deterministik). */
export function summarizeAutopilot(results: StepResult[], ts: string): string {
  const okN = results.filter((r) => r.ok).length;
  const total = results.length;
  // pick (benchprompt) + next-action (conduct) öne çıkar.
  const pick = results.find((r) => r.step === "benchprompt" && r.ok)?.detail || "—";
  const next = results.find((r) => r.step === "conduct" && r.ok)?.detail || "—";

  const rows = results.length
    ? results.map((r) => `| ${r.ok ? "✓" : "✗"} | \`${r.step}\` | ${r.ms}ms | ${r.detail} |`)
    : ["| — | _adım yok (no step)_ | — | — |"];

  return [
    `# AUTOPILOT — 0-manuel orkestrasyon tazelemesi`,
    `<!-- AUTO autopilot.ts · ${ts} · ${okN}/${total} adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->`,
    ``,
    `> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.`,
    `> Operatör komut çalıştırmaz (0-manuel-işlem).`,
    ``,
    `**Durum:** ${okN}/${total} adım başarılı · ${ts}`,
    `**Model seçimi (0-manuel-seçim):** ${pick}`,
    `**Conductor sonraki-aksiyon:** ${next}`,
    ``,
    `| | Adım | Süre | Detay |`,
    `|---|---|--:|---|`,
    ...rows,
    ``,
    `_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._`,
    ``,
  ].join("\n");
}
