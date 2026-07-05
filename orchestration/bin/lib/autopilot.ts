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
  stale?: boolean;  // budget-exceeded refresh that fell back to the previous on-disk artefact (⏱, not a failure)
}

/** Sonuçları AUTOPILOT.md markdown özetine indir (saf; ts dışarıdan = deterministik). */
export function summarizeAutopilot(results: StepResult[], ts: string): string {
  const okN = results.filter((r) => r.ok).length;
  const total = results.length;
  // pick (benchprompt) + next-action (conduct) öne çıkar.
  const pick = results.find((r) => r.step === "benchprompt" && r.ok)?.detail || "—";
  const next = results.find((r) => r.step === "conduct" && r.ok)?.detail || "—";
  // readiness (doctor): 0-manuel canlı + taze mi (GO/NO-GO).
  const readyR = results.find((r) => r.step === "doctor");
  const readiness = readyR ? `${readyR.ok ? "✅ GO" : "🛑 NO-GO"} — ${readyR.detail}` : "—";
  // heal (vO-AUTO.2 staleness self-heal): tazeleme kararı/sonucu.
  const healR = results.find((r) => r.step === "heal");

  // A timed-out refresh that reused its prior artefact is ⏱ stale — honest: not ✓ (fresh) nor ✗ (failed).
  const glyph = (r: StepResult) => (r.stale ? "⏱" : r.ok ? "✓" : "✗");
  const staleN = results.filter((r) => r.stale).length;
  const rows = results.length
    ? results.map((r) => `| ${glyph(r)} | \`${r.step}\` | ${r.ms}ms | ${r.detail} |`)
    : ["| — | _adım yok (no step)_ | — | — |"];

  return [
    `# AUTOPILOT — 0-manuel orkestrasyon tazelemesi`,
    `<!-- AUTO autopilot.ts · ${ts} · ${okN}/${total} adım ok · elle düzenleme; regenerate: tsx orchestration/bin/autopilot.ts -->`,
    ``,
    `> Sekme açılışında (SessionStart hook) + bench değişiminde (launchd WatchPaths) kendiliğinden koşar.`,
    `> Operatör komut çalıştırmaz (0-manuel-işlem).`,
    ``,
    `**Durum:** ${okN}/${total} adım başarılı${staleN ? ` (${staleN} ⏱ stale-fallback)` : ""} · ${ts}`,
    `**Model seçimi (0-manuel-seçim):** ${pick}`,
    `**Conductor sonraki-aksiyon:** ${next}`,
    `**Readiness (0-manuel aktif mi):** ${readiness}`,
    ...(healR ? [`**Staleness self-heal (0-manuel taze):** ${healR.detail}`] : []),
    ``,
    `| | Adım | Süre | Detay |`,
    `|---|---|--:|---|`,
    ...rows,
    ``,
    `_Üreten artefaktlar: MODEL_PROMPT.md (model) · CONDUCTOR.md (aksiyon) · STATUS.md (lane matrisi)._`,
    ``,
  ].join("\n");
}
