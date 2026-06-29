// Pure Mac-model ranking for the cockpit. Surfaces ALL local ollama models with their
// fit on the Mac's unified memory + which one is the benchmarked-efficient champion.
export interface ModelInfo { name: string; sizeGb: number; fitsRam: boolean; loaded: boolean; recommended: boolean; }
export interface ModelsView { list: ModelInfo[]; recommended: string | null; totalRamGb: number; }

const isCloudOrEmbed = (name: string, size: number): boolean =>
  size <= 0 || /:cloud$|cloud$/.test(name) || /embed/i.test(name);

// tags: ollama /api/tags models (name + size bytes). totalRamBytes from os.totalmem().
// loadedNames: from ollama /api/ps. champion: the benchmarked Mac-efficient model name.
export function rankMacModels(
  tags: { name: string; size: number }[] | null | undefined,
  totalRamBytes: number,
  loadedNames: string[] | null | undefined,
  champion: string,
): ModelsView {
  const totalRamGb = Math.round((totalRamBytes / 1e9) * 10) / 10;
  const loaded = new Set((loadedNames ?? []).map((n) => n));
  const fitLimit = totalRamBytes * 0.7; // Mac unified memory, leave OS headroom
  const local = (Array.isArray(tags) ? tags : []).filter((m) => m && typeof m.name === "string" && !isCloudOrEmbed(m.name, m.size));
  const championExists = local.some((m) => m.name === champion);
  const list: ModelInfo[] = local.map((m) => ({
    name: m.name,
    sizeGb: Math.round((m.size / 1e9) * 10) / 10,
    fitsRam: m.size <= fitLimit,
    loaded: loaded.has(m.name),
    recommended: championExists ? m.name === champion : false,
  }));
  // recommended fallback: if champion absent, smallest model that fits and is >=2GB (avoid trivially-tiny)
  let recommended: string | null = championExists ? champion : null;
  if (!recommended) {
    const candidates = list.filter((x) => x.fitsRam && x.sizeGb >= 2).sort((a, b) => a.sizeGb - b.sizeGb);
    if (candidates[0]) { recommended = candidates[0].name; const r = list.find((x) => x.name === recommended); if (r) r.recommended = true; }
  }
  // sort: recommended first, then loaded, then size asc
  list.sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(b.loaded) - Number(a.loaded) || a.sizeGb - b.sizeGb);
  return { list, recommended, totalRamGb };
}
