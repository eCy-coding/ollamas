// O0 demo module (02-o0-foundation.md §3 FAZ 5) — the first complete ModuleDef;
// every later O-module (O2/O3/O5/O6) copies this directory. schema.ts holds the
// wire types + input validation (honest 400 before any store write).
export interface DemoItem {
  id: string;
  text: string;
  created_at: string;
}

/** Validate a { text } body. Returns the trimmed text or throws with a message
 *  the router turns into a 400 (no silent coercion). */
export function parseItemInput(body: unknown): string {
  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("field 'text' must be a non-empty string");
  }
  return text.trim();
}

/** Validate a { q } search body. */
export function parseSearchInput(body: unknown): string {
  const q = (body as { q?: unknown })?.q;
  if (typeof q !== "string" || q.trim() === "") {
    throw new Error("field 'q' must be a non-empty string");
  }
  return q.trim();
}
