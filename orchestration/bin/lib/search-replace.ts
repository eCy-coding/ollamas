// search-replace (pure) — parse + apply SEARCH/REPLACE edit blocks. IO-free → unit-tested.
//
// Why: fleet workers produce mostly-illustrative unified diffs (no real line numbers), so `git apply` fails
// on 14/15 proposals and the produce→apply loop can't close. SEARCH/REPLACE is the reliable LLM-edit format
// (aider / Claude's str_replace): the model copies an EXACT snippet from the file it read, then supplies the
// replacement — no line-number arithmetic. Applying is deterministic: the SEARCH must appear exactly once in
// the file, then it's swapped for REPLACE. Unique-match required, so a fuzzy/ambiguous edit fails rather than
// corrupting the file. The conductor still gates + reverts on red.

export interface Edit { file?: string; search: string; replace: string }

const FENCE = /<{5,7}\s*SEARCH\s*\n([\s\S]*?)\n?={5,7}\s*\n([\s\S]*?)\n?>{5,7}\s*REPLACE/g;

/** Parse SEARCH/REPLACE blocks. An optional `### file: <path>` (or `## file: <path>`) line just before a
 *  block assigns that block's target file. */
export function parseSearchReplace(text: string): Edit[] {
  if (!text) return [];
  const edits: Edit[] = [];
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text))) {
    // look back for the nearest `file:` header before this block
    const before = text.slice(0, m.index);
    const fm = before.match(/(?:^|\n)#{2,4}\s*file:\s*(\S+)\s*(?:\n[^\n]*)?$/i);
    edits.push({ file: fm ? fm[1] : undefined, search: m[1], replace: m[2] });
  }
  return edits;
}

export interface ApplyResult { ok: boolean; content: string; reason: string }

/** Apply one edit to `content`. Empty SEARCH = create/replace-whole (new file → content becomes REPLACE).
 *  Otherwise SEARCH must occur EXACTLY ONCE (unique) — else fail without mutating. */
export function applyEdit(content: string, edit: Edit): ApplyResult {
  if (edit.search === "" || edit.search == null) {
    // new-file / whole-content edit: only when the file is empty/absent, else it's ambiguous
    if (content.trim() === "") return { ok: true, content: edit.replace, reason: "new file" };
    return { ok: false, content, reason: "empty SEARCH but target is non-empty (ambiguous whole-file replace)" };
  }
  const idx = content.indexOf(edit.search);
  if (idx < 0) return { ok: false, content, reason: "SEARCH snippet not found in target (stale / not an exact copy)" };
  if (content.indexOf(edit.search, idx + 1) >= 0) return { ok: false, content, reason: "SEARCH snippet is ambiguous (appears more than once)" };
  return { ok: true, content: content.slice(0, idx) + edit.replace + content.slice(idx + edit.search.length), reason: "applied" };
}

export interface ApplyEditsResult { ok: boolean; content: string; applied: number; failures: { edit: Edit; reason: string }[] }

/** Apply all edits sequentially. All must succeed (0-hata) — a single failure aborts with no partial write. */
export function applyEdits(content: string, edits: Edit[]): ApplyEditsResult {
  let cur = content, applied = 0;
  const failures: { edit: Edit; reason: string }[] = [];
  for (const e of edits) {
    const r = applyEdit(cur, e);
    if (!r.ok) { failures.push({ edit: e, reason: r.reason }); return { ok: false, content, applied, failures }; }
    cur = r.content; applied++;
  }
  return { ok: failures.length === 0 && edits.length > 0, content: cur, applied, failures };
}

/** Does a proposal body contain any SEARCH/REPLACE block? */
export function hasSearchReplace(text: string): boolean {
  FENCE.lastIndex = 0;
  return FENCE.test(text || "");
}
