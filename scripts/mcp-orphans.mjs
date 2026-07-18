#!/usr/bin/env node
// @ts-check
// scripts/mcp-orphans.mjs — READ-ONLY MCP process-tree diagnostic (zero-dep).
//
// WHY THIS EXISTS: measured on this machine, 204 MCP-signature processes (~3055 MB RSS
// combined) are spawned by 126 distinct parents — Claude.app (14 children), several
// Claude Code sessions (8 each), and the two ollamas servers (8 each). ZERO of them had
// PPID 1, so there are no classic orphans; the memory pressure is mostly OTHER apps' MCP
// fleets, not ollamas'. Swap was ~97% full, which is what starves ollama
// (`system_limited=true`) and causes model evict/reload stalls. This script exists to make
// that attribution visible WITHOUT ever touching a process — it is a diagnostic, not a
// killer, and it never signals anything, even when it finds a genuine orphan.
//
// It:
//   1. Enumerates processes via `ps -axo pid,ppid,rss,etime,command` (no shell interpolation).
//   2. Matches MCP-ish processes by signature (@modelcontextprotocol, mcp-server-,
//      playwright-mcp, etsy-mcp, prisma mcp, mcp-pdf-server, generic /\bmcp\b/i fallback).
//   3. Finds "live owners" = PIDs LISTENING on the ollamas ports (3000/3099 by default) via
//      `lsof -nP -iTCP -sTCP:LISTEN`, and walks their descendant trees from the ppid map.
//   4. Classifies each match: ollamas (inside an ollamas server's tree) / orphan (PPID 1, or
//      parent missing from the ps snapshot) / other (a live non-ollamas parent, e.g.
//      Claude.app, Claude Code) — and resolves each owner's own command so the report NAMES it.
//   5. Prints a per-owner table + per-class totals, and — ONLY if orphans exist — a
//      `kill -TERM <pids>` SUGGESTION string it does NOT execute.
//
// Usage:
//   node scripts/mcp-orphans.mjs
//   node scripts/mcp-orphans.mjs --json
//   node scripts/mcp-orphans.mjs --ports 3000,3099        (or OLLAMAS_PORTS=3000,3099)
//
// This script NEVER calls kill/signal on anything. It is read-only by design.

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const JSON_OUT = has("--json");
const PORTS = (opt("--ports", process.env.OLLAMAS_PORTS || "3000,3099"))
  .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isInteger);

const SELF_PID = process.pid;
const SELF_BASENAME = "mcp-orphans.mjs";

// ── MCP signature matching ──────────────────────────────────────────────────────────────
const MCP_SIGNATURES = [
  /@modelcontextprotocol/,
  /mcp-server-/,
  /playwright-mcp/,
  /etsy-mcp/,
  /prisma\s+mcp/i,
  /mcp-pdf-server/,
];
const MCP_FALLBACK = /\bmcp\b/i;

function isMcpProcess(entry) {
  if (entry.pid === SELF_PID) return false; // exclude self
  if (entry.command.includes(SELF_BASENAME)) return false; // exclude self defensively (any invocation form)
  if (/\bgrep\b/i.test(entry.command)) return false; // exclude any lingering grep-for-mcp helper process
  return MCP_SIGNATURES.some((re) => re.test(entry.command)) || MCP_FALLBACK.test(entry.command);
}

// ── ps snapshot ──────────────────────────────────────────────────────────────────────────
function readPsSnapshot() {
  let out;
  try {
    out = execFileSync("ps", ["-axo", "pid,ppid,rss,etime,command"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    console.error(`mcp-orphans: \`ps\` failed — cannot continue: ${e?.message || e}`);
    process.exit(1);
  }
  const entries = [];
  const lines = out.split("\n");
  const lineRe = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(lineRe);
    if (!m) continue; // header line or malformed → skip, never throw
    const [, pidS, ppidS, rssS, etime, command] = m;
    const pid = Number(pidS), ppid = Number(ppidS), rssKB = Number(rssS);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(rssKB)) continue;
    entries.push({ pid, ppid, rssKB, etime, command });
  }
  return entries;
}

// ── lsof: live owners (PIDs listening on the ollamas ports) ────────────────────────────────
function readListeningOwners(ports) {
  let out;
  try {
    out = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return { owners: new Set(), warning: `lsof unavailable or failed (${e?.message || e}) — ollamas-tree detection skipped, degrading to process inventory only` };
  }
  if (!out || !out.trim()) {
    return { owners: new Set(), warning: "lsof returned no listeners — ollamas-tree detection skipped, degrading to process inventory only" };
  }
  const owners = new Set();
  for (const line of out.split("\n")) {
    if (!line || /^COMMAND\s/.test(line)) continue;
    if (!/LISTEN/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[1]);
    if (!Number.isInteger(pid)) continue;
    for (const port of ports) {
      if (new RegExp(`[:.]${port}(?!\\d)`).test(line)) { owners.add(pid); break; }
    }
  }
  return { owners, warning: owners.size === 0 ? `lsof ran but no listener found on port(s) ${ports.join(",")} — ollamas-tree detection skipped, degrading to process inventory only` : null };
}

// ── tree walk ────────────────────────────────────────────────────────────────────────────
function buildChildrenMap(entries) {
  const map = new Map(); // ppid -> [pid,...]
  for (const e of entries) {
    if (!map.has(e.ppid)) map.set(e.ppid, []);
    map.get(e.ppid).push(e.pid);
  }
  return map;
}

