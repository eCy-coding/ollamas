/**
 * orchestration/bin/lib/conduct.ts — Zero-touch conductor çekirdeği (zero-dep, pure).
 *
 * Sinyalleri (collect snapshot + bench/optimize/depgraph/adopt/drift JSON) → Finding[] sınıfla →
 * DETERMİNİSTİK öncelik motoruyla TEK sıradaki eylemi seç (0 manuel seçim) → reconcile delta →
 * CONDUCTOR.md. ML YOK: severity-ordered tier + lexicographic tie-break.
 * Pattern ref: k8s controller reconcile (observe→diff→decide, idempotent), GitOps delta.
 */

import { sourceFresh } from "./fuse";

// Tier sırası = öncelik (küçük rank = yüksek öncelik). Matematiksel/mantıksal bütünlük.
export const TIERS = ["RED", "SECURITY", "CONTRACT", "DRIFT", "REGRESSION", "COMPLETENESS", "STALE", "ROADMAP"] as const;
export type Tier = (typeof TIERS)[number];
export function tierRank(t: Tier): number { return TIERS.indexOf(t); }

export interface Finding {
  tier: Tier;
  lane: string;       // ilgili lane (branch kısa adı) veya "global"
  kind: string;       // makine-anahtarı (reconcile için stabil)
  detail: string;     // insan açıklaması
  action: string;     // önerilen eylem (lane sekmesine)
  severity: number;   // 0-100, tier içi ikincil sıra
}

/** Sınıflama girdisi (saf — canlı toplama CLI'da). */
export interface ClassifyInput {
  lanes: { lane: string; idle: boolean; ageHours: number; dirtyFiles: number; roadmapNext: string }[];
  adoptionViolations: { repo: string; reason: string }[];
  depgraphMissing: string[];          // frontend çağırır, backend route yok
  driftCount: number;                 // version-drift sayısı
  benchRegressions: { model: string; dropPct: number }[];
  redLanes: { lane: string; detail: string }[]; // bilinen kırık gate/test (varsa)
  idleThresholdH?: number;
}

/**
 * vO41: QUALITY.json redLanes'i YALNIZ dosya-ts tazeyken yut — bayat roll-up'tan (ör. silinmiş
 * worktree lane'i) phantom-CRITICAL üretme. Bayat durumda fuse.ts zaten staleWarning üretir. Saf.
 */
export function freshRedLanes(quality: any, maxMinutes = 60, nowMs = Date.now()): { lane: string; detail: string }[] {
  if (!Array.isArray(quality?.redLanes)) return [];
  return sourceFresh(quality?.ts, maxMinutes, nowMs) ? quality.redLanes : [];
}

/** Ham sinyalleri Finding[]'e çevir. Saf, test edilebilir. */
export function classify(i: ClassifyInput): Finding[] {
  const out: Finding[] = [];
  const idleH = i.idleThresholdH ?? 6;

  for (const r of i.redLanes) {
    out.push({ tier: "RED", lane: r.lane, kind: `red:${r.lane}`, detail: r.detail, action: `${r.lane}: kırık gate/testi düzelt (her şeyi bloklar)`, severity: 100 });
  }
  for (const v of i.adoptionViolations) {
    out.push({ tier: "SECURITY", lane: "global", kind: `lic:${v.repo}`, detail: `Lisans ihlali: ${v.repo} — ${v.reason}`, action: `ADOPTIONS: ${v.repo} kararını ref-only'ye çevir (RISK-ORCH-005)`, severity: 90 });
  }
  for (const p of i.depgraphMissing) {
    out.push({ tier: "CONTRACT", lane: "frontend↔backend", kind: `gap:${p}`, detail: `API gap: \`${p}\` frontend çağırır, backend route yok`, action: `backend: \`${p}\` route ekle VEYA frontend: çağrıyı kaldır`, severity: 80 });
  }
  if (i.driftCount > 0) {
    out.push({ tier: "DRIFT", lane: "global", kind: "drift", detail: `${i.driftCount} version-drift (aynı dep farklı lane farklı pin)`, action: `lane'lerde dep pin'lerini hizala (depgraph.ts drift bölümü)`, severity: 60 });
  }
  for (const reg of i.benchRegressions) {
    out.push({ tier: "REGRESSION", lane: "bench", kind: `reg:${reg.model}`, detail: `${reg.model} tok/s baseline'dan -%${reg.dropPct} düştü`, action: `bench: ${reg.model} regresyonunu araştır (config/thermal)`, severity: 50 });
  }
  for (const l of i.lanes) {
    // "(detached)" = branch-siz ghost worktree — "sıradaki versiyonu planla" anlamsız, STALE üretme.
    if (l.lane === "(detached)") continue;
    if (l.idle && Number.isFinite(l.ageHours) && l.ageHours > idleH) {
      out.push({ tier: "STALE", lane: l.lane, kind: `stale:${l.lane}`, detail: `${l.lane} ${Math.round(l.ageHours)}s commitsiz (idle)`, action: `${l.lane}: sıradaki versiyonu planla (durağan)`, severity: Math.min(49, Math.round(l.ageHours)) });
    }
  }
  for (const l of i.lanes) {
    if (l.roadmapNext && l.roadmapNext.trim() && l.roadmapNext !== "—") {
      out.push({ tier: "ROADMAP", lane: l.lane, kind: `next:${l.lane}`, detail: `${l.lane} sıradaki: ${l.roadmapNext}`, action: `${l.lane}: "sıradaki versiyonu planla ${l.lane}"`, severity: 10 });
    }
  }
  return out;
}

