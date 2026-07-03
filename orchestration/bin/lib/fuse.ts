/**
 * orchestration/bin/lib/fuse.ts — Unified Critical Requirements Fusion (zero-dep, pure).
 *
 * Mevcut analizör çıktılarını (conduct/critic/dod/quality Finding'leri) TEK critical-first
 * requirement görünümüne birleştirir: normalize → dedupe → criticality-rank. Yeni analiz YOK.
 * Pattern ref: SARIF result-merge (fingerprint dedupe), CVSS criticality, OSSF readiness skoru.
 */

export const CRITICALITY = ["CRITICAL", "SECURITY", "CONTRACT", "DRIFT", "REGRESSION", "COMPLETENESS", "STALE", "ROADMAP"] as const;
export type Criticality = (typeof CRITICALITY)[number];
export function critRank(c: Criticality): number { return CRITICALITY.indexOf(c); }

export interface Finding { tier?: string; lane?: string; kind: string; detail: string; action: string; severity?: number | string; concurrent?: boolean; }
export interface Requirement { criticality: Criticality; source: string; target: string; detail: string; action: string; score: number; }

/** Sayısal severity (string "high/med/low" veya number). */
function numSeverity(s: number | string | undefined): number {
  if (typeof s === "number") return s;
  if (s === "high") return 65; if (s === "med") return 40; if (s === "low") return 15;
  return 30;
}

/** Analizör tier'ini birleşik criticality'ye map'le. COMPLETENESS yüksek-severity → üst-sıra korunur. */
export function tierToCriticality(tier: string | undefined, severity: number): Criticality {
  const t = (tier || "").toUpperCase();
  if (t === "RED") return "CRITICAL";
  if (t === "SECURITY") return "SECURITY";
  if (t === "CONTRACT") return "CONTRACT";
  if (t === "DRIFT") return "DRIFT";
  if (t === "REGRESSION") return "REGRESSION";
  if (t === "STALE") return "STALE";
  if (t === "ROADMAP") return "ROADMAP";
  if (t === "COMPLETENESS") return "COMPLETENESS";
  // Bilinmeyen tier → severity ile tahmin.
  return severity >= 60 ? "COMPLETENESS" : "ROADMAP";
}

/** Finding[] → Requirement[] (source etiketli). target = kind'in stabil kısmı. */
export function normalizeFindings(source: string, findings: Finding[]): Requirement[] {
  return (findings || []).map((f) => {
    const sev = numSeverity(f.severity);
    return {
      criticality: tierToCriticality(f.tier, sev),
      source, target: f.kind || f.detail.slice(0, 40),
      detail: f.detail, action: f.action, score: sev,
    };
  });
}

/**
 * QUALITY.json (lanes[{lane,tsc,tscErrors,testLast,testTs}], redLanes) → CRITICAL Requirement.
 * vO15 KÖK-FIX: per-lane `testTs` tazelik kontrolü — bayat test-sonucundan phantom-CRITICAL ÜRETME.
 * (QUALITY.json dosyası taze olabilir ama içindeki testTs günlerce bayat olabilir.)
 */
