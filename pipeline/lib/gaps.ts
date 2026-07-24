// gaps — the running log of what the reference sites HAVE that our systems' help still lacks.
//
// WHY THIS EXISTS
// The operator asked to "always note the gaps seen in the references for ollamas / eCym /
// obsidian, and hand them to the parallel planners." This module is that log, as data: a Gap
// names the system, the missing area, the EVIDENCE (which reference has it), and — once a
// planner AI has taken it — who planned it and the proposed fix. The orchestrator appends gaps
// found during a build and dispatches the pending ones to parallel planning agents.
//
// Severity is DERIVED, never invented: `severityFor` maps an area to a fixed severity by
// whether it is a required docs feature, a structural feature, or polish. So two runs that find
// the same gap agree on its severity, and no number is made up.

export type GapSeverity = "high" | "med" | "low";

export interface Gap {
  /** claude | ecym | ollamas | obsidian */
  system: string;
  /** The missing capability, a stable slug (quickstart, cli-reference, …). */
  area: string;
  /** Source-tagged: which reference demonstrates this, and where our system lacks it. */
  evidence: string;
  /** Derived from `area` via severityFor — not hand-set per gap. */
  severity: GapSeverity;
  /** Planner AI / agent that took this gap (filled by the orchestrator). */
  plannedBy?: string;
  /** Proposed fix the planner produced (filled later). */
  plan?: string;
}

/** Required docs features a help site must have; missing one is `high`. */
const REQUIRED = new Set(["quickstart", "cli-reference", "troubleshooting", "search", "beginner-order", "machine-index"]);
/** Structural features; missing one is `med`. */
const STRUCTURAL = new Set(["api-reference", "prev-next", "landing-shell", "callouts-code"]);

/** Deterministic severity from the area. Documented, not fabricated per-gap. */
export function severityFor(area: string): GapSeverity {
  if (REQUIRED.has(area)) return "high";
  if (STRUCTURAL.has(area)) return "med";
  return "low";
}

/** Stable identity for dedup: one gap per (system, area). */
export function gapKey(g: Pick<Gap, "system" | "area">): string {
  return `${g.system}::${g.area}`;
}

/** Build a Gap with severity derived from the area. */
export function gap(system: string, area: string, evidence: string, extra: Partial<Gap> = {}): Gap {
  return { system, area, evidence, severity: severityFor(area), ...extra };
}

/**
 * The gaps found by the research pass, source-tagged. These are for ollamas / eCym / obsidian —
 * the systems whose help was raw markdown, not a coded docs site. (Claude's content already
 * exists in cckb; its gap is only the coded layer, shared by all.)
 */
export const SEED_GAPS: Gap[] = [
  gap("ollamas", "quickstart", "code.claude.com/docs quickstart numaralı Step 1…N akışı sunuyor; ollamas'ın 'kur → ilk `ollamas` komutu → ilk sonuç' akışı web sayfası olarak yok."),
  gap("ollamas", "cli-reference", "Referans docs Komut/Ne-yapar/Örnek tablosu veriyor; ollamas'ın geniş `pipeline/board/orchestra/do` yüzeyi yalnız prose'da."),
  gap("ollamas", "api-reference", "ollamas HTTP uçları (:3000, /api/org/overview, /api/council/solve) yapılandırılmış referans sayfası olarak yok."),
  gap("ollamas", "troubleshooting", "Kod tabanı GOTCHA notlarıyla dolu (:3000 churn, TR-İ katlama, WAF/404) ama aranabilir bir Sorun-Giderme koleksiyonu değil."),
  gap("ecym", "quickstart", "code.claude.com quickstart deseni; eCym'in 'qwen3:8b kur → ilk `ecy` komutu' başlangıç akışı web sayfası olarak yok."),
  gap("ecym", "cli-reference", "eCym'in `ecym/ecy-brain/ecy-cmd` yüzeyi Komut/Ne-yapar/Örnek tablosu olarak yok; tetikleyiciler dataset'te gömülü."),
  gap("ecym", "troubleshooting", "Rota-tutmuyor türü sorunlar tek elle-yazılmış sayfada; gerçek gotcha'lardan FAQ değil."),
  gap("obsidian", "beginner-order", "obsidian.md/help başlangıç→ileri sıralı; bizim obsidian notlarımız (Canvas/.base/çizim) kronolojik, sıralı okuma yok."),
  gap("obsidian", "cli-reference", "Çizim SYM/şema (`obsidian-sketch.schema.json`) yapılandırılmış referans sayfası olarak yok."),
  gap("obsidian", "troubleshooting", "Vault gotcha'ları (brain frontmatter silme, .base groupBy, workspace bellek) Sorun-Giderme koleksiyonu değil."),
  // Cross-cutting coded-layer gap that every system shares (the whole reason for v9).
  gap("ollamas", "search", "Referansların hepsinde istemci-taraflı arama var; markdown notlarında yok."),
  gap("ecym", "theme-responsive", "Referanslar tema-anahtarı + responsive; markdown export'unda ikisi de yok."),
  gap("obsidian", "machine-index", "code.claude.com /llms.txt makine indeksi yayımlıyor; bizim yardımın sayfa-manifestosu yok."),
];

/** Gaps not yet taken by a planner. */
export function pendingGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => !g.plannedBy);
}

/**
 * Merge incoming gaps into existing, keyed by (system, area). An incoming gap with the same key
 * updates the existing one (e.g. a planner filling in plannedBy/plan); a new key appends. Order:
 * existing first (stable), then genuinely-new incoming.
 */
export function mergeGaps(existing: Gap[], incoming: Gap[]): Gap[] {
  const byKey = new Map(existing.map((g) => [gapKey(g), g]));
  const order = existing.map((g) => gapKey(g));
  for (const g of incoming) {
    const k = gapKey(g);
    if (byKey.has(k)) byKey.set(k, { ...byKey.get(k)!, ...g });
    else { byKey.set(k, g); order.push(k); }
  }
  return order.map((k) => byKey.get(k)!);
}

const SEV_MARK: Record<GapSeverity, string> = { high: "🔴 yüksek", med: "🟡 orta", low: "⚪ düşük" };

/** The committed `GAPS.md`: what's missing, its evidence, and who (if anyone) is planning it. */
export function renderGapsMd(gaps: Gap[]): string {
  const pending = pendingGaps(gaps);
  const L: string[] = [
    "# Eksikler — referanslarda olup bizim yardımda olmayanlar",
    "",
    "> Referans sayfalarında görülüp **ollamas / eCym / obsidian** için eksik kalan yetenekler. Her satır kaynağa etiketli. Bekleyen eksikler **paralel planlayıcı yapay zekâlara** havale edilir; alındığında `Planlayan` dolar.",
    "",
    `**Toplam:** ${gaps.length} · **bekleyen:** ${pending.length} · **planlanan:** ${gaps.length - pending.length}`,
    "",
    "| Sistem | Alan | Önem | Kanıt | Planlayan | Plan |",
    "|--------|------|------|-------|-----------|------|",
  ];
  for (const g of gaps) {
    L.push(
      `| ${g.system} | ${g.area} | ${SEV_MARK[g.severity]} | ${g.evidence} | ${g.plannedBy ?? "—"} | ${g.plan ? g.plan.replace(/\n/g, " ") : "—"} |`,
    );
  }
  L.push("");
  return L.join("\n");
}
