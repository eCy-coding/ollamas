/**
 * orchestration/bin/lib/graph.ts — Cross-lane bağımlılık grafiği + API-gap (zero-dep, pure).
 *
 * Lane'ler implicit kontrat paylaşır: frontend `fetch('/api/x')` çağırır, backend
 * `app.get('/api/x')` tanımlar. Drift = frontend-call ∉ backend-route (MISSING) /
 * route never-called (UNUSED). Native regex (AST gereksiz); çıktı Mermaid (zero-dep).
 */

export interface Route { method: string; path: string; }
export interface Gap { missing: string[]; unused: string[]; matched: string[]; }
export interface Edge { from: string; to: string; matched: number; missing: number; }

/** Express route tanımları: app.get("/x", …) / router.post(`/y`). */
export function extractRoutes(src: string): Route[] {
  const out: Route[] = [];
  const re = /\b(?:app|router)\.(get|post|put|delete|patch|all)\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ method: m[1].toUpperCase(), path: m[2] });
  return out;
}

/** Frontend/CLI HTTP çağrıları: '/api/...' string-literal'leri (query atılır). */
export function extractCalls(src: string): string[] {
  const out = new Set<string>();
  const re = /['"`](\/api\/[^'"`?\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1].replace(/\/$/, "") || "/");
  return [...out];
}

/** Tool kayıtları: registry.register("name" | ToolRegistry.register('name'). */
export function extractRegistrations(src: string): string[] {
  const out = new Set<string>();
  const re = /(?:registry|ToolRegistry)\.register\(\s*['"`]?([\w.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

/** Path'i karşılaştırılabilir hale getir: query at, :param/${tpl}/sayı/uuid segment → *, trailing-slash at. */
export function normalizePath(p: string): string {
  let s = (p || "").split("?")[0].replace(/\/+$/, "") || "/";
  s = s
    .replace(/:[A-Za-z_][\w-]*/g, "*")          // :id
    .replace(/\$\{[^}]*\}/g, "*")               // ${tpl}
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) ? "*" : seg,
    )
    .join("/");
  return s;
}

/** call ↔ route gap analizi (normalize edilmiş karşılaştırma). */
export function gapAnalysis(routes: Route[], calls: string[]): Gap {
  const routeSet = new Set(routes.map((r) => normalizePath(r.path)));
  const callNorm = calls.map(normalizePath);
  const callSet = new Set(callNorm);
  const matchOne = (cn: string) =>
    routeSet.has(cn) || [...routeSet].some((r) => segMatch(r, cn));
  const missing = [...new Set(callNorm.filter((cn) => !matchOne(cn)))];
  const matched = [...new Set(callNorm.filter((cn) => matchOne(cn)))];
  const unused = routes
    .map((r) => normalizePath(r.path))
    .filter((rn) => rn.startsWith("/api/") && !callSet.has(rn) && ![...callSet].some((cn) => segMatch(rn, cn)));
  return { missing, unused: [...new Set(unused)], matched };
}

/** Segment-bazlı eşleşme: '*' her segmenti tutar (route param ↔ concrete call). */
function segMatch(a: string, b: string): boolean {
  const as = a.split("/"), bs = b.split("/");
  if (as.length !== bs.length) return false;
  return as.every((seg, i) => seg === "*" || bs[i] === "*" || seg === bs[i]);
}

/** Lane-kontrat kenarlarını Mermaid `graph LR` metnine çevir (zero-dep). */
export function toMermaid(edges: Edge[]): string {
  const lines = ["graph LR"];
  for (const e of edges) {
    const label = `${e.matched}✓${e.missing ? ` ${e.missing}✗` : ""}`;
    const a = e.from.replace(/[^\w]/g, "_");
    const b = e.to.replace(/[^\w]/g, "_");
    lines.push(`  ${a}["${e.from}"] -->|${label}| ${b}["${e.to}"]`);
  }
  return lines.join("\n");
}
