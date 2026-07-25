// vault-ground — server-side RAG grounding entry point (dc-4.5). The pure retrieval core lives in
// pipeline/lib/vaultground (unit-tested, 100% cov); this module is the server-facing wrapper.
//
// DELIBERATELY NOT registered as a :3000 route: the live server is fleet-managed and grounding is
// opt-in. To expose it, a route handler calls `groundAgainstVault(query, notes)` with notes read via
// the module's own store layer. Kept import-clean (no persistence/store import) so it never couples
// the running server.
import { groundQuery, type Note, type Grounding } from "../pipeline/lib/vaultground";

/** Ground a query against a provided set of vault notes. Thin, pure — caller supplies the corpus. */
export function groundAgainstVault(query: string, notes: Note[], topK = 3): Grounding {
  return groundQuery(query, notes, topK);
}

export type { Note, Grounding };
