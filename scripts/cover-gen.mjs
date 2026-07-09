#!/usr/bin/env node
// @ts-check
// cover-gen — headless, zero-cost editorial cover generator for Substack / social.
//
// Authors an ABSTRACT, SYMBOLIC SVG (no faces, no graphic content) and rasterizes
// it to PNG via `rsvg-convert` (librsvg) — falls back to ImageMagick `magick` if
// rsvg-convert is missing. No external image API, no credits, no browser, so the
// ollamas content pipeline can produce post covers fully autonomously (the missing
// "image step" that paid MCPs/credits otherwise gate).
//
// Usage:
//   node scripts/cover-gen.mjs --title "What Is a Human Rights Defender?" \
//        --kicker "eCy · EXPLAINER · 2026" --motif light --out ~/cover.png
//   motifs: light | strata | network | roots | circle   (palette auto-picks per motif)
//   --json '{"title":"...","kicker":"...","motif":"...","out":"..."}'  (pipeline-friendly)
//
// Output: 1200x630 PNG (Substack social/cover ratio). Prints the PNG path on success.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const jIdx = args.indexOf("--json");
const J = jIdx >= 0 ? JSON.parse(args[jIdx + 1]) : {};
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : (J[k] ?? d); };

const title = String(opt("title", "Human Rights"));
const kicker = String(opt("kicker", "eCy · HUMAN RIGHTS")).toUpperCase();
const motif = opt("motif", "light");
const out = opt("out", `${os.homedir()}/.llm-mission-control/covers/cover.png`).replace(/^~/, os.homedir());
const W = 1200, H = 630;

const PALETTES = {
  light:   { bg0: "#1b2433", bg1: "#0c1019", ink: "#f4efe6", accent: "#e9b65a", soft: "#7c8aa0" },
  strata:  { bg0: "#242c39", bg1: "#10141b", ink: "#f1ece4", accent: "#cf5b42", soft: "#6f7d92" },
  network: { bg0: "#0f2030", bg1: "#091019", ink: "#eaf2f8", accent: "#54cfc6", soft: "#5f7d9a" },
  roots:   { bg0: "#1d2a1f", bg1: "#0d1410", ink: "#f1efe2", accent: "#a7c061", soft: "#7e8c6a" },
  circle:  { bg0: "#2a2030", bg1: "#140e18", ink: "#f6efe9", accent: "#e09a5b", soft: "#9a7f8f" },
};
const P = PALETTES[opt("palette", motif)] || PALETTES.light;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (n) => Number(n).toFixed(1);