/** TEK en-öncelikli eylemi seç (0 manuel seçim). tier-rank → severity desc → lexicographic. */
export function prioritize(findings: Finding[]): Finding | null {
  if (!findings.length) return null;
  return [...findings].sort(
    (a, b) => tierRank(a.tier) - tierRank(b.tier) || b.severity - a.severity || a.lane.localeCompare(b.lane) || a.kind.localeCompare(b.kind),
  )[0];
}

export interface Delta { added: string[]; resolved: string[]; persistent: string[] }

/** k8s desired-vs-actual: önceki vs şimdiki Finding key'leri → delta. Idempotent. */
export function reconcile(prevKinds: string[], cur: Finding[]): Delta {
  const prev = new Set(prevKinds);
  const curKinds = cur.map((f) => f.kind);
  const curSet = new Set(curKinds);
  return {
    added: curKinds.filter((k) => !prev.has(k)),
    resolved: [...prev].filter((k) => !curSet.has(k)),
    persistent: curKinds.filter((k) => prev.has(k)),
  };
}

export interface ReportInput {
  ts: string;
  summary: string;       // birleşik durum (lane matrisi + bench + config özeti)
  findings: Finding[];
  action: Finding | null;
  delta: Delta;
  workingPrompt: string; // vO7 optimal prompt
}

/** Tek CONDUCTOR.md: durum + 🎯 tek-eylem + delta + optimal-prompt. */
export function buildConductorReport(r: ReportInput): string {
  const byTier = TIERS.map((t) => {
    const n = r.findings.filter((f) => f.tier === t).length;
    return n ? `${t}:${n}` : null;
  }).filter(Boolean).join(" · ") || "temiz";

  const actionBlock = r.action
    ? [
        `**Tier:** ${r.action.tier} · **Lane:** ${r.action.lane}`,
        ``,
        `**Durum:** ${r.action.detail}`,
        ``,
        `**Eylem:** ${r.action.action}`,
      ].join("\n")
    : "_Tüm sinyaller temiz — eylem gerekmez (stabil)._";

  const deltaLine =
    r.delta.added.length || r.delta.resolved.length
      ? `+${r.delta.added.length} yeni · -${r.delta.resolved.length} çözülen · ${r.delta.persistent.length} süregelen`
      : `değişiklik yok (idempotent — son koşuyla aynı)`;

  return [
    `# CONDUCTOR — Zero-Touch Orkestrasyon (otonom)`,
    ``,
    `> \`conduct.ts\` üretti. 0 manuel seçim/işlem: tüm araçlar koşuldu, öncelik motoru tek eylem seçti.`,
    `> ${r.ts} · Bulgular: ${byTier} · Delta: ${deltaLine}`,
    ``,
    `## Birleşik durum`,
    r.summary,
    ``,
    `## 🎯 SIRADAKI TEK EYLEM (priority engine seçti)`,
    actionBlock,
    ``,
    `## Tüm bulgular (öncelik sırası)`,
    r.findings.length
      ? [...r.findings]
          .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.severity - a.severity)
          .map((f, n) => `${n + 1}. **[${f.tier}]** ${f.lane}: ${f.detail}`)
          .join("\n")
      : "_yok_",
    ``,
    `## Optimal working-prompt (seçili eyleme hazır)`,
    r.workingPrompt,
  ].join("\n");
}
