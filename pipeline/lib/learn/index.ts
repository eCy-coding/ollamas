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
import { MD_OBSIDIAN } from "./track-md-obsidian";
import { PYTHON } from "./track-python";
import { SHELL } from "./track-shell";
import { WEB } from "./track-web";
import type { Construct } from "./types";

// Order matters only for display; the curriculum order lives in `CURRICULUM` (learnrefs.ts).
export const TRACK_MODULES: Record<string, Construct[]> = {
  "js-ts": JS_TS,
  web: WEB,
  python: PYTHON,
  shell: SHELL,
  data: DATA,
  "md-obsidian": MD_OBSIDIAN,
  "http-api": HTTP_API,
  agents: AGENTS,
};

export const ALL_CONSTRUCTS: Construct[] = Object.values(TRACK_MODULES).flat();

const seen = new Set<string>();
for (const c of ALL_CONSTRUCTS) {
  if (seen.has(c.id)) throw new Error(`learn catalog: duplicate lesson id '${c.id}'`);
  seen.add(c.id);
  if (c.recipe.id !== c.id) throw new Error(`learn catalog: recipe id '${c.recipe.id}' != lesson id '${c.id}'`);
}

export function constructById(id: string): Construct | undefined {
  return ALL_CONSTRUCTS.find((c) => c.id === id);
}
