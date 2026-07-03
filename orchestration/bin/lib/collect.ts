/**
 * collect.ts — vO3 cockpit'in TEK veri kaynağı. status.ts (markdown) + serve.ts (JSON/SSE)
 * aynı `collect()`'i tüketir → DRY, tek gerçek. READ-ONLY (git/lsof/fetch okur, hiç yazmaz).
 *
 * Saf çekirdek (roadmapStruct/errorStruct/buildSnapshot) test edilebilir; `collect()` canlı
 * sarmalayıcı discover.ts + shared.ts + metrics.ts'i birleştirir. Backend fetch best-effort:
 * kapalıysa snapshot.backend=null, matris yine render olur (ERR-ORCH-001 dersi).
 */
import { discoverWorktrees, git, findFile, ANCHOR } from "../shared";
import {
  listenersLive, pidCwdLive, mapServersToWorktrees, discoverTabs, tabWorktree,
  type Worktree as DWorktree,
} from "../discover";
import { parseHealth, sumPromMetric, promGauge, type BackendHealth } from "./metrics";
import { parseAdoptionRows, classifyCell, gate, type AdoptionRow, type Violation } from "../adopt";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RoadmapSignal { current: string; next: string; }
export interface ErrorSignal { count: number; lastId: string | null; }

export interface LaneStatus {
  lane: string;          // kısa ad (branch'ten türetilir gösterimde)
  branch: string;
  head: string;
  ageHours: number;      // son commit yaşı (saat); commit yok → Infinity
  dirtyFiles: number;
  ahead: number;
  behind: number;
  devServer: { port: number; up: boolean } | null;
  tabs: number;          // bu lane'e eşlenen Terminal sekmesi (-1 = keşif atlandı)
  idle: boolean;
  roadmap: RoadmapSignal;
  errors: ErrorSignal;
}

export interface BackendRuntime extends BackendHealth {
  toolCalls: number;        // sum mcp_tool_calls_total
  webhookQueue: number;     // ollamas_webhook_queue_depth gauge
  migrationVersion: number; // ollamas_migration_version gauge
}

/** OSS adoption + lisans-disiplini özeti (adopt.ts/licenses.ts REUSE — cockpit görünürlüğü). */
export interface AdoptionSummary {
  total: number;
  permissive: number;
  weakCopyleft: number;
  copyleft: number;
  unknown: number;
  violations: { repo: string; reason: string }[];
}

/** Contract lane pool özeti (vK9). SADECE sayaçlar — email/keyId ASLA sızmaz. */
export interface ContractSummary {
  members: { pending: number; active: number; rejected: number; revoked: number; suspended: number };
  fleetContractNodes: number;
  shardHeadUp: boolean;
}

export interface CockpitSnapshot {
  ts: string;
  expectedLanes: number;
  lanes: LaneStatus[];
  backend: BackendRuntime | null;
  totals: { live: number; idle: number; dirty: number; errors: number };
  adoptions: AdoptionSummary | null;
  contract: ContractSummary | null;
}

// ── Saf çekirdek ─────────────────────────────────────────────────────────────

const ROADMAP_VER = /v[O]?\d/i;

