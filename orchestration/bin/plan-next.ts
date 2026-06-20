#!/usr/bin/env tsx
/**
 * orchestration/bin/plan-next.ts — Trigger §4 otomasyonu: "sıradaki versiyonu planla [lane]".
 *
 * READ-ONLY: bir lane'in ROADMAP + SEYIR + errors_registry'sini parse eder, DETERMİNİSTİK
 * (LLM yok) bir sonraki-versiyon TASLAĞI üretir: spec → plan → tasks + optimal prompt +
 * don't-repeat hatalar. İnsan/lane-sekmesi rafine eder. Bu sekme lane kodunu YAZMAZ (§3).
 *
 * Adopt (pattern, kod değil): github/spec-kit (MIT, spec→plan→tasks) + Vanderbilt SPDD
 * (5-parça prompt) + native regex (zero-dep; marked/gray-matter eklenmedi).
 *
 * Çalıştır: tsx orchestration/bin/plan-next.ts <lane>   (lane: scripts|cli|frontend|...)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, findFile, resolveLane, KNOWN_LANES, type Worktree } from "./shared";
import { defaultStore, readClaims, detectCollision, acquireClaim, claimKey } from "./lib/claims";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");

export type VStatus = "done" | "next" | "planned";
export interface VersionEntry { ver: string; title: string; status: VStatus; }
export interface ErrItem { id: string; prevention_rule: string; }

// ── Pure parsers (test edilebilir) ───────────────────────────────────────────

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function cleanTitle(s: string): string {
  return s.replace(/[|*#>`]/g, " ").replace(/\(?(✅|⬜|🔨|▶|DONE|NEXT|ACTIVE|planned)\)?/gi, " ")
    .replace(/[—\-:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Satır metninden versiyon durumu. */
export function statusOf(text: string): VStatus {
  if (/✅|\bDONE\b/i.test(text)) return "done";
  // NEXT büyük-harf-duyarlı: başlıktaki "plan-next.ts" gibi lowercase 'next'i statü sanma.
  if (/\bNEXT\b/.test(text) || /🔨|▶|\bACTIVE\b|sıradaki/i.test(text)) return "next";
  return "planned";
}

/** ROADMAP/AGENTS markdown'ından versiyonları çıkar (heading VE tablo formları). İlk geçiş kazanır. */
export function parseVersions(md: string): VersionEntry[] {
  const out: VersionEntry[] = [];
  const seen = new Set<string>();
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    let ver = "", rest = "";
    const h = line.match(/^#{1,4}\s*(v[FO]?\d+(?:\.\d+)?|Faz\s*\d+)\b[ \t]*[—\-:]?\s*(.*)$/i);
    if (h) { ver = h[1]; rest = h[2] || ""; }
    else {
      const t = line.match(/^\|\s*\*{0,2}(v[FO]?\d+(?:\.\d+)?)\*{0,2}\s*\|(.*)$/i);
      if (t) { ver = t[1]; rest = t[2] || ""; }
    }
    if (!ver) continue;
    const key = ver.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ver: ver.replace(/\s+/g, " ").trim(), title: cleanTitle(rest), status: statusOf(rest + " " + line) });
  }
  return out;
}

/** current = son done; next = ilk 'next', yoksa current sonrası ilk 'planned'. */
export function currentAndNext(vs: VersionEntry[]): { current?: VersionEntry; next?: VersionEntry } {
  let current: VersionEntry | undefined;
  for (const v of vs) if (v.status === "done") current = v;
  let next = vs.find((v) => v.status === "next");
  if (!next) {
    const ci = current ? vs.indexOf(current) : -1;
    next = vs.slice(ci + 1).find((v) => v.status === "planned");
  }
  return { current, next };
}

/** index'ten itibaren blok topla: yeni `## ` başlığı veya 2 ardışık boş satıra kadar (max 25). */
function collectBlock(lines: string[], start: number): string {
  const acc: string[] = [];
  let blanks = 0;
  for (let i = start; i < lines.length && acc.length < 25; i++) {
    const l = lines[i];
    if (i > start && /^#{1,3}\s/.test(l)) break;
    if (!l.trim()) { if (++blanks >= 2) break; } else blanks = 0;
    acc.push(l);
  }
  return acc.join("\n").trim();
}

/** Sonraki-versiyon niyet bloğu: "Next precomputed" → "## <ver> NEXT" → tablo NEXT satırı. */
export function extractNextBlock(md: string, nextVer?: string): string {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/next precomputed|önceden.?hesaplan|sıradaki/i.test(lines[i])) return collectBlock(lines, i);
  }
  if (nextVer) {
    const re = new RegExp(`^#{1,4}\\s*${escapeRe(nextVer)}\\b.*\\bnext\\b`, "i");
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return collectBlock(lines, i + 1);
    for (const l of lines) if (/\bnext\b/i.test(l) && l.toLowerCase().includes(nextVer.toLowerCase())) return l.trim();
  }
  return "";
}

