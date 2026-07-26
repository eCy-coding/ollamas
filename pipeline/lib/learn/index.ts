// learn/index — the single registry every learn tool reads.
//
// Tracks are separate files because the catalogue is authored prose, not configuration: keeping
// `js-ts` apart from `python` keeps each file reviewable. This module is the only place that
// knows the whole set, and it is also where uniqueness is enforced — a duplicated lesson id
// would silently overwrite a note on disk, so it throws at import time instead.
import { AGENTS } from "./track-agents";
import { DATA } from "./track-data";
import { HTTP_API } from "./track-http-api";
import { JS_TS } from "./track-js-ts";
import { JS_TS_2 } from "./track-js-ts-2";
import { MD_OBSIDIAN } from "./track-md-obsidian";
import { POLICIES } from "./policy";
import { PYTHON } from "./track-python";
import { PYTHON_2 } from "./track-python-2";
import { REST_2 } from "./track-rest-2";
import { SHELL } from "./track-shell";
import { WEB } from "./track-web";
import type { Construct } from "./types";

/**
 * Wave-2 additions live in `*-2.ts` files and are merged into the SAME track arrays.
 *
 * Splitting by wave rather than appending keeps each authored file reviewable (the js-ts
 * catalogue alone would otherwise pass 1 200 lines) while the reader still sees one flat track.
 * `REST_2` carries the tracks whose wave-2 additions were too few to deserve a file each; its
 * entries declare their own `track`, so the grouping below stays purely presentational.
 */
const byTrack = (all: Construct[], id: string) => all.filter((c) => c.track === id);

// Order matters only for display; the curriculum order lives in `CURRICULUM` (learnrefs.ts).
export const TRACK_MODULES: Record<string, Construct[]> = {
  "js-ts": [...JS_TS, ...JS_TS_2],
  web: [...WEB, ...byTrack(REST_2, "web")],
  python: [...PYTHON, ...PYTHON_2],
  shell: [...SHELL, ...byTrack(REST_2, "shell")],
  data: [...DATA, ...byTrack(REST_2, "data")],
  "md-obsidian": [...MD_OBSIDIAN, ...byTrack(REST_2, "md-obsidian")],
  "http-api": [...HTTP_API, ...byTrack(REST_2, "http-api")],
  agents: [...AGENTS, ...byTrack(REST_2, "agents")],
};

export const ALL_CONSTRUCTS: Construct[] = Object.values(TRACK_MODULES).flat();

const seen = new Set<string>();
for (const c of ALL_CONSTRUCTS) {
  if (seen.has(c.id)) throw new Error(`learn catalog: duplicate lesson id '${c.id}'`);
  seen.add(c.id);
  if (c.recipe.id !== c.id) throw new Error(`learn catalog: recipe id '${c.recipe.id}' != lesson id '${c.id}'`);
}

// Policies are authored in one reviewable file and merged onto their lesson here. A rule whose
// id has no lesson is a build error, not a silent no-op: an orphan rule would be enforced on the
// four systems while nothing explained it.
for (const [id, p] of Object.entries(POLICIES)) {
  const c = ALL_CONSTRUCTS.find((x) => x.id === id);
  if (!c) throw new Error(`learn policy: '${id}' için ders yok — kural açıklamasız dayatılamaz`);
  c.policy = { id, ...p };
}

export function constructById(id: string): Construct | undefined {
  return ALL_CONSTRUCTS.find((c) => c.id === id);
}
