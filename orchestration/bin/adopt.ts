#!/usr/bin/env tsx
/**
 * orchestration/bin/adopt.ts — OSS adoption tracker + lisans-disiplini GATE (vO4).
 *
 * READ-ONLY: ADOPTIONS matrislerini parse eder, her satırın lisansını sınıflar, lisans
 * disiplinini DOĞRULAR (GPL+ADOPT = İHLAL). Opsiyonel `gh api` ile canlı stars+license çeker.
 * Kullanıcının her tur manuel yaptığı "GitHub adoption + lisans koru" işini otomatikleştirir.
 *
 * Adopt (DATA/native, kod değil): spdx/license-list-data (embedded map) + `gh api` + copyleft regex.
 *
 * Çalıştır:
 *   tsx orchestration/bin/adopt.ts check              # tüm ADOPTIONS'ı gate'le (ihlalde exit 1)
 *   tsx orchestration/bin/adopt.ts fetch <owner/repo> # canlı stars+license+öneri (gh; offline-graceful)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, findFile, ANCHOR } from "./shared";
import { classifyLicense, decisionAllowed, isCopyleft, type Decision, type LicenseClass } from "./lib/licenses";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");

export interface AdoptionRow { repo: string; stars: string; license: string; decision: Decision; note: string; }
export interface Violation { repo: string; license: string; decision: Decision; reason: string; source: string; }

const DECISION_RE = /\b(pattern-ADOPT|ADOPT|eval-only|ref-only|idea-only|future-ref|mental-model|SKIP)\b/i;
const LICENSE_RE = /(A?GPL[-0-9.]*|LGPL[-0-9.]*|Apache[-0-9.]*|BSD[-0-9. clause]*|MIT|ISC|MPL[-0-9.]*|EPL[-0-9.]*|EUPL[-0-9.]*|SSPL[-0-9.]*|BSL[-0-9.]*|Zlib|CC0[-0-9.]*|Unlicense|Public(?:\s+domain)?|system|own|native|academic|spec|açık)/i;

// ── Pure parsers ──────────────────────────────────────────────────────────────

function cells(line: string): string[] {
  // | a | b | c | → [a,b,c]; baştaki/sondaki boşları at.
  const parts = line.split("|").map((s) => s.trim());
  if (parts.length && parts[0] === "") parts.shift();
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function normDecision(s: string): Decision {
  const m = s.match(DECISION_RE);
  if (!m) return "unknown";
  const d = m[1].toLowerCase();
  if (d === "adopt") return "ADOPT";
  if (d === "pattern-adopt") return "pattern-ADOPT";
  if (d === "skip") return "SKIP";
  return d as Decision;
}

/** Markdown ADOPTIONS tablosundan satırları çıkar (değişken kolon sayısına dayanıklı). */
export function parseAdoptionRows(md: string): AdoptionRow[] {
  const out: AdoptionRow[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|?$/.test(line)) continue; // ayraç satırı
    const cs = cells(line);
    if (cs.length < 3) continue;
    // Başlık satırı? (Repo/License/Lisans/Karar/Decision kelimeleri + veri yok)
    const joined = cs.join(" ");
    if (/\b(repo|repo \/ teknik)\b/i.test(cs[0]) || /^#$/.test(cs[0]) && /lisans|license/i.test(joined) && !LICENSE_RE.test(cs[cs.length - 1])) {
      if (/lisans|license/i.test(joined) && /karar|decision|hedef|ne\b/i.test(joined)) continue;
    }
    if (/^repo$|^repo \/ teknik$/i.test(cs[0])) continue;
    // Repo: ilk hücre (# ise ikinci). ÖNCE belirle ki license araması repo'yu atlasın
    // (repo "native lsof" gibi LICENSE_RE'ye yanlış eşleşmesin).
    let repoIdx = 0;
    if (/^\d+$/.test(cs[0]) || cs[0] === "#") repoIdx = 1;
    const repo = (cs[repoIdx] || "").replace(/[*`]/g, "").trim();
    // Lisans hücresi: repoIdx SONRASI LICENSE_RE eşleşen ilk hücre.
    const licRel = cs.slice(repoIdx + 1).findIndex((c) => LICENSE_RE.test(c));
    if (licRel < 0) continue; // lisans yok → başlık/özet satırı
    const licIdx = repoIdx + 1 + licRel;
    const license = cs[licIdx].replace(/[*`]/g, "").trim();
    // Karar: DECISION_RE eşleşen ilk hücre (yoksa not'tan).
    const decCell = cs.find((c) => DECISION_RE.test(c)) || "";
    const decision = normDecision(decCell);
    const stars = (cs.find((c, i) => i !== repoIdx && /[\d.]+\s*[KkMm]?$|⭐|—/.test(c)) || "—").trim();
    const note = cs[cs.length - 1] || "";
    if (!repo || /^—$/.test(repo)) continue;
    out.push({ repo, stars, license, decision, note });
  }
  return out;
}

