// L11: odysseus Khoj federation (graceful). odysseus has no local store — its memory lives
// in an external Khoj instance (:42110). If Khoj is reachable we mirror recent entries into
// odysseus/ notes; if it is down (the common case here) we write a single placeholder hub so
// the vault honestly shows "external, offline" rather than pretending. Best-effort, short
// timeout — never blocks a sync.
import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { noteFilename } from "./brain-obsidian-note";

export function khojBase(): string {
  return process.env.KHOJ_URL || "http://127.0.0.1:42110";
}

export interface KhojEntry { id?: string; entry?: string; note?: string; additional?: any }

/** Best-effort Khoj fetch. Returns null when unreachable (down / no key). */
export async function fetchKhoj(base = khojBase(), ms = 2500): Promise<KhojEntry[] | null> {
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
