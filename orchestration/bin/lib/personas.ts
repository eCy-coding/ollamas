/**
 * personas.ts — vO4 panel "assemble" fazı: 8 uzman persona registry'si (PANEL_SCHEMA.md §4).
 *
 * SAF veri + helper. Her persona'nın sahip-olduğu scan target'ları deterministik detector'lara
 * (detectors.ts) eşler. scan.ts bu direktifleri canlı yürütür (FS/grep), persona zaten makine-tespiti
 * üretmiyorsa (örn. prose-kalite) target boş kalır → insan `<persona>.md` notlarını yazar.
 */

export type ScanKind =
  | "pkg-meta" | "empty-file" | "orphan-dir" | "unref-artifact" | "wired-no-consumer"
  // vO4.1 içerik-tarayan kind'ler (collectMatchingFiles ister):
  | "fe-chokepoint" | "fe-oversized" | "fs-any-density"
  | "secret-scan" | "insecure-http"
  | "sh-strict" | "lan-bind" | "rm-unquoted"
  | "mcp-output-schema" | "mcp-exec-bypass";

export interface ScanTarget {
  kind: ScanKind;
  /** ANCHOR'a göreli yol (dosya veya dizin). */
  path: string;
  /** orphan-dir/unref-artifact: kaynak ağacında aranacak token (grep). Yoksa basename. */
  refToken?: string;
  /** wired-no-consumer: bağımlılık adı + üretici/tüketici glob işaretçileri. */
  dep?: string;
  producerToken?: string;
  consumerToken?: string;
  /** fe-oversized/fs-any-density: satır/oran eşiği. */
  threshold?: number;
  /** fe-chokepoint: choke-point dosya işaretçisi (apiClient). */
  chokepointToken?: string;
  /** içerik-tarayan kind'ler: path dizin ise hangi dosya uzantıları (*.sh, *.tsx). */
  globs?: string[];
}

export interface Persona {
  name: string;
  targetLane: string;
  /** İnsan-okur açıklama (rapor + master prompt için). */
  scope: string;
  targets: ScanTarget[];
}

export const PERSONAS: Persona[] = [
  {
    name: "project-architect", targetLane: "repo",
    scope: "repo kökü, package.json, project_cortex.md, backend/ orphan dizinleri",
    targets: [
      { kind: "pkg-meta", path: "package.json" },
      { kind: "empty-file", path: "project_cortex.md" },
      // refToken = distinktif yol (yalın ad DEĞİL): "orchestrator" server/orchestrator.ts ile
      // çakışıp false-negative verir (ERR-ORCH-006). backend/<ad> yalnız gerçek backend importunu sayar.
      { kind: "orphan-dir", path: "backend/contracts", refToken: "backend/contracts" },
      { kind: "orphan-dir", path: "backend/daemon", refToken: "backend/daemon" },
      { kind: "orphan-dir", path: "backend/mesh", refToken: "backend/mesh" },
      { kind: "orphan-dir", path: "backend/orchestrator", refToken: "backend/orchestrator" },
      { kind: "orphan-dir", path: "backend/sandbox", refToken: "backend/sandbox" },
    ],
  },
  {
    name: "prompt-engineer", targetLane: "repo",
    scope: "AGENTS.md, SEYIR_DEFTERI.md, server.ts system-prompt string'leri",
    targets: [
      { kind: "unref-artifact", path: "logSeyir.jsonl", refToken: "logSeyir" },
    ],
  },
  {
    name: "fullstack", targetLane: "backend",
    scope: "server.ts, src↔server kontrat seam'i (orphan-API → vO5-depgraph)",
    targets: [
      { kind: "fs-any-density", path: "server.ts" },
    ],
  },
  {
    name: "backend", targetLane: "backend",
    scope: "server/, backend/{contracts,daemon,mesh,orchestrator,sandbox}, observability",
    targets: [
      { kind: "wired-no-consumer", path: "server/metrics.ts", dep: "prom-client", producerToken: "prom-client", consumerToken: "grafana" },
    ],
  },
  {
    name: "frontend", targetLane: "frontend",
    scope: "src/{App.tsx,components,hooks}",
    targets: [
      { kind: "fe-chokepoint", path: "src", chokepointToken: "apiClient", globs: ["*.tsx", "*.ts", "*.jsx"] },
      { kind: "fe-oversized", path: "src/components", threshold: 400, globs: ["*.tsx", "*.jsx"] },
    ],
  },
  {
    name: "macos", targetLane: "scripts",
    scope: "*.sh, launchd/Terminal köprüsü, deploy/",
    targets: [
      { kind: "sh-strict", path: ".", globs: ["*.sh"] },
      { kind: "lan-bind", path: ".", globs: ["*.sh", "*.plist"] },
      { kind: "rm-unquoted", path: ".", globs: ["*.sh"] },
    ],
  },
  {
    name: "integrations", targetLane: "integrations",
    scope: ".env.example, webhook/OAuth endpoint'leri, server.json (v2.1 cross-check)",
    targets: [
      { kind: "secret-scan", path: "server", globs: ["*.ts", "*.json"] },
      { kind: "secret-scan", path: "src", globs: ["*.ts", "*.tsx"] },
      { kind: "insecure-http", path: "src", globs: ["*.ts", "*.tsx"] },
    ],
  },
  {
    name: "mcp", targetLane: "integrations",
    scope: "tool-registry, ToolRegistry.execute choke-point, modelcontextprotocol kullanımı",
    targets: [
      { kind: "mcp-output-schema", path: "server/tool-registry.ts" },
      { kind: "mcp-exec-bypass", path: "server", globs: ["*.ts"] },
    ],
  },
];

/** Persona adıyla registry kaydını bul (case-insensitive). */
export function getPersona(name: string): Persona | undefined {
  const k = name.trim().toLowerCase();
  return PERSONAS.find((p) => p.name === k);
}

export const PERSONA_NAMES = PERSONAS.map((p) => p.name);
