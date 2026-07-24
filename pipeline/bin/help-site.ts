#!/usr/bin/env -S npx tsx
// help-site — build the four help sites and render them into ONE coded static website.
//
// WHY THIS EXISTS
// help-build.ts produces the Obsidian markdown (the vault target). This is the OTHER target the
// operator asked for, built in parallel: a real coded website — landing card-grid → per-system
// docs (sidebar, TOC, client search, theme, copy-button code, prev/next, llms.txt) — written to
// the committed `ollamas/web/help/`. With `--vault` it ALSO writes the markdown site + a
// navigation canvas into `~/ollamas-vault/_help/`, so a single run feeds both targets at once.
//
// The pure renderer lives in lib/htmlsite.ts; this file is the thin IO shell: build → validate
// (gate) → render → write → optionally serve in a visible tab.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { buildSite, writeSite } from "./help-build";
import { validateHelpSite, isComplete, renderReport, type HelpSite } from "../lib/helpsite";
import { renderPortal } from "../lib/htmlsite";
import { SEED_GAPS, renderGapsMd, mergeGaps, type Gap } from "../lib/gaps";
import { renderReferencesMd } from "../lib/references";

/**
 * Gaps to render: the seed set, overlaid with any plans the parallel planners have written to
 * `pipeline/help-gaps.json` (a `Gap[]` with plannedBy/plan filled). Absent file → just the seeds.
 */
function currentGaps(): Gap[] {
  const f = join(REPO, "pipeline", "help-gaps.json");
  if (!existsSync(f)) return SEED_GAPS;
  try {
    return mergeGaps(SEED_GAPS, JSON.parse(readFileSync(f, "utf8")) as Gap[]);
  } catch {
    return SEED_GAPS; // malformed → fall back, never fabricate
  }
}

const HOME = homedir();
const REPO = process.env.OLLAMAS_REPO ?? join(HOME, "Desktop", "ollamas");
const VAULT = process.env.OBSIDIAN_VAULT ?? join(HOME, "ollamas-vault");
const SYSTEMS = ["claude", "ecym", "ollamas", "obsidian"];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".json": "application/json",
};

/** Build + validate the requested systems; throw on the first incomplete site (the gate). */
function buildSites(systems: string[]): HelpSite[] {
  const sites: HelpSite[] = [];
  for (const s of systems) {
    const site = buildSite(s);
    const issues = validateHelpSite(site);
    console.log(renderReport(site, issues)[0]);
    if (!isComplete(issues)) {
      for (const l of renderReport(site, issues).slice(1)) console.log(l);
      throw new Error(`'${s}' help sitesi eksik — kapı geçilemez (MISS≠PASS)`);
    }
    sites.push(site);
  }
  return sites;
}

/** Write the portal SiteFiles under a root, creating dirs. Returns the file count. */
function writePortal(sites: HelpSite[], outRoot: string): number {
  const files = renderPortal(sites, { gaps: currentGaps() });
  for (const f of files) {
    const abs = join(outRoot, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, "utf8");
  }
  return files.length;
}

/** A minimal Obsidian canvas linking the four hubs to a central node (vault navigation map). */
function siteCanvas(sites: HelpSite[]): string {
  const nodes: unknown[] = [{ id: "hub", type: "text", text: "# Yardım Merkezi\nollamas · eCym · Claude · Obsidian", x: -140, y: -60, width: 280, height: 120 }];
  const edges: unknown[] = [];
  sites.forEach((s, i) => {
    const id = `sys-${s.system}`;
    const angle = (i / sites.length) * Math.PI * 2;
    nodes.push({
      id, type: "file", file: `_help/${s.system}/${s.system}-help.md`,
      x: Math.round(Math.cos(angle) * 420) - 130, y: Math.round(Math.sin(angle) * 300) - 50, width: 260, height: 100,
    });
    edges.push({ id: `e-${i}`, fromNode: "hub", toNode: id });
  });
  return JSON.stringify({ nodes, edges }, null, 2);
}

/** Write the markdown site + navigation canvas into the vault (the parallel Obsidian target). */
function writeVault(sites: HelpSite[]): number {
  let n = 0;
  for (const site of sites) n += writeSite(site);
  const helpDir = join(VAULT, "_help");
  mkdirSync(helpDir, { recursive: true });
  writeFileSync(join(helpDir, "REFERENCES.md"), renderReferencesMd(), "utf8");
  writeFileSync(join(helpDir, "GAPS.md"), renderGapsMd(currentGaps()), "utf8");
  writeFileSync(join(helpDir, "site.canvas"), siteCanvas(sites), "utf8");
  return n + 3;
}

