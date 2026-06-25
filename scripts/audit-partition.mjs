// Faz11 — deterministic project partition for the bug audit.
// Lists every source file with LOC, groups by directory affinity, then splits each
// group into LOC-bounded dispatch units (so each auditor run stays tractable ~benchmark scale).
// Guarantees 100% coverage (every file in exactly one unit) -> coverage table = no blind spot.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const MAX_LOC = 1100;   // per dispatch unit (keep agent run reliable)
const MAX_FILES = 7;    // per dispatch unit

// all tracked-ish source files, excluding noise
const raw = execFileSync("bash", ["-c",
  `cd ${REPO} && find server src scripts bin orchestration tests web public server.ts -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' \\) 2>/dev/null | grep -vE 'node_modules|/dist/|\\.d\\.ts$' | sort`,
]).toString().trim().split("\n").filter(Boolean);

const loc = (f) => {
  try { return execFileSync("bash", ["-c", `wc -l < ${REPO}/${f}`]).toString().trim() | 0; } catch { return 0; }
};
const files = raw.map((f) => ({ f, loc: loc(f) }));
const totalLoc = files.reduce((a, b) => a + b.loc, 0);

// directory-affinity group key
function groupKey(f) {
  if (f === "server.ts") return "A1-core";
  if (/^server\/providers/.test(f)) return "A1-core";
  if (/^server\/(tool-registry|tool-interceptors|tools)/.test(f)) return "A2-tools";
  if (/^server\/mcp\//.test(f)) return "A3-mcp";
  if (/^server\/(store|db|migrations)/.test(f)) return "A4-store";
  if (/^server\//.test(f)) return "A5-server-rest";
  if (/^orchestration\/bin\/lib\/(bench|optimize|driftguard|benchprompt)/.test(f)) return "A7-orch-bench";
  if (/^orchestration\/bin\/(fuse|conduct|autopilot|heartbeat|doctor)/.test(f)) return "A8-orch-fuse";
  if (/^orchestration\//.test(f)) return "A6-orch-agents";
  if (/^tests\//.test(f)) return "A9-tests";
  if (/^src\//.test(f)) return "A10-frontend";
  if (/^scripts\//.test(f)) return "A11-scripts";
  if (/^bin\//.test(f)) return "A12-bridges";
  return "A13-misc";
}

const groups = {};
for (const x of files) (groups[groupKey(x.f)] ||= []).push(x);

// split each group into LOC/file-bounded units
const units = [];
for (const [g, gfiles] of Object.entries(groups)) {
  gfiles.sort((a, b) => a.f.localeCompare(b.f));
  let cur = [], curLoc = 0, idx = 1;
  const flush = () => { if (cur.length) { units.push({ id: `${g}#${idx++}`, group: g, files: cur.map((x) => x.f), loc: curLoc }); cur = []; curLoc = 0; } };
  for (const x of gfiles) {
    if (cur.length && (curLoc + x.loc > MAX_LOC || cur.length >= MAX_FILES)) flush();
    cur.push(x); curLoc += x.loc;
  }
  flush();
}

const out = {
  generatedFor: "Faz11 bug audit",
  totals: { files: files.length, loc: totalLoc, units: units.length, groups: Object.keys(groups).length },
  groupLoc: Object.fromEntries(Object.entries(groups).map(([g, a]) => [g, a.reduce((s, x) => s + x.loc, 0)])),
  units,
};
fs.writeFileSync(`${REPO}/docs/audit/audit-slices.json`, JSON.stringify(out, null, 2));
// coverage assertion: union of unit files == all files, no dup
const flat = units.flatMap((u) => u.files);
const dup = flat.length !== new Set(flat).size;
const missing = files.filter((x) => !flat.includes(x.f)).map((x) => x.f);
console.log(`files=${files.length} loc=${totalLoc} units=${units.length} groups=${Object.keys(groups).length}`);
console.log(`coverage: union=${new Set(flat).size}/${files.length} dup=${dup} missing=${missing.length}`);
console.log(`groupLoc: ${Object.entries(out.groupLoc).map(([g, l]) => g + "=" + l).join("  ")}`);
if (missing.length) console.log("MISSING:", missing.slice(0, 10));
