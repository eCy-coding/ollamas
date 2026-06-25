/**
 * suppress.ts — vO14 detector precision: bilinen-kabul-edilebilir bulguları ele (dod/critic).
 *
 * KÖK-NEDEN: dod/critic IO-wrapper (osascript/subprocess) + false-positive duplication'ı GÜRÜLTÜ
 * olarak flag'liyor → autonomous verdict güvenilmez (0-manuel conduct kararını bozar). Suppress =
 * verdict precision (matematiksel/mantıksal/kod-bütünlüğü). **SİLENT-DEĞİL**: elenen bulgular
 * sayı+reason ile raporlanır (no-silent-cap ilkesi) — gizleme değil, gerekçeli-istisna.
 *
 * Saf (IO'suz): loadSuppress dosya-okur ama applySuppress tamamen pure.
 */
import { readFileSync, existsSync } from "node:fs";

export interface SuppressRule {
  detector: "dod" | "critic" | "*";
  kindPattern: string; // bulgu kind'inde aranan ALT-DİZGİ (substring)
  reason: string;      // NEDEN kabul-edilebilir (zorunlu — gerekçesiz suppress yok)
}
export interface Suppressed { kind: string; reason: string; }

/** `.policy-suppress.json` oku → kurallar. Yok/bozuk → []. reason'suz kural ELENİR (gerekçe zorunlu). */
export function loadSuppress(path: string): SuppressRule[] {
  if (!existsSync(path)) return [];
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    const rules = Array.isArray(j?.rules) ? j.rules : [];
    return rules.filter((r: any) =>
      r && typeof r.kindPattern === "string" && r.kindPattern.trim().length > 0 && typeof r.reason === "string" && r.reason.trim().length > 0 &&
      (r.detector === "dod" || r.detector === "critic" || r.detector === "*"));
  } catch { return []; }
}

/**
 * Bulguları suppress kurallarına göre ayır. detector eşleşir (veya '*') + kind kuralın kindPattern'ını
 * İÇERİR → suppressed. Aksi kept. SAF: yan-etki yok, suppressed liste döner (silent-değil).
 */
export function applySuppress<T extends { kind: string }>(
  findings: T[], rules: SuppressRule[], detector: "dod" | "critic",
): { kept: T[]; suppressed: Suppressed[] } {
  const active = rules.filter((r) => r.detector === detector || r.detector === "*");
  const kept: T[] = [];
  const suppressed: Suppressed[] = [];
  for (const f of findings) {
    const hit = active.find((r) => f.kind.includes(r.kindPattern));
    if (hit) suppressed.push({ kind: f.kind, reason: hit.reason });
    else kept.push(f);
  }
  return { kept, suppressed };
}

/** Markdown şeffaflık bloğu: kaç bulgu hangi gerekçeyle elendi (gizleme değil). */
export function suppressedBlock(suppressed: Suppressed[]): string {
  if (!suppressed.length) return "";
  return [
    `## ⏭️ Gerekçeli-istisna (suppressed: ${suppressed.length}) — gizlenmedi, kabul-edildi`,
    ...suppressed.map((s) => `- \`${s.kind}\` — ${s.reason}`),
    ``,
  ].join("\n");
}