/** Checkbox + numaralı todo'lar. */
export function extractTodos(block: string): string[] {
  const out: string[] = [];
  for (const l of block.split("\n")) {
    let m = l.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+)$/);
    if (!m) m = l.match(/^\s*\d+\.\s+(.+)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Lane'in "Canonical prompt:" satırı (varsa). */
export function extractCanonicalPrompt(md: string): string {
  const m = md.match(/\*\*\s*canonical prompt\s*:?\s*\*\*\s*:?\s*(.+)/i);
  return m ? m[1].trim() : "";
}

/** errors_registry JSON metninden son N hata → {id, prevention_rule} (don't-repeat). */
export function recentErrors(jsonText: string, n = 5): ErrItem[] {
  try {
    const j = JSON.parse(jsonText);
    const errs = Array.isArray(j.errors) ? j.errors : [];
    return errs.slice(-n).map((e: Record<string, string>) => ({
      id: e.id || "?", prevention_rule: e.prevention_rule || "",
    }));
  } catch { return []; }
}

// ── Composer (Spec Kit spec→plan→tasks + Vanderbilt 5-parça prompt) ───────────

export interface DraftInput {
  lane: string; branch: string; wtPath: string;
  current?: VersionEntry; next?: VersionEntry;
  nextBlock: string; todos: string[]; canonical: string; errors: ErrItem[];
  sources: string[]; contractFile: string;
}

export function buildNextDraft(d: DraftInput): string {
  const cur = d.current ? `${d.current.ver} (${d.current.title})` : "?";
  const nxt = d.next ? `${d.next.ver} (${d.next.title})` : "(belirlenemedi — ROADMAP'e planlı versiyon ekle)";
  const todoList = d.todos.length ? d.todos.map((t) => `- [ ] ${t}`).join("\n") : "- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)";
  const dont = d.errors.length ? d.errors.map((e) => `- ${e.id}: ${e.prevention_rule}`).join("\n") : "- (kayıtlı hata yok)";
  const canon = d.canonical ? `\n**Lane canonical prompt:** ${d.canonical}\n` : "";

  // Vanderbilt SPDD 5-parça: Context / Task / Constraints / Format / Examples.
  const prompt = [
    `Sen ${d.lane} lane sekmesisin (branch ${d.branch}).`,
    ``,
    `**[Context]** Sözleşmen: ${d.contractFile}. Önce onu + SEYIR + errors_registry oku. Mevcut: ${cur} DONE. Hedef: ${nxt}.`,
    `**[Task]** ${nxt} versiyonunu kesintisiz, eksiksiz kodla. Niyet:`,
    d.nextBlock ? d.nextBlock.split("\n").map((l) => `  > ${l}`).join("\n") : "  > (ROADMAP'te next-bloğu yok; niyeti netleştir.)",
    `**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:`,
    dont.split("\n").map((l) => `  ${l}`).join("\n"),
    `**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).`,
    `**[Examples]** Önceki versiyon ${cur} kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.`,
  ].join("\n");

  return [
    `# NEXT — ${d.lane} lane → ${nxt}`,
    ``,
    `> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.`,
    `> Kaynaklar: ${d.sources.map((s) => basename(s)).join(", ") || "—"}`,
    `> Mevcut: **${cur}** → Hedef: **${nxt}**`,
    canon,
    `## Spec (niyet)`,
    d.nextBlock || "_ROADMAP'te 'Next precomputed' bloğu yok — lane sekmesi niyeti netleştirsin._",
    ``,
    `## Plan / Phase + Tasks`,
    todoList,
    ``,
    `## Don't-repeat (errors_registry)`,
    dont,
    ``,
    `## Optimal Prompt (lane sekmesine yapıştır)`,
    "```",
    prompt,
    "```",
    ``,
    `---`,
    `_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._`,
  ].join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function findContract(wt: Worktree): string {
  const f = findFile(wt.path, /_AGENTS\.md$/i) || findFile(wt.path, /^AGENTS\.md$/);
  return f || "(sözleşme bulunamadı)";
}

/**
 * vO7 Work-Claim gate (additive, stderr-only — stdout taslağı değişmez): bu lane|version'ı BAŞKA
 * canlı sekme tutuyor mu? Tutuyorsa uyar (duplikasyon önleme, ERR-ORCH-013). Boşsa bilgi ver;
 * `--claim` ile bu sekme adına claim et (opt-in yan-etki, yalnız orchestration/seyir altına yazar).
 */
function claimGate(lane: string, version?: string): void {
  if (!version) return;
  const store = defaultStore(join(ORCH_DIR, "seyir"));
  const tab = process.env.ORCH_TAB || `tab-${process.pid}`;
  const events = readClaims(store);
  const collision = detectCollision(events, lane, version, tab, Date.now());
  if (collision) {
    console.error(`\n⚠️⚠️ ÇAKIŞMA: ${claimKey(lane, version)} zaten ${collision.tab} (pid ${collision.pid}) tarafından claim edilmiş.`);
    console.error(`   BAŞKA bir iş seç ya da o sekmeyle koordine ol → tsx orchestration/bin/claim.ts --list\n`);
    return;
  }
  if (process.argv.includes("--claim")) {
    const r = acquireClaim(store, { lane, version, tab, pid: process.pid });
    console.error(r.ok ? `🔒 [plan-next] ${claimKey(lane, version)} claim edildi (${tab}).` : `⚠️ claim yarışı kaybedildi: ${r.collision?.tab}`);
  } else {
    console.error(`ℹ️ [plan-next] ${claimKey(lane, version)} boş. Claim: tsx orchestration/bin/claim.ts ${lane} ${version}  (veya plan-next --claim)`);
  }
}

function main(): void {
  const arg = process.argv[2];
  const wts = discoverWorktrees();
  if (!arg) {
    console.error(`Kullanım: plan-next.ts <lane>\nBilinen lane'ler: ${KNOWN_LANES.join(", ")}`);
    console.error(`Keşfedilen worktree branch'leri:\n${wts.map((w) => "  - " + w.branch).join("\n")}`);
    process.exit(2);
  }
  const wt = resolveLane(arg, wts);
  if (!wt) {
    console.error(`Lane çözülemedi: "${arg}". Bilinen: ${KNOWN_LANES.join(", ")}`);
    process.exit(1);
  }
  // Sıra: ROADMAP* → lane-contract *_AGENTS.md (roadmap tablosu burada, örn FRONTEND_AGENTS) → canonical AGENTS.md.
  const roadmapF = findFile(wt.path, /roadmap.*\.md$/i) || findFile(wt.path, /_AGENTS\.md$/i) || findFile(wt.path, /^AGENTS\.md$/);
  const errorsF = findFile(wt.path, /errors_registry\.json$/);
  const md = roadmapF ? readFileSync(roadmapF, "utf8") : "";
  const errJson = errorsF ? readFileSync(errorsF, "utf8") : "";

  const versions = parseVersions(md);
  const { current, next } = currentAndNext(versions);
  claimGate(arg, next?.ver); // vO7: duplikasyon-önleme (başka sekme bu işi tutuyor mu?)
  const nextBlock = extractNextBlock(md, next?.ver);
  const draft = buildNextDraft({
    lane: arg, branch: wt.branch, wtPath: wt.path,
    current, next, nextBlock,
    todos: extractTodos(nextBlock), canonical: extractCanonicalPrompt(md),
    errors: recentErrors(errJson), sources: [roadmapF, errorsF].filter(Boolean) as string[],
    contractFile: findContract(wt),
  });

  console.log(draft);
  const plansDir = join(ORCH_DIR, "plans");
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });
  const outF = join(plansDir, `NEXT_${arg}.md`);
  writeFileSync(outF, draft + "\n");
  console.error(`\n[plan-next] ${arg}: ${current?.ver || "?"} → ${next?.ver || "?"}; yazıldı → ${outF}`);
}

// Test importunda main koşmasın (yalnız doğrudan çalıştırınca).
if (process.argv[1] && /plan-next\.ts$/.test(process.argv[1])) main();