/** Static file server over a directory (visible-tab friendly). Returns the server. */
function serve(root: string, port: number) {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const abs = normalize(join(root, p));
    if (!abs.startsWith(root) || !existsSync(abs)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(abs)] ?? "application/octet-stream" });
    res.end(readFileSync(abs));
  });
  srv.listen(port, () => console.log(`serve: http://127.0.0.1:${port}/  (Ctrl-C ile durdur)`));
  return srv;
}

/** Count emitted files vs the structural minimum (pages + section anchors + chrome). */
function verify(sites: HelpSite[]): { ok: boolean; lines: string[] } {
  const tmp = join(REPO, "pipeline", ".help-site-verify");
  rmSync(tmp, { recursive: true, force: true });
  const count = writePortal(sites, tmp);
  const lines: string[] = [];
  let ok = true;
  const need = (cond: boolean, msg: string) => { lines.push(`${cond ? "ok" : "HATA"}  ${msg}`); ok = ok && cond; };
  need(existsSync(join(tmp, "index.html")), "açılış index.html");
  need(existsSync(join(tmp, "assets", "styles.css")) && existsSync(join(tmp, "assets", "app.js")), "assets (css+js)");
  need(existsSync(join(tmp, "assets", "search-index.js")), "arama indeksi");
  need(existsSync(join(tmp, "llms.txt")), "llms.txt makine indeksi");
  need(existsSync(join(tmp, "REFERENCES.md")), "REFERENCES.md kalıcı liste");
  for (const s of sites) need(existsSync(join(tmp, s.system, "index.html")), `${s.system} hub'ı`);
  // dangling wikilinks (should be zero — validator parity)
  const files = renderPortal(sites, { gaps: currentGaps() });
  const broken = files.filter((f) => f.path.endsWith(".html") && f.content.includes("wikilink-broken")).length;
  need(broken === 0, `kopuk wikilink: ${broken}`);
  // search index non-empty and covers pages
  const idxFile = files.find((f) => f.path === "assets/search-index.js")!;
  const idxLen = (JSON.parse(idxFile.content.replace(/^window\.__HELP_INDEX__ = /, "").replace(/;$/, "")) as unknown[]).length;
  need(idxLen > 0, `arama indeksi dolu (${idxLen} kayıt)`);
  lines.push(`toplam ${count} dosya üretildi`);
  rmSync(tmp, { recursive: true, force: true });
  return { ok, lines };
}

function main() {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith("--")) ?? "all";
  const systems = target === "all" ? SYSTEMS : [target];
  const outArg = argv.find((a) => a.startsWith("--out="));
  const outRoot = join(REPO, outArg ? outArg.slice("--out=".length) : "web/help");
  const portArg = argv.find((a) => a.startsWith("--serve="));
  const doServe = argv.includes("--serve") || !!portArg;
  const port = portArg ? Number(portArg.slice("--serve=".length)) : 8777;

  let sites: HelpSite[];
  try {
    sites = buildSites(systems);
  } catch (e) {
    console.error(`help-site: ${(e as Error).message}`);
    process.exit(1);
    return;
  }

  if (argv.includes("--verify")) {
    const { ok, lines } = verify(sites);
    for (const l of lines) console.log(l);
    console.log(ok ? "help-site --verify: PASS" : "help-site --verify: FAIL");
    process.exit(ok ? 0 : 1);
    return;
  }

  const n = writePortal(sites, outRoot);
  console.log(`kodlanmış site: ${outRoot.replace(HOME, "~")} · ${n} dosya · ${sites.length} sistem`);

  if (argv.includes("--vault")) {
    const vn = writeVault(sites);
    console.log(`vault (paralel hedef): ~/ollamas-vault/_help/ · ${vn} dosya + site.canvas`);
  }

  if (doServe) {
    serve(outRoot, port);
    if (argv.includes("--open")) {
      try { execFileSync("open", [`http://127.0.0.1:${port}/`]); } catch { /* headless */ }
    }
  } else {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { buildSites, writePortal, siteCanvas, verify };
