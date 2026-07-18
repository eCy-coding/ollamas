// Brain SYSTEM bridge (K1/K3 — "omniscient" tur): the brain's knowledge finally
// covers the MACHINE it lives on. Read-only allowlist probes → deterministic
// S-P-O facts (bi-temporal: yesterday's disk number supersedes cleanly) + one
// learned summary; plus an instant "live context" arm for "şu an" questions.
// No LLM, $0, zero-dep. Secrets never probed; output passes the redaction gate
// on write like every other path.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrainFactInput } from "./brain";

const run = promisify(execFile);

export interface SystemSnapshot {
  osVersion: string;
  cpu: string;
  ramGb: number;
  diskFree: string;
  diskUsedPct: string;
  hostname: string;
  ollamasServices: string[];
  ollamaModels: string[];
  desktopProjects: string[];
  at: number;
}

const probe = async (cmd: string, args: string[], ms = 4000): Promise<string> => {
  try {
    const { stdout } = await run(cmd, args, { timeout: ms });
    return stdout.trim();
  } catch {
    return "";
  }
};

/** Read-only inventory of the machine + the ollamas runtime. Every probe is
 *  best-effort — a missing tool yields an empty field, never a throw. */
export async function collectSystem(): Promise<SystemSnapshot> {
  const [osV, cpu, ram, df, host, launchd] = await Promise.all([
    probe("sw_vers", ["-productVersion"]),
    probe("sysctl", ["-n", "machdep.cpu.brand_string"]),
    probe("sysctl", ["-n", "hw.memsize"]),
    probe("df", ["-h", "/"]),
    probe("hostname", ["-s"]),
    probe("launchctl", ["list"]),
  ]);
  const dfLine = df.split("\n").find((l) => l.endsWith("/")) || "";
  const dfCols = dfLine.split(/\s+/);
  let models: string[] = [];
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    models = ((await r.json()).models || []).map((m: { name: string }) => m.name);
  } catch { /* ollama down → empty */ }
  let projects: string[] = [];
  try {
    projects = readdirSync(join(homedir(), "Desktop"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .slice(0, 40);
  } catch { /* sandboxed → empty */ }
  return {
    osVersion: osV,
    cpu,
    ramGb: ram ? Math.round(Number(ram) / 1024 ** 3) : 0,
    diskFree: dfCols[3] || "",
    diskUsedPct: dfCols[4] || "",
    hostname: host,
    ollamasServices: launchd
      .split("\n")
      .filter((l) => /com\.ollamas|karargah|ecy/.test(l))
      .map((l) => l.split(/\s+/).pop() || "")
      .filter(Boolean)
      .slice(0, 20),
    ollamaModels: models.slice(0, 20),
    desktopProjects: projects,
    at: Date.now(),
  };
}

/** Pure: snapshot → bi-temporal facts. Stable predicates so each sync SUPERSEDES
 *  the previous value ("dün disk 40GB'tı" stays queryable point-in-time). */
export function snapshotToFacts(s: SystemSnapshot): BrainFactInput[] {
  const f: BrainFactInput[] = [];
  const put = (subject: string, predicate: string, object: string) => {
    if (object && object.length <= 200) f.push({ subject, predicate, object });
  };
  put("macbook", "os_version", `macOS ${s.osVersion}`);
  put("macbook", "cpu", s.cpu);
  put("macbook", "ram", s.ramGb ? `${s.ramGb} GB` : "");
  put("macbook", "disk_free", s.diskFree);
  put("macbook", "disk_used_pct", s.diskUsedPct);
  put("macbook", "hostname", s.hostname);
  put("macbook", "desktop_projects", s.desktopProjects.slice(0, 25).join(", "));
  put("ollamas-runtime", "launchd_services", s.ollamasServices.join(", "));
  put("ollamas-runtime", "ollama_models", s.ollamaModels.join(", "));
  return f;
}

/** Pure: one learned-tier summary a human (or the ask synthesizer) can lift whole. */
export function snapshotSummary(s: SystemSnapshot): string {
  return (
    `MacBook envanteri: macOS ${s.osVersion}, ${s.cpu}, ${s.ramGb} GB RAM, ` +
    `disk boş ${s.diskFree} (kullanım ${s.diskUsedPct}), hostname ${s.hostname}. ` +
    `ollamas launchd servisleri: ${s.ollamasServices.join(", ") || "yok"}. ` +
    `Kurulu ollama modelleri: ${s.ollamaModels.join(", ") || "yok"}. ` +
    `Desktop projeleri: ${s.desktopProjects.join(", ")}`
  );
}

/** Full sync: facts (superseding) + one learned summary row (stable id → upsert). */
export async function syncSystemToBrain(deps: {
  assertFact: (f: BrainFactInput) => Promise<{ changed: boolean; invalidated: number }>;
  remember: (m: { id: string; tier: "learned"; content: string; source: string; actor?: string }) => Promise<unknown>;
  collect?: () => Promise<SystemSnapshot>;
}): Promise<{ facts: number; changed: number }> {
  const s = await (deps.collect ?? collectSystem)();
  const facts = snapshotToFacts(s);
  let changed = 0;
  for (const f of facts) {
    const r = await deps.assertFact(f);
    if (r.changed) changed++;
  }
  await deps.remember({ id: "system-inventory", tier: "learned", content: snapshotSummary(s), source: "system-sync", actor: "macbook", confidence: 0.9 } as any);
  return { facts: facts.length, changed };
}

const LIVE_RE =
  /\b(disk|ram|bellek|cpu|işlemci|servis|service|model|çalışıyor|running|kaç\s*gb|şu\s*an|uptime|macbook|sistem|hostname|proje(ler)?im)\b/iu;

/** Pure: does this question want LIVE machine state (not stored memories)? */
export function wantsLiveSystem(q: string): boolean {
  return LIVE_RE.test(q || "");
}

/** K3: instant probe for the ask pipeline — fresh snapshot, formatted as a source. */
export async function liveSystemContext(q: string): Promise<string | null> {
  if (!wantsLiveSystem(q)) return null;
  try {
    return snapshotSummary(await collectSystem());
  } catch {
    return null;
  }
}
