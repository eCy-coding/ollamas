// L11: odysseus Khoj federation (graceful). odysseus has no local store — its memory lives
// in an external Khoj instance (:42110). If Khoj is reachable we mirror recent entries into
// odysseus/ notes; if it is down (the common case here) we write a single placeholder hub so
// the vault honestly shows "external, offline" rather than pretending. Best-effort, short
// timeout — never blocks a sync.
import { writeFileSync, mkdirSync, readdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { noteFilename } from "./brain-obsidian-note";

export function khojBase(): string {
  return process.env.KHOJ_URL || "http://127.0.0.1:42110";
}

// L25: knowledge tiers odysseus retrieves from. episodic is skipped — it's git-commit/log noise
// that would dilute retrieval; the durable knowledge lives in the other tiers + entities.
const KHOJ_KNOWLEDGE_DIRS = ["core", "learned", "procedural", "working", "entities"];

export interface KhojFile { name: string; content: string }

/** Collect the vault's non-empty knowledge notes to feed odysseus's Khoj index. */
export function collectVaultKnowledge(vault: string, dirs = KHOJ_KNOWLEDGE_DIRS): KhojFile[] {
  const out: KhojFile[] = [];
  for (const d of dirs) {
    const dir = join(vault, d);
    let names: string[] = [];
    try { names = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const f of names) {
      const p = join(dir, f);
      try {
        if (statSync(p).size < 100) continue; // skip empty/placeholder notes
        out.push({ name: `${d}/${f}`, content: readFileSync(p, "utf8") });
      } catch { /* unreadable — skip */ }
    }
  }
  return out;
}

/** Default PATCH poster: incremental Khoj index (regenerate=false → never wipes the corpus).
 *  multipart form-data of markdown files. Returns true on 2xx. */
async function patchKhoj(base: string, files: KhojFile[], ms = 120_000): Promise<boolean> {
  const form = new FormData();
  for (const f of files) form.append("files", new Blob([f.content], { type: "text/markdown" }), f.name.replace(/\//g, "__"));
  try {
    const r = await fetch(`${base}/api/content?t=markdown&client=obsidian`, { method: "PATCH", body: form, signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch { return false; }
}

/** L25: push the vault's knowledge into odysseus's Khoj so it can actually retrieve the
 *  collective brain (not just show "online, 0 entry"). Batched incremental PATCH — Khoj hashes
 *  entries so re-pushing unchanged notes is a cheap no-op on its side. Best-effort: a down Khoj
 *  yields {ok:false}. Injectable poster for tests (no network). */
export async function pushVaultToKhoj(vault: string, opts: { base?: string; batch?: number; poster?: (files: KhojFile[]) => Promise<boolean> } = {}): Promise<{ ok: boolean; pushed: number; batches: number }> {
  const base = opts.base || khojBase();
  const batch = opts.batch || 60;
  const poster = opts.poster || ((files: KhojFile[]) => patchKhoj(base, files));
  const files = collectVaultKnowledge(vault);
  if (!files.length) return { ok: true, pushed: 0, batches: 0 };
  let pushed = 0, batches = 0, anyFail = false;
  for (let i = 0; i < files.length; i += batch) {
    const slice = files.slice(i, i + batch);
    const ok = await poster(slice);
    batches++;
    if (ok) pushed += slice.length; else anyFail = true;
  }
  return { ok: !anyFail, pushed, batches };
}

export interface KhojEntry { id?: string; entry?: string; note?: string; additional?: any }

/** Best-effort Khoj fetch. Returns null when unreachable (down / no key). Timeout is generous:
 * Khoj's markdown search cold-loads the embedding model and a `t=all` scan can take ~3s, so a
 * tight 2.5s budget spuriously read "offline" while the daemon was up. 8s tolerates that. */
export async function fetchKhoj(base = khojBase(), ms = 8000): Promise<KhojEntry[] | null> {
  try {
    const r = await fetch(`${base}/api/search?q=*&n=40&t=all`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : (Array.isArray(j?.results) ? j.results : []);
  } catch { return null; }
}

/** Mirror Khoj entries into odysseus/ notes, or write an honest offline placeholder. */
export async function writeOdysseusNotes(vault: string, opts: { fetcher?: () => Promise<KhojEntry[] | null> } = {}): Promise<{ online: boolean; notes: number }> {
  const dir = join(vault, "odysseus");
  mkdirSync(dir, { recursive: true });
  const entries = await (opts.fetcher ? opts.fetcher() : fetchKhoj());
  if (entries === null) {
    // offline — write placeholder, do NOT wipe any previously-mirrored notes.
    writeFileSync(join(dir, "_khoj.md"),
      `---\ncssclasses: [brain, system-odysseus]\ntags: [system/odysseus]\naliases: [odysseus Khoj]\n---\n\n`
      + `# 🟣 odysseus — Khoj (harici hafıza)\n\n> [!warning] Khoj (${khojBase()}) şu an **erişilemez** (offline). odysseus'un kendi memory'si burada; çevrimiçi olunca otomatik federe edilir.\n\n`
      + `odysseus ask-shared'da generation/research uzmanı + council-koltuğu olarak çalışır. [[Orchestra]]\n`);
    return { online: false, notes: 0 };
  }
  const live = new Set<string>(["_khoj.md"]);
  let n = 0;
  for (const [i, e] of entries.entries()) {
    const text = (e.entry || e.note || "").toString().trim();
    if (!text) continue;
    const id = String(e.id || i);
    const name = `khoj-${noteFilename(id).replace(/\.md$/, "")}.md`;
    live.add(name);
    const title = text.slice(0, 60).replace(/\n/g, " ");
    writeFileSync(join(dir, name),
      `---\ncssclasses: [brain, system-odysseus]\ntags: [system/odysseus, odysseus/khoj]\naliases: [${JSON.stringify(title)}]\n---\n\n`
      + `# ${title}\n\n> [!note] odysseus · Khoj\n\n${text.slice(0, 4000)}\n`);
    n++;
  }
  writeFileSync(join(dir, "_khoj.md"),
    `---\ncssclasses: [brain, system-odysseus]\ntags: [system/odysseus]\naliases: [odysseus Khoj]\n---\n\n`
    + `# 🟣 odysseus — Khoj (harici hafıza) ✅ online\n\n> [!success] ${n} entry federe edildi (${khojBase()}). [[Orchestra]]\n`);
  if (live.size > 0) for (const f of readdirSync(dir)) if (f.endsWith(".md") && !live.has(f)) rmSync(join(dir, f));
  return { online: true, notes: n };
}