/** Lisans hücresini sınıfla — copyleft anahtarı varsa strictest kazanır (örn "Apache/GPL"→copyleft). */
export function classifyCell(licenseCell: string): LicenseClass {
  const clean = licenseCell.replace(/[*`]/g, "").trim();
  if (isCopyleft(clean)) return { category: "copyleft", allowCopy: false };
  // Boşluk/parantez/ayraçlarda böl ("MIT (DATA)"→MIT, "Apache/MIT"→Apache); ilk bilinen kazanır.
  for (const part of clean.split(/[\/,→|()\s]+| or /i)) {
    if (!part) continue;
    const c = classifyLicense(part);
    if (c.category !== "unknown") return c;
  }
  return classifyLicense(clean);
}

// ── Gate ──────────────────────────────────────────────────────────────────────

export function gate(rows: AdoptionRow[], source = ""): Violation[] {
  const vio: Violation[] = [];
  for (const r of rows) {
    if (r.decision === "unknown") continue; // karar belirsiz → satır bilgilendirme, gate'leme
    const cls = classifyCell(r.license);
    const verdict = decisionAllowed(cls.category, r.decision);
    if (!verdict.ok) vio.push({ repo: r.repo, license: r.license, decision: r.decision, reason: verdict.reason, source });
  }
  return vio;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function sh(cmd: string, args: string[]): string {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }); }
  catch { return ""; }
}

function cmdCheck(): void {
  // Orkestrasyon ADOPTIONS + her lane'in *ADOPTION*.md'si (read-only).
  const sources: string[] = [];
  const orchA = join(ORCH_DIR, "ADOPTIONS_ORCHESTRATION.md");
  if (existsSync(orchA)) sources.push(orchA);
  for (const wt of discoverWorktrees()) {
    const f = findFile(wt.path, /adoptions?\.md$/i) || findFile(wt.path, /_ADOPTION\.md$/i);
    if (f && !sources.includes(f)) sources.push(f);
  }
  const allVio: Violation[] = [];
  let total = 0;
  const lines: string[] = ["# ADOPTIONS_STATUS — lisans-disiplini gate", "", `> \`adopt.ts check\` üretti. Kaynak: ${sources.length} dosya.`, ""];
  for (const src of sources) {
    const rows = parseAdoptionRows(readFileSync(src, "utf8"));
    total += rows.length;
    const vio = gate(rows, basename(src));
    allVio.push(...vio);
    lines.push(`- ${basename(src)}: ${rows.length} satır, ${vio.length} ihlal`);
  }
  lines.push("");
  if (allVio.length) {
    lines.push(`## ⚠️ ${allVio.length} İHLAL`, "");
    for (const v of allVio) lines.push(`- **${v.repo}** (${v.license}) → \`${v.decision}\` @ ${v.source}: ${v.reason}`);
  } else {
    lines.push(`## ✅ İhlal yok (${total} satır temiz)`);
  }
  const md = lines.join("\n") + "\n";
  console.log(md);
  writeFileSync(join(ORCH_DIR, "ADOPTIONS_STATUS.md"), md);
  console.error(`[adopt] ${total} satır, ${allVio.length} ihlal, ${sources.length} kaynak.`);
  if (allVio.length) process.exit(1);
}

function cmdFetch(slug: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) { console.error(`Geçersiz repo: "${slug}" (owner/repo beklenir)`); process.exit(2); }
  const raw = sh("gh", ["api", `repos/${slug}`, "--jq", "{stars: .stargazers_count, license: (.license.spdx_id // \"NONE\")}"]);
  if (!raw.trim()) { console.error(`fetch atlandı: gh yok/unauth/offline (${slug})`); process.exit(0); }
  let data: { stars?: number; license?: string } = {};
  try { data = JSON.parse(raw); } catch { console.error("gh çıktısı parse edilemedi"); process.exit(0); }
  const lic = data.license && data.license !== "NONE" ? data.license : "(lisans yok)";
  const cls = classifyLicense(lic);
  const suggest = cls.category === "permissive" ? "ADOPT (kopya+attribution)"
    : cls.category === "unknown" ? "idea-only (lisans doğrula)"
    : "ref-only (kod kopyalama)";
  console.log(`${slug}\n  ⭐ ${data.stars ?? "?"}\n  Lisans: ${lic} (${cls.category})\n  Öneri: ${suggest}`);
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "check") return cmdCheck();
  if (cmd === "fetch" && arg) return cmdFetch(arg);
  console.error("Kullanım:\n  adopt.ts check\n  adopt.ts fetch <owner/repo>");
  process.exit(2);
}

if (process.argv[1] && /adopt\.ts$/.test(process.argv[1])) main();