export function qualityToReqs(q: any, maxMinutes = 60, nowMs = Date.now()): Requirement[] {
  const out: Requirement[] = [];
  for (const l of q?.lanes || []) {
    // tsc YALNIZ açık "fail" / errors>0 kırık — "skip"/"unknown"/"pass" kırık DEĞİL (vO15 fix: skip≠fail).
    const tscBroken = l.tsc === "fail" || (l.tscErrors ?? 0) > 0;
    const broken = l.testLast === "failed" || tscBroken;
    if (!broken) continue;
    // testLast=failed iken testTs bayatsa → sonuç güvenilmez → CRITICAL yerine STALE uyarısı.
    if (l.testLast === "failed" && !sourceFresh(l.testTs, maxMinutes, nowMs)) {
      const ageMin = Number.isFinite(Date.parse(l.testTs || "")) ? Math.round((nowMs - Date.parse(l.testTs)) / 60000) : -1;
      out.push({
        criticality: "COMPLETENESS", source: "quality(stale)", target: `stale-test:${l.lane}`,
        detail: `${l.lane} testLast=failed ama testTs ${ageMin < 0 ? "geçersiz" : ageMin + " dk"} bayat — güvenilmez (phantom-critical önlendi)`,
        action: `${l.lane}: testi YENİDEN koş (taze sonuç al); gerçekten kırıksa CRITICAL olur`, score: 35,
      });
      continue;
    }
    const why = tscBroken ? `tsc ${l.tscErrors || ""} hata` : "test FAILED";
    out.push({
      criticality: "CRITICAL", source: "quality", target: `gate:${l.lane}`,
      detail: `${l.lane} kalite kapısı kırık (${why})`, action: `${l.lane}: ${why} düzelt (her şeyi bloklar)`, score: 100,
    });
  }
  // redLanes: tazelik-kanıtı yok (worker türevi) → CRITICAL DEĞİL, COMPLETENESS-doğrula (phantom önle).
  const laneNames = new Set((q?.lanes || []).map((l: any) => l.lane));
  for (const r of q?.redLanes || []) {
    const lane = typeof r === "string" ? r : r.lane;
    if (laneNames.has(lane)) continue; // lanes[] zaten tazelik-kontrollü işledi
    out.push({ criticality: "COMPLETENESS", source: "quality(unverified)", target: `redlane:${lane}`, detail: `${lane} redLanes'te ama tazelik-kanıtı yok`, action: `${lane}: testi taze koş, gerçekten kırıksa CRITICAL`, score: 35 });
  }
  return out;
}

/** target-fingerprint ile dedupe; en yüksek criticality (en küçük rank) kazanır, source'lar birleşir. */
export function dedupe(reqs: Requirement[]): Requirement[] {
  // Öndeki TÜM bilinen prefix zincirini soy ("dod:gate:backend" → "backend").
  const fp = (r: Requirement) => r.target.toLowerCase().replace(/^((crit|dod|red|gate|lic|next|stale|sec|reg|drift):)+/, "").trim();
  const best = new Map<string, Requirement>();
  for (const r of reqs) {
    const k = fp(r);
    const cur = best.get(k);
    if (!cur) { best.set(k, { ...r }); continue; }
    if (critRank(r.criticality) < critRank(cur.criticality) || (r.criticality === cur.criticality && r.score > cur.score)) {
      best.set(k, { ...r, source: mergeSrc(cur.source, r.source) });
    } else {
      cur.source = mergeSrc(cur.source, r.source);
    }
  }
  return [...best.values()];
}
function mergeSrc(a: string, b: string): string {
  const set = new Set([...a.split("+"), ...b.split("+")]);
  return [...set].sort().join("+");
}

/** Tüm gereksinim critical-first: criticality-rank → score desc → lexicographic. */
export function rankCritical(reqs: Requirement[]): Requirement[] {
  return [...reqs].sort(
    (a, b) => critRank(a.criticality) - critRank(b.criticality) || b.score - a.score || a.target.localeCompare(b.target),
  );
}

/** Proje hazırlık skoru 0-100. CRITICAL ağır ceza. Deterministik. */
export function scoreReadiness(reqs: Requirement[]): number {
  const W: Record<Criticality, number> = {
    CRITICAL: 25, SECURITY: 15, CONTRACT: 10, DRIFT: 6, REGRESSION: 6, COMPLETENESS: 3, STALE: 2, ROADMAP: 1,
  };
  return Math.max(0, 100 - reqs.reduce((s, r) => s + W[r.criticality], 0));
}

/** Tek en-kritik gereksinim (rank sonrası ilk). */
export function topCritical(reqs: Requirement[]): Requirement | null {
  const ranked = rankCritical(reqs);
  return ranked.length ? ranked[0] : null;
}