// Returns Map<pid, rootOwnerPid> for every pid reachable (incl. self) from any root in `roots`.
function descendantRootMap(roots, childrenMap) {
  const rootOf = new Map();
  for (const root of roots) {
    if (rootOf.has(root)) continue; // already claimed by an earlier root
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const pid = stack.pop();
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (!rootOf.has(pid)) rootOf.set(pid, root);
      for (const child of childrenMap.get(pid) || []) stack.push(child);
    }
  }
  return rootOf;
}

// ── classify ─────────────────────────────────────────────────────────────────────────────
function classify(matches, pidMap, childrenMap, ollamasRoots) {
  const rootOf = descendantRootMap(ollamasRoots, childrenMap);
  const classified = [];
  for (const m of matches) {
    if (rootOf.has(m.pid)) {
      const ownerPid = rootOf.get(m.pid);
      classified.push({ ...m, class: "ollamas", ownerPid, ownerCmd: pidMap.get(ownerPid)?.command ?? `pid ${ownerPid}` });
    } else if (m.ppid === 1 || !pidMap.has(m.ppid)) {
      classified.push({ ...m, class: "orphan", ownerPid: m.ppid, ownerCmd: m.ppid === 1 ? "launchd/init (PPID 1)" : "(parent not in ps snapshot)" });
    } else {
      classified.push({ ...m, class: "other", ownerPid: m.ppid, ownerCmd: pidMap.get(m.ppid)?.command ?? `pid ${m.ppid}` });
    }
  }
  return classified;
}

function shortCmd(cmd, len = 64) {
  const c = cmd.trim();
  return c.length > len ? `${c.slice(0, len - 1)}…` : c;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────
const psEntries = readPsSnapshot();
const pidMap = new Map(psEntries.map((e) => [e.pid, e]));
const childrenMap = buildChildrenMap(psEntries);

const { owners: ollamasRoots, warning: lsofWarning } = readListeningOwners(PORTS);
const warnings = lsofWarning ? [lsofWarning] : [];

const matches = psEntries.filter(isMcpProcess);
const classified = classify(matches, pidMap, childrenMap, ollamasRoots);

// Group into per-owner rows.
const ownerRows = new Map(); // key `${class}:${ownerPid}` -> row
for (const m of classified) {
  const key = `${m.class}:${m.ownerPid}`;
  if (!ownerRows.has(key)) {
    ownerRows.set(key, { class: m.class, ownerPid: m.ownerPid, ownerCmd: m.ownerCmd, count: 0, rssKB: 0 });
  }
  const row = ownerRows.get(key);
  row.count += 1;
  row.rssKB += m.rssKB;
}
const rows = [...ownerRows.values()].sort((a, b) => b.rssKB - a.rssKB);

// Per-class totals.
const classTotals = { ollamas: { count: 0, rssKB: 0 }, other: { count: 0, rssKB: 0 }, orphan: { count: 0, rssKB: 0 } };
for (const m of classified) {
  classTotals[m.class].count += 1;
  classTotals[m.class].rssKB += m.rssKB;
}

const orphanPids = classified.filter((m) => m.class === "orphan").map((m) => m.pid);
const killSuggestion = orphanPids.length ? `kill -TERM ${orphanPids.join(" ")}` : null;

const totalMatches = classified.length;
const totalRssMB = Math.round((classified.reduce((s, m) => s + m.rssKB, 0) / 1024) * 10) / 10;

// ── output ───────────────────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ports: PORTS,
    readOnly: true,
    neverKills: true,
    warnings,
    totalMatches,
    totalRssMB,
    byClass: Object.fromEntries(Object.entries(classTotals).map(([k, v]) => [k, { count: v.count, mb: Math.round((v.rssKB / 1024) * 10) / 10 }])),
    owners: rows.map((r) => ({ class: r.class, ownerPid: r.ownerPid, ownerCmd: shortCmd(r.ownerCmd), childCount: r.count, rssMB: Math.round((r.rssKB / 1024) * 10) / 10 })),
    orphanPids,
    killSuggestion,
    note: killSuggestion ? "killSuggestion is a SUGGESTION STRING ONLY — this script never executes it." : "no orphans found — nothing to suggest.",
  }, null, 2));
} else {
  console.log("── mcp-orphans (READ-ONLY diagnostic — this script never signals/kills anything) ──");
  console.log(`  ports checked: ${PORTS.join(", ")}   matches: ${totalMatches} MCP-signature process(es)   total RSS: ${totalRssMB} MB`);
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log("");
  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(pad("CLASS", 9) + pad("OWNER PID", 11) + pad("CHILDREN", 10) + pad("RSS MB", 9) + "OWNER COMMAND");
  for (const r of rows) {
    console.log(pad(r.class, 9) + pad(String(r.ownerPid), 11) + pad(String(r.count), 10) + pad(String(Math.round((r.rssKB / 1024) * 10) / 10), 9) + shortCmd(r.ownerCmd));
  }
  console.log("");
  console.log("  TOTALS PER CLASS:");
  for (const [cls, v] of Object.entries(classTotals)) {
    console.log(`    ${pad(cls, 9)} count=${v.count}  ${Math.round((v.rssKB / 1024) * 10) / 10} MB`);
  }
  console.log("");
  console.log("  'other' fleets belong to OTHER apps (Claude.app, Claude Code sessions, etc.), not to ollamas.");
  console.log("  If you want that memory back, quit those apps yourself — this script never touches any process.");
  if (killSuggestion) {
    console.log("");
    console.log(`  ⚠ ${orphanPids.length} orphan MCP process(es) found (PPID 1, or parent missing from the ps snapshot).`);
    console.log("  This script NEVER kills anything. If you've verified these are safe to remove, you may run manually:");
    console.log(`    ${killSuggestion}`);
  } else {
    console.log("");
    console.log("  0 orphans found — nothing to suggest killing.");
  }
}

process.exit(0);