// word-wrap a title into <=maxChars lines (rough; SVG has no auto-wrap)
function wrap(text, maxChars) {
  const words = text.split(/\s+/); const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

// ---- abstract symbolic motifs (geometric, no faces, no graphic content) ----
function motifLight() {
  let s = `<radialGradient id="glow" cx="62%" cy="42%" r="46%"><stop offset="0%" stop-color="${P.accent}" stop-opacity="0.85"/><stop offset="100%" stop-color="${P.accent}" stop-opacity="0"/></radialGradient>`;
  s = `<defs>${s}</defs><circle cx="840" cy="270" r="300" fill="url(#glow)"/><circle cx="840" cy="270" r="40" fill="${P.accent}"/>`;
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; s += `<line x1="${r2(840 + Math.cos(a) * 62)}" y1="${r2(270 + Math.sin(a) * 62)}" x2="${r2(840 + Math.cos(a) * 132)}" y2="${r2(270 + Math.sin(a) * 132)}" stroke="${P.accent}" stroke-opacity="0.45" stroke-width="3"/>`; }
  // crowd reaching up: open chevrons of varying height
  for (let i = 0; i < 13; i++) { const x = 560 + i * 52; const h = 120 + ((i * 37) % 90); s += `<path d="M${x} 600 L${x + 26} ${600 - h} L${x + 52} 600" fill="none" stroke="${P.soft}" stroke-opacity="0.55" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`; }
  return s;
}
function motifStrata() {
  let s = "";
  for (let i = 0; i < 10; i++) { const w = 120 + i * 78; const y = 520 - i * 44; const op = (0.28 + i * 0.07).toFixed(2); s += `<rect x="600" y="${y}" width="${w}" height="26" rx="6" fill="${i >= 8 ? P.accent : P.soft}" fill-opacity="${op}"/>`; }
  for (let i = 0; i < 6; i++) { const x = 640 + i * 86; s += `<path d="M${x} 250 L${x + 18} 210 L${x + 36} 250 L${x + 18} 290 Z" fill="${P.ink}" fill-opacity="${(0.5 - i * 0.06).toFixed(2)}"/>`; }
  return s;
}
function motifNetwork() {
  let s = ""; const nodes = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const x = 600 + c * 96 + (r % 2) * 22; const y = 150 + r * 110; nodes.push([x, y]); }
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) { const dx = nodes[a][0] - nodes[b][0], dy = nodes[a][1] - nodes[b][1]; if (Math.hypot(dx, dy) < 140) s += `<line x1="${r2(nodes[a][0])}" y1="${r2(nodes[a][1])}" x2="${r2(nodes[b][0])}" y2="${r2(nodes[b][1])}" stroke="${P.soft}" stroke-opacity="0.3" stroke-width="1.5"/>`; }
  for (const [x, y] of nodes) s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="5" fill="${P.soft}" fill-opacity="0.7"/>`;
  // the watching eye (surveillance) — abstract lens, no face
  s += `<ellipse cx="840" cy="320" rx="120" ry="64" fill="none" stroke="${P.accent}" stroke-width="4"/><circle cx="840" cy="320" r="30" fill="${P.accent}" fill-opacity="0.85"/><circle cx="840" cy="320" r="12" fill="${P.bg1}"/>`;
  return s;
}
function motifRoots() {
  let s = `<circle cx="840" cy="250" r="34" fill="${P.accent}"/><path d="M840 216 q-30 -54 -8 -96 q22 30 8 96" fill="${P.accent}" fill-opacity="0.8"/>`;
  const branch = (x, y, ang, len, depth) => { if (depth === 0 || len < 16) return ""; const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len; let o = `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(nx)}" y2="${r2(ny)}" stroke="${P.soft}" stroke-opacity="0.6" stroke-width="${Math.max(1, depth)}"/>`; o += branch(nx, ny, ang - 0.5, len * 0.72, depth - 1); o += branch(nx, ny, ang + 0.5, len * 0.72, depth - 1); return o; };
  s += branch(840, 284, Math.PI / 2, 84, 5);
  return s;
}
function motifCircle() {
  let s = ""; const cx = 840, cy = 300, R = 170, n = 12;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; const a2 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2; const x2 = cx + Math.cos(a2) * R, y2 = cy + Math.sin(a2) * R; s += `<line x1="${r2(x)}" y1="${r2(y)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${P.soft}" stroke-opacity="0.5" stroke-width="4"/>`; s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="16" fill="${i % 3 === 0 ? P.accent : P.soft}" fill-opacity="0.85"/>`; }
  s += `<circle cx="${cx}" cy="${cy}" r="42" fill="${P.accent}" fill-opacity="0.18"/>`;
  return s;
}
const MOTIF = { light: motifLight, strata: motifStrata, network: motifNetwork, roots: motifRoots, circle: motifCircle };

const titleLines = wrap(title, 22);
const titleSvg = titleLines.map((ln, i) => `<text x="80" y="${438 + i * 58}" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="700" fill="${P.ink}">${esc(ln)}</text>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0%" stop-color="${P.bg0}"/><stop offset="100%" stop-color="${P.bg1}"/></linearGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer><feComposite operator="over" in2="SourceGraphic"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${(MOTIF[motif] || motifLight)()}
  <rect width="${W}" height="${H}" fill="#000" opacity="0.0" filter="url(#grain)"/>
  <text x="80" y="120" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="3" font-weight="700" fill="${P.accent}">${esc(kicker)}</text>
  <line x1="80" y1="150" x2="180" y2="150" stroke="${P.accent}" stroke-width="3"/>
  ${titleSvg}
  <text x="80" y="585" font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="1" fill="${P.soft}">Evidence-first · Sourced to Amnesty, HRW &amp; the UN</text>
  <text x="${W - 80}" y="585" text-anchor="end" font-family="Georgia, serif" font-size="22" font-weight="700" fill="${P.ink}">eCy</text>
</svg>`;

mkdirSync(dirname(out), { recursive: true });
const svgPath = out.replace(/\.png$/i, "") + ".svg";
writeFileSync(svgPath, svg);

function rasterize() {
  try { execFileSync("rsvg-convert", ["-w", String(W), "-h", String(H), svgPath, "-o", out], { stdio: "pipe" }); return "rsvg-convert"; }
  catch (e) {
    try { execFileSync("magick", ["-background", "none", "-density", "144", svgPath, "-resize", `${W}x${H}`, out], { stdio: "pipe" }); return "magick"; }
    catch (e2) { throw new Error(`no SVG rasterizer (install librsvg: brew install librsvg). ${e2.message}`); }
  }
}
const via = rasterize();
if (!existsSync(out)) { console.error("cover-gen: PNG not written"); process.exit(1); }
console.log(JSON.stringify({ ok: true, png: out, svg: svgPath, via, motif, w: W, h: H }));
