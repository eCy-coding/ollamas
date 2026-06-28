/**
 * orchestration/bin/lib/dispatchdoctor.ts — vO21 Fleet dispatch readiness CORE (pure, zero-IO).
 *
 * Classifies each fleet worker (gateway | inference-only | down) from injected probe bodies, then emits a
 * per-Hybrid-mode GO/NO-GO + exact remediation — the precondition gate cli/scripts run before dispatch.
 * doctor.ts:88 verdict pattern; reuses metrics.ts:29 parseHealth (the ollamas /api/health marker that plain
 * ollama lacks, server.ts:262). NO IO here — bin/dispatchdoctor.ts does the probing.
 *
 * Honest: reports desktop-ert7724 as inference-only until an ollamas gateway runs on it (today only ollama).
 */
import { parseHealth } from "./metrics";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Raw probe results for one worker (injected → pure/testable). */
export interface WorkerProbe {
  name: string;
  url: string;
  control: boolean;            // true = the mac control-plane worker (host-tool home)
  healthBody: string | null;   // GET <url>/api/health body (ollamas gateway), null if non-200/unreachable
  tagsBody: string | null;     // GET <url>/api/tags body (ollama-native), null if non-200/unreachable
}

export type Capability = "gateway" | "inference-only" | "down";
export interface WorkerStatus {
  name: string; url: string; control: boolean;
  capability: Capability;
  mode: string | null;         // ollamas health mode (live/demo/degraded) when gateway
  models: string[];            // model names available (health loaded ∪ ollama tags)
  detail: string;
}

export interface ModeVerdict { go: boolean; summary: string; remediation: string[]; }
export interface FleetReadiness { inferenceOffload: ModeVerdict; fullRemoteDispatch: ModeVerdict; }

// ── Pure parsers ────────────────────────────────────────────────────────────────

/** ollama-native `/api/tags` body → model names (`{models:[{name}]}`). Tolerant, never throws. */
export function parseOllamaTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    const arr = j && Array.isArray(j.models) ? j.models : [];
    return arr.map((m: unknown) => (m && typeof m === "object" ? String((m as { name?: unknown }).name ?? "") : "")).filter(Boolean);
  } catch { return []; }
}

/** Does the worker have the required model? Exact or family-prefix (e.g. "qwen3:8b" ⊂ "qwen3:8b-16k"). */
function hasModel(s: WorkerStatus, required: string): boolean {
  return s.models.some((m) => m === required || m.startsWith(required));
}

// ── Classification ───────────────────────────────────────────────────────────────

/**
 * Classify a worker. ollamas **gateway** iff `/api/health` parses (metrics.parseHealth non-null) — plain
 * ollama lacks `/api/health` (server.ts:262). Else ollama-native (`/api/tags` responded) = inference-only.
 * Else down. Models = union of health-loaded names and ollama tags (most complete picture).
 */
export function classifyWorker(probe: WorkerProbe): WorkerStatus {
  const base = { name: probe.name, url: probe.url, control: probe.control };
  const tags = parseOllamaTags(probe.tagsBody);
  const health = probe.healthBody ? parseHealth(probe.healthBody) : null;

  if (health) {
    const models = [...new Set([...health.loaded.map((l) => l.name).filter((n) => n && n !== "?"), ...tags])];
    return { ...base, capability: "gateway", mode: health.mode, models,
      detail: `ollamas gateway · mode ${health.mode} · ${models.length} model` };
  }
  if (probe.tagsBody !== null) {
    return { ...base, capability: "inference-only", mode: null, models: tags,
      detail: `ollama-native (gateway YOK) · ${tags.length} model` };
  }
  return { ...base, capability: "down", mode: null, models: [],
    detail: "erişilemez (ne /api/health ne /api/tags)" };
}

// ── Readiness (doctor.ts verdict pattern) ─────────────────────────────────────────

/**
 * Per-Hybrid-mode GO/NO-GO. Deterministic.
 * - inference-offload: GO iff ≥1 reachable worker (gateway|inference-only) has the model → lends GPU tokens.
 * - full-remote-dispatch: GO iff ≥1 NON-control (remote) worker is a `gateway` with the model (ollamas server ON it).
 */
