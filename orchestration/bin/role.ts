#!/usr/bin/env tsx
/**
 * orchestration/bin/role.ts — Self-updating kimlik/görev jeneratörü (READ-ONLY, zero-dep).
 *
 * "Bu sekmede görevin nedir? Ne yaparsın?" sorusuna DAİMA canlı durumla yanıt üretir:
 * mission (ORCHESTRATION_AGENTS §0) + mevcut/sıradaki vO (ROADMAP) + ollamas proje aşaması
 * (server.json+git) + canlı lane listesi + araç envanteri + geliştirilebilir aşamalar.
 * Hardcode YOK → proje ilerledikçe yanıt kendini günceller (RISK-ORCH-002 stale-drift kapanır).
 *
 * Çalıştır: tsx orchestration/bin/role.ts   (→ stdout + orchestration/ROLE.md)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { git, findFile, ANCHOR } from "./shared";
import { parseVersions, currentAndNext, type VersionEntry } from "./plan-next";
import { collect } from "./lib/collect";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const BIN_DIR = join(HERE);

export interface RoleInputs {
  mission: string;
  current?: VersionEntry;
  next?: VersionEntry;
  planned: VersionEntry[];     // sıradaki geliştirilebilir aşamalar
  ollamasVersion: string;
  ollamasBranch: string;
  lanes: { branch: string; done?: string; next?: string; dirty?: number }[];
  tools: { name: string; gist: string }[];
}

/** Branch'ten kısa lane adı (gösterim). feat/frontend-vf3 → frontend-vf3. */
function laneShort(branch: string): string {
  return branch.replace(/^feat\//, "");
}
const clip = (s: string | undefined, n: number): string =>
  s && s.trim() ? (s.length > n ? s.slice(0, n - 1) + "…" : s) : "—";

/** Saf: girdilerden Türkçe kimlik yanıtı üret (test edilebilir). */
export function buildRoleAnswer(i: RoleInputs): string {
  const cur = i.current ? `${i.current.ver} (${i.current.title})` : "?";
  const nxt = i.next ? `${i.next.ver} (${i.next.title})` : "(ROADMAP'e planlı versiyon ekle)";
  const future = i.planned.length
    ? i.planned.map((v) => `- ${v.ver}: ${v.title}`).join("\n")
    : "- (ROADMAP'te planned vO yok)";
  const toolList = i.tools.length
    ? i.tools.map((t) => `- \`${t.name}\` — ${t.gist}`).join("\n")
    : "- (araç bulunamadı)";
  const laneList = i.lanes.map((l) => `\`${l.branch}\``).join(" · ");

  // Per-lane canlı tablo: şu an (shipped) → geliştirilebilir sonraki (collect roadmap sinyali).
  const laneRows = i.lanes.map(
    (l) => `| \`${laneShort(l.branch)}\` | ${clip(l.done, 38)} | → ${clip(l.next, 38)} | ${l.dirty ?? 0}△ |`,
  );
  // Developable stages = her lane'in NEXT'i (boş olmayanlar).
  const laneNext = i.lanes
    .filter((l) => l.next && l.next.trim())
    .map((l) => `- **${laneShort(l.branch)}** → ${clip(l.next, 60)}`);

  return [
    `# Bu sekme = ollamas Orkestra Şefi (orchestration lane)`,
    ``,
    `> Canlı durum (\`role.ts\` üretti — bayat değil). ollamas **${i.ollamasVersion}** @ \`${i.ollamasBranch}\`.`,
    ``,
    `## Görev`,
    i.mission,
    ``,
    `## Ne yaparım`,
    `- **İzle:** \`status.ts\` → lane durum matrisi (branch/commit/dev-server/idle/hata)`,
    `- **Planla:** "sıradaki versiyonu planla [lane]" → o lane'in todo+phase+optimal-prompt'u (lane sekmesi kodlar)`,
    `- **Koordine:** çapraz-lane bağımlılık (\`depgraph.ts\`), version-drift, çakışma`,
    `- **Adoption:** GitHub e2e-search → lisans-disiplini gate (\`adopt.ts\`), no vibe-code`,
    `- **Benchmark:** \`bench.ts\` → MacBook+iOS tok/s, en-verimli model`,
    `- **Logla:** hata → errors_registry, asla tekrarlama`,
    ``,
    `## Sınır (Scope Law §3)`,
    `- **YAPABİLİR:** yalnız \`orchestration/**\` yaz + lane'lere read-only eriş`,
    `- **YAPAMAZ:** lane kodu (src/server/cli/scripts), commit, endpoint → backlog+prompt veririm`,
    `- İzole worktree, branch git ile doğrulanır (RISK-ORCH-001 branch-hijack)`,
    ``,
    `## Mevcut aşama`,
    `- Orchestration: **${cur} DONE** → sıradaki **${nxt}**`,
    `- İzlenen lane'ler (${i.lanes.length}): ${laneList}`,
    ``,
    `## Şu anki ollamas aşaması (canlı — her lane shipped → geliştirilebilir)`,
    `| Lane | Şu an (shipped) | → Geliştirilebilir sonraki | dirty |`,
    `|------|-----------------|----------------------------|-------|`,
    ...laneRows,
    ``,
    `## Geliştirilebilir aşamalar (ROADMAP planned)`,
    future,
    ``,
    `### Lane bazında geliştirilebilir sonraki (canlı NEXT sinyalleri)`,
    laneNext.length ? laneNext.join("\n") : "- (lane NEXT sinyali okunamadı)",
    ``,
    `## Araç envanteri (${i.tools.length} bin/)`,
    toolList,
    ``,
    `## Tetik`,
    `**"sıradaki versiyonu planla [lane]"** → kesintisiz plan+prompt (READ→CROSS-THINK→EMIT). Sözleşme: \`ORCHESTRATION_AGENTS.md\` + \`~/Desktop/plan.md\`.`,
  ].join("\n");
}

// ── Canlı toplayıcılar ────────────────────────────────────────────────────────

/** §0 Kuzey Yıldızı ilk anlamlı paragrafı (mission). */
function readMission(): string {
  const f = join(ORCH_DIR, "ORCHESTRATION_AGENTS.md");
  if (!existsSync(f)) return "ollamas'ın 8 lane sekmesini read-only izleyen + koordine eden orkestra şefi. Kod yazmaz.";
  const lines = readFileSync(f, "utf8").split("\n");
  const i0 = lines.findIndex((l) => /Kuzey Yıldızı/i.test(l));
  if (i0 < 0) return "ollamas orkestra şefi (read-only koordinatör).";
  const para: string[] = [];
  for (let i = i0 + 1; i < lines.length && para.length < 6; i++) {
    const l = lines[i].trim();
    if (/^#{1,3}\s/.test(lines[i])) break;
    if (l) para.push(l);
    else if (para.length) break;
  }
  return para.join(" ").replace(/\*\*/g, "**") || "ollamas orkestra şefi.";
}

/** ana repo server.json version. */
function ollamasVersion(): string {
  const f = join(ANCHOR, "server.json");
  try { return "v" + (JSON.parse(readFileSync(f, "utf8")).version || "?"); } catch { return "v?"; }
}

/** bin/*.ts araçları + JSDoc ilk anlamlı satır (gist). role/role-hook hariç. */
function readTools(): { name: string; gist: string }[] {
  const out: { name: string; gist: string }[] = [];
  let files: string[] = [];
  try { files = readdirSync(BIN_DIR); } catch { return out; }
  for (const f of files.sort()) {
    if (!f.endsWith(".ts") || f === "shared.ts" || /role(-hook)?\.ts$/.test(f)) continue;
    let gist = "";
    try {
      const head = readFileSync(join(BIN_DIR, f), "utf8").split("\n").slice(0, 6);
      const line = head.find((l) => /—|--/.test(l) && /\*/.test(l));
      gist = line ? line.replace(/^\s*\*\s*/, "").replace(/^orchestration\/bin\/[\w.-]+\s*—\s*/, "").replace(/\(.*$/, "").trim().slice(0, 70) : "";
    } catch { /* skip */ }
    out.push({ name: f, gist: gist || "(araç)" });
  }
  return out;
}

async function main(): Promise<void> {
  const mission = readMission();
  const roadmapF = findFile(ORCH_DIR, /roadmap_orchestration\.md$/i) || join(ORCH_DIR, "ROADMAP_ORCHESTRATION.md");
  const md = existsSync(roadmapF) ? readFileSync(roadmapF, "utf8") : "";
  const versions = parseVersions(md);
  const { current, next } = currentAndNext(versions);
  const planned = versions.filter((v) => v.status === "planned");

  // Canlı per-lane sinyali (collect REUSE, tek-kaynak): roadmap current/next + dirty.
  // tabMap:null → osascript sekme-keşfini ATLA (hızlı, donma yok — RISK-ORCH-008).
  const snap = await collect({ tabMap: null });
  const lanes = snap.lanes.map((l) => ({
    branch: l.branch, done: l.roadmap.current, next: l.roadmap.next, dirty: l.dirtyFiles,
  }));

  const answer = buildRoleAnswer({
    mission,
    current, next, planned,
    ollamasVersion: ollamasVersion(),
    ollamasBranch: git(ANCHOR, ["branch", "--show-current"]) || "?",
    lanes,
    tools: readTools(),
  });

  console.log(answer);
  writeFileSync(join(ORCH_DIR, "ROLE.md"), answer + "\n");
  console.error(`[role] ${current?.ver || "?"}→${next?.ver || "?"}, ${lanes.length} lane, ${readTools().length} araç.`);
}

if (process.argv[1] && /role\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[role] hata:", e?.message ?? e); process.exit(1); });
}
