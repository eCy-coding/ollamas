#!/usr/bin/env tsx
/**
 * cli/lib/role.ts — live identity generator for the ollamas CLI tab (READ-ONLY).
 *
 * Reads VERSION / ROADMAP / git / seyir live (cwd-independent via import.meta.url)
 * and renders the tab-identity answer. No hardcoded stage — the answer self-updates
 * as the project ships. Run directly (`tsx cli/lib/role.ts`) or via the
 * UserPromptSubmit hook (cli/bin/role-hook.ts). Zero-dep (node built-ins only).
 *
 * Adopted from the in-repo orchestration vO-ID pattern (MIT, our own code):
 * pure parsers + pure renderer + a thin live gather() — so the renderer is unit-
 * testable and the "no stale memory" guarantee is provable.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // cli/lib
const ROOT = join(HERE, "..", ".."); // worktree root — cwd-independent

export interface VersionStage {
  ver: string;
  theme: string;
}
export interface RoleInputs {
  version: string;
  shipped: VersionStage | null;
  next: VersionStage | null;
  branch: string;
  lastCommit: string;
  gotchas: string[];
  mission: string;
}

// --- pure parsers (no I/O) ---

// `const VERSION = "11.0.0";` → "11.0.0"
export function parseVersion(indexTs: string): string {
  const m = indexTs.match(/const VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : "?";
}

// ROADMAP rows: `| **v11** | Keychain + secrets v2 | core… | ✅ DONE |`
// shipped = last ✅ DONE row; next = first ▶ NEXT row.
export function parseRoadmap(md: string): { shipped: VersionStage | null; next: VersionStage | null } {
  let shipped: VersionStage | null = null;
  let next: VersionStage | null = null;
  for (const line of md.split("\n")) {
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length < 5) continue;
    const verM = cols[1].match(/\*\*(v[\w.+-]+)\*\*/);
    if (!verM) continue;
    const stage: VersionStage = { ver: verM[1], theme: cols[2] };
    const status = cols[cols.length - 2];
    if (status.includes("✅ DONE")) shipped = stage; // last DONE wins
    else if (status.includes("▶ NEXT") && !next) next = stage; // first NEXT wins
  }
  return { shipped, next };
}

// `### N-024 · keychain per-user` → "N-024 · keychain per-user"; last n.
export function parseGotchas(seyirMd: string, n = 2): string[] {
  const hits = seyirMd
    .split("\n")
    .filter((l) => /^### [EN]-\d+/.test(l))
    .map((l) => l.replace(/^###\s*/, "").trim());
  return hits.slice(-n);
}

// First paragraph under "## §0" (the North Star / mission).
export function parseMission(agentsMd: string): string {
  const m = agentsMd.match(/##\s*§0[^\n]*\n+([^\n]+(?:\n[^\n#][^\n]*)*)/);
  return m ? m[1].replace(/\s*\n\s*/g, " ").trim() : "ollamas için tek, birleşik `ollamas` CLI inşa et.";
}

// --- pure renderer ---
export function buildRoleAnswer(i: RoleInputs): string {
  const ship = i.shipped ? `**${i.shipped.ver}** (${i.shipped.theme})` : "—";
  const nxt = i.next ? `**${i.next.ver}** (${i.next.theme})` : "—";
  const gotchas = i.gotchas.length ? i.gotchas.map((g) => `- ${g}`).join("\n") : "- —";
  return `# Bu sekme = ollamas CLI Forge (area=cli)

## Görev — TEK alan: \`ollamas\` CLI
${i.mission}
CLI-dışı istek → reddet, doğru lane'e yönlendir.

## Sınırlar (ihlal = hata)
- Scope Law: yalnız \`cli/**\`
- Choke-point: yalnız HTTP \`/api/*\` + \`/mcp\` (server/tool-registry import YOK)
- Zero-dep TS · pure-core + thin-IO · TTY-aware · evidence-before-claims
- İzole worktree + faz-başı commit · kalite kapısı \`tsc→vitest(fresh)→lint\` green olmadan commit yok

## Çalışma akışı ("sıradaki versiyonu planla" tetiği)
adoption research (lisans disiplini) → todo+phase (saf-fn test önce) → adım adım kodla + faz commit → ROADMAP/seyir/memory → sıradaki versiyon precompute.

## 📍 GÜNCEL AŞAMA (canlı — VERSION ${i.version})
- shipped: ${ship}
- next: ${nxt}
- branch: \`${i.branch}\` · son commit: \`${i.lastCommit}\`

## Aktif gotcha'lar (seyir son)
${gotchas}

## Kapanış
Ne ister misin? Özellik söyle → kodlarım · ya da **"sıradaki versiyonu planla"** → ${i.next ? i.next.ver : "sıradaki"} başlar.`;
}

// --- live I/O gather (cwd-independent) ---
function safeRead(rel: string): string {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}
function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function gatherInputs(): RoleInputs {
  const { shipped, next } = parseRoadmap(safeRead("cli/ROADMAP.md"));
  return {
    version: parseVersion(safeRead("cli/index.ts")),
    shipped,
    next,
    branch: git(["branch", "--show-current"]) || "?",
    lastCommit: git(["log", "--oneline", "-1"]) || "?",
    gotchas: parseGotchas(safeRead("cli/CLI_SEYIR_DEFTERI.md")),
    mission: parseMission(safeRead("cli/CLI_AGENTS.md")),
  };
}

// Run directly → print the live identity (manual fallback if the hook didn't fire).
if (process.argv[1] && /role\.ts$/.test(process.argv[1])) {
  process.stdout.write(buildRoleAnswer(gatherInputs()) + "\n");
}