/** ROADMAP metninden son DONE + ilk NEXT/planned satırı → struct. status.ts ile aynı kural. */
export function roadmapStruct(text: string): RoadmapSignal {
  const lines = text.split("\n");
  const done = lines.filter((l) => /✅|done/i.test(l) && ROADMAP_VER.test(l)).pop();
  const next = lines.find((l) => /next|sıradaki|planned|🔨|active/i.test(l) && ROADMAP_VER.test(l));
  const pick = (s?: string) =>
    s ? s.replace(/[|*#>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48) : "";
  return { current: pick(done), next: pick(next) };
}

/** errors_registry.json → {count, lastId}. Bozuk/eksik → {0, null}. */
export function errorStruct(json: string): ErrorSignal {
  try {
    const j = JSON.parse(json);
    const errs = Array.isArray(j.errors) ? j.errors : [];
    return { count: errs.length, lastId: errs.length ? (errs[errs.length - 1].id ?? null) : null };
  } catch {
    return { count: 0, lastId: null };
  }
}

/**
 * ADOPTIONS satırlarını + gate ihlallerini cockpit özetine indir (saf; test edilebilir).
 * Sınıflandırma adopt.ts `classifyCell` (licenses.ts SPDX DATA) REUSE — yeniden yazılmaz.
 */
export function summarizeAdoptions(rows: AdoptionRow[], violations: Violation[]): AdoptionSummary {
  const s: AdoptionSummary = {
    total: rows.length, permissive: 0, weakCopyleft: 0, copyleft: 0, unknown: 0,
    violations: violations.map((v) => ({ repo: v.repo, reason: v.reason })),
  };
  for (const r of rows) {
    const cat = classifyCell(r.license).category;
    if (cat === "permissive") s.permissive++;
    else if (cat === "weak-copyleft") s.weakCopyleft++;
    else if (cat === "copyleft") s.copyleft++;
    else s.unknown++;
  }
  return s;
}

/** Lane'lerden toplamları türet + snapshot'ı paketle (saf; test edilebilir). */
export function buildSnapshot(input: {
  ts: string;
  expectedLanes: number;
  lanes: LaneStatus[];
  backend: BackendRuntime | null;
  adoptions?: AdoptionSummary | null;
  contract?: ContractSummary | null;
}): CockpitSnapshot {
  const totals = { live: 0, idle: 0, dirty: 0, errors: 0 };
  for (const l of input.lanes) {
    if (l.devServer?.up) totals.live++;
    if (l.idle) totals.idle++;
    totals.dirty += l.dirtyFiles;
    totals.errors += l.errors.count;
  }
  return {
    ts: input.ts, expectedLanes: input.expectedLanes, lanes: input.lanes,
    backend: input.backend, totals, adoptions: input.adoptions ?? null,
    contract: input.contract ?? null,
  };
}

/** PURE (vK9): contract.json + backends.json + shard/head.json → maskeli özet.
 * Girdi bozuk/eksik olabilir — asla throw etmez; üçü de yoksa null. */
export function contractStruct(stateJson: string | null, backendsJson: string | null, headJson: string | null): ContractSummary | null {
  if (stateJson == null && backendsJson == null && headJson == null) return null;
  const members = { pending: 0, active: 0, rejected: 0, revoked: 0, suspended: 0 };
  try {
    const s = JSON.parse(stateJson || "{}") as { members?: Array<{ status?: string }> };
    for (const m of s.members || []) {
      const k = String(m.status) as keyof typeof members;
      if (k in members) members[k]++;
    }
  } catch { /* sayaçlar 0 kalır */ }
  let fleetContractNodes = 0;
  try {
    const b = JSON.parse(backendsJson || "[]") as Array<{ name?: string }>;
    fleetContractNodes = b.filter((x) => String(x?.name || "").startsWith("contract:")).length;
  } catch { /* 0 */ }
  let shardHeadUp = false;
  try {
    shardHeadUp = Boolean((JSON.parse(headJson || "{}") as { up?: boolean }).up);
  } catch { /* false */ }
  return { members, fleetContractNodes, shardHeadUp };
}

// ── Canlı sarmalayıcı ────────────────────────────────────────────────────────

const EXPECTED_TABS = Number(process.env.ORCH_EXPECTED_TABS || 8);
const IDLE_HOURS = Number(process.env.ORCH_IDLE_HOURS || 3);
const BACKEND_PORT = Number(process.env.ORCH_BACKEND_PORT || 3000);

function ageHoursOf(wtPath: string): number {
  const ct = parseInt(git(wtPath, ["log", "-1", "--format=%ct"]), 10);
  if (!Number.isFinite(ct)) return Infinity;
  return (Date.now() / 1000 - ct) / 3600;
}

function readRoadmap(wtPath: string): RoadmapSignal {
  const f = findFile(wtPath, /roadmap.*\.md$/i) || findFile(wtPath, /^(FRONTEND_)?AGENTS\.md$/);
  if (!f) return { current: "", next: "" };
  try { return roadmapStruct(readFileSync(f, "utf8")); } catch { return { current: "", next: "" }; }
}

function readErrors(wtPath: string): ErrorSignal {
  const f = findFile(wtPath, /errors_registry\.json$/);
  if (!f) return { count: 0, lastId: null };
  try { return errorStruct(readFileSync(f, "utf8")); } catch { return { count: 0, lastId: null }; }
}

const ORCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // bin/lib → orchestration/

/** ADOPTIONS_ORCHESTRATION.md'yi oku → parse → gate → cockpit özeti. Yok/bozuk → null. */
function readAdoptions(): AdoptionSummary | null {
  const f = join(ORCH_DIR, "ADOPTIONS_ORCHESTRATION.md");
  try {
    const rows = parseAdoptionRows(readFileSync(f, "utf8"));
    if (!rows.length) return null;
    return summarizeAdoptions(rows, gate(rows, "ADOPTIONS_ORCHESTRATION.md"));
  } catch {
    return null;
  }
}

/** Backend runtime'ı best-effort oku (cwd-mapped :3000). Fetch hata/timeout → null. */
async function fetchBackend(): Promise<BackendRuntime | null> {
  const base = `http://127.0.0.1:${BACKEND_PORT}`;
  try {
    // Backend kapalıyken ilk SSE frame'i bloke etmesin: hızlı düş (800ms). Açıkken sağlık <100ms.
    const ctrl = AbortSignal.timeout(Number(process.env.ORCH_BACKEND_TIMEOUT_MS || 800));
    const [hRes, mRes] = await Promise.all([
      fetch(`${base}/api/health`, { signal: ctrl }),
      fetch(`${base}/metrics`, { signal: ctrl }).catch(() => null),
    ]);
    if (!hRes.ok) return null;
    const health = parseHealth(await hRes.text());
    if (!health) return null;
    let toolCalls = 0, webhookQueue = 0, migrationVersion = 0;
    if (mRes && mRes.ok) {
      const text = await mRes.text();
      toolCalls = sumPromMetric(text, "mcp_tool_calls_total");
      webhookQueue = promGauge(text, "ollamas_webhook_queue_depth") ?? 0;
      migrationVersion = promGauge(text, "ollamas_migration_version") ?? 0;
    }
    return { ...health, toolCalls, webhookQueue, migrationVersion };
  } catch {
    return null;
  }
}

/** Branch'ten kısa lane adı türet (gösterim için). feat/frontend-vf3 → frontend. */
function laneName(branch: string, path: string): string {
  if (path === ANCHOR) return "backend";
  const m = branch.match(/feat\/([a-z]+)/i);
  return m ? m[1] : branch.replace(/^feat\//, "");
}

/**
 * Canlı sekme→lane sayım haritası (osascript; izin yok → null). PAHALI (~5s, Automation hang).
 * Nadiren değişir → serve.ts bunu cache'ler (her poll'de ÇAĞIRMAZ), collect()'e enjekte eder.
 */
export function liveTabMap(): Map<string, number> | null {
  const wts = discoverWorktrees();
  const dwts: DWorktree[] = wts.map((w) => ({ path: w.path, branch: w.branch }));
  const tabRes = discoverTabs();
  if (!tabRes.available) return null;
  const m = new Map<string, number>();
  for (const t of tabRes.tabs) {
    const wt = tabWorktree(t.tty, dwts);
    if (wt) m.set(wt.path, (m.get(wt.path) || 0) + 1);
  }
  return m;
}

/**
 * Canlı READ-ONLY snapshot. Backend opsiyonel; eksik veri → "—"/null, asla throw.
 * opts.tabMap: undefined → canlı keşfet (PAHALI, status.ts/standalone); Map → enjekte (serve cache);
 * null → sekmeyi atla (tabs=-1, hızlı SSE).
 */
export async function collect(opts: { tabMap?: Map<string, number> | null } = {}): Promise<CockpitSnapshot> {
  const wts = discoverWorktrees();
  const dwts: DWorktree[] = wts.map((w) => ({ path: w.path, branch: w.branch }));

  // Dev-server keşfi (lsof→cwd→worktree; port-3000 collision çözümü discover.ts'te).
  const servers = mapServersToWorktrees(listenersLive(), dwts, pidCwdLive);
  const serverByPath = new Map<string, { port: number; up: boolean }>();
  for (const s of servers) if (!serverByPath.has(s.path)) serverByPath.set(s.path, { port: s.port, up: true });

  // Sekme haritası: enjekte (serve cache) yoksa canlı keşfet. null → atla (tabs=-1).
  const tabByPath = opts.tabMap !== undefined ? opts.tabMap : liveTabMap();
  const tabsAvailable = tabByPath !== null;

  const lanes: LaneStatus[] = wts.map((wt) => {
    const dirty = git(wt.path, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
    const ab = git(wt.path, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [behindStr, aheadStr] = ab.split("\t");
    const age = ageHoursOf(wt.path);
    return {
      lane: laneName(wt.branch, wt.path),
      branch: wt.branch,
      head: wt.head,
      ageHours: age,
      dirtyFiles: dirty,
      ahead: parseInt(aheadStr, 10) || 0,
      behind: parseInt(behindStr, 10) || 0,
      devServer: serverByPath.get(wt.path) ?? null,
      tabs: tabsAvailable ? (tabByPath!.get(wt.path) || 0) : -1,
      idle: age > IDLE_HOURS,
      roadmap: readRoadmap(wt.path),
      errors: readErrors(wt.path),
    };
  });

  const backend = await fetchBackend();
  const adoptions = readAdoptions();
  const contract = readContractSummary();
  return buildSnapshot({ ts: new Date().toISOString(), expectedLanes: EXPECTED_TABS, lanes, backend, adoptions, contract });
}

/** Canlı okuyucu (vK9): env-override'lı contract dosyaları → contractStruct. READ-ONLY. */
function readContractSummary(): ContractSummary | null {
  const home = process.env.HOME || "";
  const tryRead = (p: string): string | null => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  return contractStruct(
    tryRead(process.env.CONTRACT_STATE_PATH || join(home, ".ollamas", "contract.json")),
    tryRead(process.env.FLEET_BACKENDS_PATH || join(home, ".ollamas", "backends.json")),
    tryRead(join(process.env.CONTRACT_SHARD_DIR || join(home, ".ollamas", "shard"), "head.json")),
  );
}
