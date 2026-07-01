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
  optimal?: { model: string; tokS: number; chip: string } | null; // vO6 0-manuel optimal runtime (MODEL_SELECTION.json)
  health?: { green: number; red: number; unknown: number } | null;  // vO9 lane sağlık roll-up (QUALITY.json)
  selfPolice?: { completeness: number; dod: number } | null;        // vO10-12 öz-denetim açık-iş (CRITIC/DOD.json)
  topReq?: { criticality: string; target: string; readiness: number } | null; // vO14 fuse birleşik kritik gereksinim (REQUIREMENTS.json)
  council?: { present: number; total: number; covered: number; uncovered: string[] } | null; // model-council roster (COUNCIL_ROSTER.json)
  fleet?: { slots: number; local: number; cloud: number; maxTwoOk: boolean } | null; // local model-fleet plan (FLEET_PLAN.json)
  think?: { registry: number } | null; // sustainable problem-solving loop (PROBLEM_REGISTRY.json)
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
    i.optimal ? `- 🏆 **Optimal runtime (0-manuel):** \`${i.optimal.model}\` @ ${i.optimal.chip} (${i.optimal.tokS} tok/s) — \`MODEL_PROMPT.md\`` : `- Optimal runtime: \`tsx bin/benchprompt.ts\` koş (henüz MODEL_SELECTION.json yok)`,
    i.health ? `- 🩺 **Lane health (vO9):** ${i.health.green}🟢 / ${i.health.red}🔴 / ${i.health.unknown}⚪ — \`QUALITY.md\` (tsc canlı + vitest cache)` : `- Lane health: \`tsx bin/quality.ts\` koş (henüz QUALITY.json yok)`,
    i.selfPolice ? `- 🧭 **Öz-denetim (vO10-12):** completeness ${i.selfPolice.completeness} açık · DoD ${i.selfPolice.dod} yarım-iş — \`CRITIC.md\`/\`DOD.md\` (autopilot→conduct tüketir)` : `- Öz-denetim: \`tsx bin/critic.ts\` + \`tsx bin/dod.ts\` koş`,
    i.topReq ? `- 🎯 **Kritik gereksinim (vO14 füzyon):** ${i.topReq.criticality}:${i.topReq.target} · proje hazırlık ${i.topReq.readiness}/100 — \`REQUIREMENTS.md\` (tüm-gate birleşik)` : `- Kritik gereksinim: \`tsx bin/fuse.ts\` koş (REQUIREMENTS füzyonu)`,
    i.council ? `- 🎭 **Model-council:** roster ${i.council.present}/${i.council.total} seat · lane coverage ${i.council.covered}/7${i.council.uncovered.length ? ` · ⚠️ uncovered: ${i.council.uncovered.join(",")}` : ""} — \`COUNCIL_ROSTER.json\` (yetenek→model→lane)` : `- Model-council: \`tsx bin/council.ts\` koş (roster + E2E analiz)`,
    i.fleet ? `- 🛰 **Model-fleet:** ${i.fleet.slots} slot (local ${i.fleet.local}/cloud ${i.fleet.cloud}) · ≤2/model ${i.fleet.maxTwoOk ? "✅" : "❌"} — \`FLEET_PLAN.md\` (Terminal.app+iTerm2; \`fleet-launch --go\`, \`fleet-conduct\`)` : `- Model-fleet: \`tsx bin/fleet-launch.ts\` koş (Terminal.app+iTerm2 dağıtım planı)`,
    i.think ? `- 🧠 **Think-loop (vO22):** ${i.think.registry} kanıtlı-çözüm registry · problem→proven|NEEDS_RESEARCH (no-guess) — \`PROBLEM_REGISTRY.json\`/\`THINK.md\` (autopilot sürekli çağırır)` : `- Think-loop: \`tsx bin/think.ts\` koş (sürdürülebilir sorun-çözme mekanizması)`,
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

  // vO6 0-manuel optimal runtime (MODEL_SELECTION.json varsa; graceful absent).
  let optimal: RoleInputs["optimal"] = null;
  try {
    const msF = join(ORCH_DIR, "MODEL_SELECTION.json");
    if (existsSync(msF)) {
      const ms = JSON.parse(readFileSync(msF, "utf8"));
      if (ms?.selection?.model) optimal = { model: ms.selection.model, tokS: ms.selection.tokS, chip: ms.chip };
    }
  } catch { /* graceful */ }

  // vO9 lane sağlık roll-up (QUALITY.json varsa; graceful absent).
  let health: RoleInputs["health"] = null;
  try {
    const qF = join(ORCH_DIR, "QUALITY.json");
    if (existsSync(qF)) {
      const q = JSON.parse(readFileSync(qF, "utf8"));
      if (q?.totals) health = { green: q.totals.green ?? 0, red: q.totals.red ?? 0, unknown: q.totals.unknown ?? 0 };
    }
  } catch { /* graceful */ }

  // vO10-12 öz-denetim açık-iş (CRITIC.json + DOD.json varsa; graceful absent).
  let selfPolice: RoleInputs["selfPolice"] = null;
  try {
    const c = existsSync(join(ORCH_DIR, "CRITIC.json")) ? JSON.parse(readFileSync(join(ORCH_DIR, "CRITIC.json"), "utf8")) : null;
    const d = existsSync(join(ORCH_DIR, "DOD.json")) ? JSON.parse(readFileSync(join(ORCH_DIR, "DOD.json"), "utf8")) : null;
    if (c || d) selfPolice = { completeness: (c?.findings ?? []).length, dod: (d?.findings ?? []).length };
  } catch { /* graceful */ }

  // vO14 fuse birleşik kritik gereksinim (REQUIREMENTS.json varsa; graceful absent).
  let topReq: RoleInputs["topReq"] = null;
  try {
    const rF = join(ORCH_DIR, "REQUIREMENTS.json");
    if (existsSync(rF)) {
      const r = JSON.parse(readFileSync(rF, "utf8"));
      if (r?.top) topReq = { criticality: r.top.criticality, target: r.top.target, readiness: r.readiness ?? 0 };
      else if (typeof r?.readiness === "number") topReq = { criticality: "—", target: "tümü karşılandı", readiness: r.readiness };
    }
  } catch { /* graceful */ }

  // model-council roster (COUNCIL_ROSTER.json varsa; graceful absent).
  let council: RoleInputs["council"] = null;
  try {
    const cF = join(ORCH_DIR, "COUNCIL_ROSTER.json");
    if (existsSync(cF)) {
      const c = JSON.parse(readFileSync(cF, "utf8"));
      council = { present: c.present ?? 0, total: c.total ?? 0, covered: (c.lanesCovered ?? []).length, uncovered: c.lanesUncovered ?? [] };
    }
  } catch { /* graceful */ }

  // local model-fleet plan (FLEET_PLAN.json varsa; graceful absent).
  let fleet: RoleInputs["fleet"] = null;
  try {
    const fF = join(ORCH_DIR, "FLEET_PLAN.json");
    if (existsSync(fF)) {
      const p = JSON.parse(readFileSync(fF, "utf8"))?.plan;
      if (p) fleet = { slots: (p.assignments ?? []).filter((a: any) => a.model).length, local: p.localSlots ?? 0, cloud: p.cloudSlots ?? 0, maxTwoOk: p.maxTwoOk ?? false };
    }
  } catch { /* graceful */ }

  // sustainable problem-solving loop (PROBLEM_REGISTRY.json varsa; graceful absent).
  let think: RoleInputs["think"] = null;
  try {
    const tF = join(ORCH_DIR, "PROBLEM_REGISTRY.json");
    if (existsSync(tF)) { const t = JSON.parse(readFileSync(tF, "utf8")); think = { registry: (t.entries ?? []).length }; }
  } catch { /* graceful */ }

  const answer = buildRoleAnswer({
    mission,
    current, next, planned,
    ollamasVersion: ollamasVersion(),
    ollamasBranch: git(ANCHOR, ["branch", "--show-current"]) || "?",
    lanes,
    tools: readTools(),
    optimal,
    health,
    selfPolice,
    topReq,
    council,
    fleet,
    think,
  });

  console.log(answer);
  writeFileSync(join(ORCH_DIR, "ROLE.md"), answer + "\n");
  console.error(`[role] ${current?.ver || "?"}→${next?.ver || "?"}, ${lanes.length} lane, ${readTools().length} araç.`);
}

if (process.argv[1] && /role\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[role] hata:", e?.message ?? e); process.exit(1); });
}