// ── vO15: staleness-guard (phantom-critical önle) ─────────────────────────────

/** Kaynak JSON ts `maxMinutes`'ten taze mi. Geçersiz/boş ts → bayat (güvenli; phantom-critical önle). */
export function sourceFresh(ts: string | undefined, maxMinutes = 60, nowMs = Date.now()): boolean {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) / 60000 <= maxMinutes;
}

/** Bayat-kaynak için uyarı-Requirement (finding'leri discard edilir, yerine bu). */
export function staleWarning(source: string, ts: string | undefined, refreshCmd: string): Requirement {
  const ageMin = Number.isFinite(Date.parse(ts || "")) ? Math.round((Date.now() - Date.parse(ts!)) / 60000) : -1;
  return {
    criticality: "COMPLETENESS", source: `${source}(stale)`, target: `stale:${source}`,
    detail: `${source} verisi ${ageMin < 0 ? "geçersiz-ts" : ageMin + " dk"} bayat — füzyondan ÇIKARILDI (phantom-critical önlendi)`,
    action: `${refreshCmd} yeniden koş (taze ${source} üret)`, score: 35,
  };
}

/**
 * QUALITY.lanes'ten güvenilmez-kırık lane adları → Set.
 * - testLast=failed AMA testTs bayat (per-lane kanıt-ts).
 * - vO41: tsc-fail AMA QUALITY dosya-ts'i bayat — tsc'nin per-lane ts'i yok, tek kanıt dosya ts'i.
 *   (Silinmiş worktree'nin bayat tsc-RED'i phantom-CRITICAL üretmesin.)
 */
export function staleFailLanes(q: any, maxMinutes = 60, nowMs = Date.now()): Set<string> {
  const out = new Set<string>();
  const fileStale = !sourceFresh(q?.ts, maxMinutes, nowMs);
  for (const l of q?.lanes || []) {
    if (l.testLast === "failed" && !sourceFresh(l.testTs, maxMinutes, nowMs)) out.add(l.lane);
    if (fileStale && (l.tsc === "fail" || (l.tscErrors ?? 0) > 0)) out.add(l.lane);
  }
  return out;
}

/**
 * conduct (ve türev) CRITICAL/RED req'leri kaynak-tazeliğiyle guard'la: lane'i staleFailLanes'teyse
 * → COMPLETENESS-stale'e downgrade (bayat-türev RED'den phantom-CRITICAL önle). Saf.
 * target sonundaki lane ("red:backend" → "backend") staleSet ile eşlenir.
 */
export function guardStaleConduct(reqs: Requirement[], staleLanes: Set<string>): Requirement[] {
  if (!staleLanes.size) return reqs;
  return reqs.map((r) => {
    if (r.criticality !== "CRITICAL") return r;
    const lane = r.target.split(":").pop() || "";
    if (!staleLanes.has(lane)) return r;
    return {
      ...r, criticality: "COMPLETENESS", source: `${r.source}(stale)`,
      detail: `${r.detail} — testTs bayat, güvenilmez (phantom-critical önlendi)`,
      action: `${lane}: testi taze koş; gerçekten kırıksa CRITICAL olur`, score: 35,
    };
  });
}

/**
 * Kaynağı tazelik-kontrollü normalize et: taze → findings; bayat → discard + staleWarning.
 * Phantom-critical (bayat-audit'ten yanlış CRITICAL) kökten önlenir.
 */
export function normalizeFresh(
  source: string, findings: Finding[], ts: string | undefined, refreshCmd: string, maxMinutes = 60, nowMs = Date.now(),
): Requirement[] {
  if (sourceFresh(ts, maxMinutes, nowMs)) return normalizeFindings(source, findings);
  return findings.length ? [staleWarning(source, ts, refreshCmd)] : [];
}