export function fleetReadiness(statuses: WorkerStatus[], requiredModel: string): FleetReadiness {
  const reachable = statuses.filter((s) => s.capability !== "down");
  const remotes = statuses.filter((s) => !s.control);

  const offload = reachable.filter((s) => hasModel(s, requiredModel));
  const inferenceOffload: ModeVerdict = offload.length
    ? { go: true, summary: `GO — ${offload.length} worker '${requiredModel}' ile erişilebilir (${offload.map((s) => s.name).join(", ")})`, remediation: [] }
    : { go: false, summary: `NO-GO — '${requiredModel}' olan erişilebilir worker yok`, remediation: remediationOffload(statuses, requiredModel) };

  const remoteGw = remotes.filter((s) => s.capability === "gateway" && hasModel(s, requiredModel));
  const fullRemoteDispatch: ModeVerdict = remoteGw.length
    ? { go: true, summary: `GO — ${remoteGw.length} remote gateway (${remoteGw.map((s) => s.name).join(", ")})`, remediation: [] }
    : { go: false, summary: `NO-GO — '${requiredModel}' ile remote ollamas gateway yok`, remediation: remediationFullRemote(remotes, requiredModel) };

  return { inferenceOffload, fullRemoteDispatch };
}

function remediationOffload(statuses: WorkerStatus[], required: string): string[] {
  const r: string[] = [];
  const remotes = statuses.filter((s) => !s.control);
  if (!remotes.length) r.push("`ollamas remote discover` ile Tailscale worker keşfet (havuz boş)");
  for (const s of remotes) {
    if (s.capability === "down") r.push(`${s.name} (${s.url}) çevrimdışı → makineyi aç + ollama servisini başlat`);
    else if (!s.models.some((m) => m === required || m.startsWith(required))) r.push(`${s.name}: \`ollama pull ${required}\` (model yok)`);
  }
  if (!r.length) r.push(`hiçbir worker '${required}' sunmuyor → en az birine \`ollama pull ${required}\``);
  return r;
}

function remediationFullRemote(remotes: WorkerStatus[], required: string): string[] {
  const r: string[] = [];
  if (!remotes.length) { r.push("remote worker yok → `ollamas remote discover`"); return r; }
  for (const s of remotes) {
    if (s.capability === "inference-only") r.push(`${s.name}: ollamas gateway server'ı çalıştır (scripts s.1) — şu an yalnız ollama-native; FULL remote dispatch için \`/api/agent/chat\` gerekir`);
    else if (s.capability === "down") r.push(`${s.name} çevrimdışı → aç + ollamas gateway başlat`);
    else if (!s.models.some((m) => m === required || m.startsWith(required))) r.push(`${s.name} gateway ama '${required}' yok → \`ollama pull ${required}\``);
  }
  return r;
}

// ── Renderer (doctor.ts style markdown) ───────────────────────────────────────────

/** Render DISPATCH_DOCTOR.md — worker table + per-mode GO/NO-GO + remediation. Deterministic. */
export function renderDispatchDoctor(statuses: WorkerStatus[], readiness: FleetReadiness, requiredModel: string, ts: string): string {
  const icon = (c: Capability) => (c === "gateway" ? "🟢" : c === "inference-only" ? "🟡" : "🔴");
  const mode = (v: ModeVerdict) => (v.go ? "✅ GO" : "⛔ NO-GO");
  const L: string[] = [];
  L.push(`# DISPATCH_DOCTOR — fleet dispatch readiness (vO21)`);
  L.push(`<!-- AUTO dispatchdoctor.ts · ${ts} · gerekli model ${requiredModel} · regenerate: tsx orchestration/bin/dispatchdoctor.ts -->`);
  L.push(``);
  L.push(`> Read-only fleet probe. Her worker'ın Hybrid-dispatch yeteneğini sınıflar + mod-başı GO/NO-GO + remediation.`);
  L.push(``);
  L.push(`## Worker'lar (gerekli model: \`${requiredModel}\`)`);
  L.push(`| | Worker | URL | Yetenek | Mode | Model'ler |`);
  L.push(`|---|--------|-----|---------|------|-----------|`);
  for (const s of statuses) {
    L.push(`| ${icon(s.capability)} | ${s.name}${s.control ? " (control)" : ""} | ${s.url} | ${s.capability} | ${s.mode ?? "—"} | ${s.models.join(", ") || "—"} |`);
  }
  L.push(``);
  L.push(`## Hybrid mod hazırlığı`);
  L.push(`### ${mode(readiness.inferenceOffload)} · inference-offload (gateway Mac'te, inference remote GPU'da)`);
  L.push(`${readiness.inferenceOffload.summary}`);
  for (const rem of readiness.inferenceOffload.remediation) L.push(`- ${rem}`);
  L.push(``);
  L.push(`### ${mode(readiness.fullRemoteDispatch)} · full-remote-dispatch (ReAct loop desktop-ert7724 ÜZERİNDE)`);
  L.push(`${readiness.fullRemoteDispatch.summary}`);
  for (const rem of readiness.fullRemoteDispatch.remediation) L.push(`- ${rem}`);
  return L.join("\n");
}
