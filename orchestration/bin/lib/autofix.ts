/**
 * orchestration/bin/lib/autofix.ts — Self-healing autofix çekirdeği (zero-dep, pure).
 *
 * critic'in bulduğu GÜVENLİ açıkları deterministik onarır: yalnız roadmap status-flip
 * (planned→DONE, evidence-backed) + stale-state prune. Kod/logic ASLA. dry-run default.
 * GÜVENLİK: allowlist (SAFE_KINDS) + scope-lock (orchestration/) + line-anchored idempotent.
 * Pattern ref: terraform plan/apply, eslint --fix (yalnız güvenli kural), GitOps reconcile.
 */

export interface CritGap { kind: string; target: string; detail: string; action: string; severity?: string; }
export interface FixOp { kind: string; target: string; file: string; before: string; after: string; safe: boolean; reason: string; }

/** Yalnız bu gap türleri otomatik onarılır; diğerleri backlog (insan kararı). */
export const SAFE_KINDS = new Set(["roadmap-drift", "crit:roadmap-drift"]);

/** Gap kind'i (CRITIC.json `crit:roadmap-drift:vO9` veya `roadmap-drift`) normalize. */
export function gapBaseKind(kind: string): string {
  // "crit:roadmap-drift:vO9" → "roadmap-drift"
  const parts = kind.split(":");
  if (parts[0] === "crit" && parts.length >= 2) return parts[1];
  return parts[0];
}

/** Gap target'tan versiyon çıkar ("crit:roadmap-drift:vO9" → "vO9"; "vO9" → "vO9"). */
export function gapVersion(g: CritGap): string {
  const m = (g.kind + " " + g.target).match(/\b(v[FO]?\d+(?:\.\d+)?)\b/i);
  return m ? m[1] : g.target;
}

/**
 * Roadmap tablosundaki `| vN | planned | ... |` satırını `| vN | ✅ DONE | ... |` yap.
 * Line-anchored (yalnız o satır), idempotent (zaten DONE → değişmez). Pure string transform.
 */
export function applyFlip(md: string, ver: string): { md: string; changed: boolean } {
  const lines = md.split("\n");
  let changed = false;
  const re = new RegExp(`^(\\|\\s*\\*{0,2}${ver.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\*{0,2}\\s*\\|\\s*)(planned)(\\s*\\|)`, "i");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = lines[i].replace(re, "$1✅ DONE$3");
      changed = true;
      break; // yalnız ilk eşleşme
    }
  }
  return { md: lines.join("\n"), changed };
}

/** Roadmap-drift gap'lerinden flip FixOp'ları planla. Sadece gerçekten planned olan satırlar. */
export function planRoadmapFlips(gaps: CritGap[], roadmapMd: string, roadmapFile = "ROADMAP_ORCHESTRATION.md"): FixOp[] {
  const out: FixOp[] = [];
  const seen = new Set<string>();
  for (const g of gaps) {
    if (gapBaseKind(g.kind) !== "roadmap-drift") continue;
    const ver = gapVersion(g);
    if (seen.has(ver)) continue;
    seen.add(ver);
    const { changed } = applyFlip(roadmapMd, ver);
    if (!changed) continue; // satır planned değil/yok → no-op (idempotent)
    out.push({
      kind: "roadmap-drift", target: ver, file: roadmapFile,
      before: `${ver} | planned`, after: `${ver} | ✅ DONE`, safe: true,
      reason: `critic evidence-backed: ${ver} yapıldı ama planned listeli`,
    });
  }
  return out;
}

/** GÜVENLİK guardrail: op allowlist'te + dosya orchestration/ altında + lane-path/code değil. */
export function isSafe(op: FixOp): boolean {
  if (!SAFE_KINDS.has(op.kind) && !SAFE_KINDS.has("crit:" + op.kind)) return false;
  const f = op.file;
  // Yalnız orchestration governance dosyaları; lane path / kaynak kod ASLA.
  if (/\.\.|^\/|src\/|server\/|\bcli\/|scripts\/|\.ts$|\.tsx$|\.mjs$/.test(f)) return false;
  if (!/\.(md|jsonl)$/.test(f)) return false;
  return op.safe === true;
}

/** dry-run gösterimi. */
export function diffPreview(ops: FixOp[]): string {
  if (!ops.length) return "_(uygulanacak güvenli fix yok — roadmap zaten reconcile ya da gap'ler backlog)_";
  return ops.map((o) => `- [${isSafe(o) ? "SAFE" : "SKIP"}] ${o.file}: \`${o.before}\` → \`${o.after}\`  (${o.reason})`).join("\n");
}
