#!/usr/bin/env node
// substack-digest — RELIABLE, scrape-free Substack reporting from the user's Gmail.
//
// Why Gmail (not web scraping): Substack has no public stats API; substack.com gates
// fresh sessions behind Cloudflare and renders trending via JS — fragile/unreliable for
// an unattended loop. But every newsletter the user subscribes to LANDS IN GMAIL. So the
// sustainable source of truth = the Substack newsletter emails (Gmail API: stable, no
// Cloudflare, no JS). Claude collects them via the Gmail MCP each run and pipes the
// structured list to this script, which aggregates + ledgers them for week-over-week trend.
//
// Usage:  node scripts/substack-digest.mjs '<json-array of {sender,subject,date,topics?}>'
//         (or pipe the JSON on stdin). Appends a snapshot to the history ledger and prints
//         the digest: top senders (frequency = engagement proxy), trending topics, and the
//         delta vs the previous run (which sender/topic is rising — the "learning" part).
//
// The history ledger doubles as the continuous-trend store, exactly like the system-monitor
// ledger: each run is one line; comparing runs surfaces what's rising/falling over time.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LEDGER = `${process.env.HOME}/.llm-mission-control/substack-history.jsonl`;
const TOPIC_WORDS = ["ai", "apple", "claude", "agent", "agents", "openai", "gpt", "llm", "layoff", "layoffs",
  "salesforce", "trump", "politics", "election", "tax", "economy", "crypto", "bitcoin", "podcast",
  "startup", "product", "design", "war", "climate", "health", "google", "meta", "nvidia"];

function readInput() {
  const arg = process.argv.slice(2).find((a) => a.trim().startsWith("["));
  if (arg) return arg;
  try { return readFileSync(0, "utf8"); } catch { return "[]"; }
}

let items;
try { items = JSON.parse(readInput()); } catch { console.error("usage: substack-digest '<json [{sender,subject,date}]>'"); process.exit(2); }
items = (items || []).filter((m) => m && m.sender && !/verification code|sign in to substack|login/i.test(m.subject || ""));

// Top senders = frequency (how often they reach the inbox = engagement/cadence proxy).
const bySender = {};
for (const m of items) { const s = (m.sender || "").replace(/\+[^@]*@/, "@"); bySender[s] = (bySender[s] || 0) + 1; }
const topSenders = Object.entries(bySender).sort((a, b) => b[1] - a[1]);

// Trending topics = keyword hits across all subjects/snippets.
const text = items.map((m) => `${m.subject || ""} ${(m.topics || []).join(" ")}`).join(" ").toLowerCase();
const topicHits = TOPIC_WORDS.map((w) => [w, (text.match(new RegExp(`\\b${w}\\b`, "g")) || []).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

const stamp = new Date().toISOString();
const snapshot = { ts: stamp, count: items.length, senders: Object.fromEntries(topSenders), topics: Object.fromEntries(topicHits) };

// Delta vs previous run (rising/falling) — the continuous "learning" signal.
let prev = null;
try { if (existsSync(LEDGER)) { const ls = readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean); if (ls.length) prev = JSON.parse(ls[ls.length - 1]); } } catch {}
const rising = [];
if (prev) for (const [s, n] of topSenders) { const was = prev.senders?.[s] || 0; if (n > was) rising.push(`${s} +${n - was}`); }

try { mkdirSync(dirname(LEDGER), { recursive: true }); appendFileSync(LEDGER, JSON.stringify(snapshot) + "\n"); } catch (e) { console.error(`[ledger] ${e.message}`); }

console.log(`── Substack digest ──  ${stamp.slice(0, 10)}  (${items.length} newsletters)`);
console.log(`  TOP SENDERS (frequency = engagement):`);
for (const [s, n] of topSenders.slice(0, 6)) console.log(`    ${String(n).padStart(2)}×  ${s}`);
console.log(`  TRENDING TOPICS:`);
console.log(`    ${topicHits.slice(0, 10).map(([w, n]) => `${w}(${n})`).join(" · ") || "—"}`);
if (rising.length) console.log(`  RISING vs last run: ${rising.join(", ")}`);
console.log(`  ledger: ${LEDGER}`);
