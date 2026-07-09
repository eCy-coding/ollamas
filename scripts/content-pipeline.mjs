#!/usr/bin/env node
// @ts-check
// content-pipeline — autonomous, headless "post-prep" pipeline for the eCy
// human-rights publication. Runs WITHOUT Claude Code: research -> draft -> cover ->
// publish-ready bundle on disk. The ONE step it cannot do headless is the final
// publish: Substack has no publish API + an httpOnly session cookie + Cloudflare,
// so publishing always needs an authed browser (Claude Code / Chrome MCP, or a human
// clicking "Publish"). This pipeline produces the bundle; a human/agent publishes it.
//
// Steps:
//   1. research  -> firecrawl.mjs --search  (headless, FIRECRAWL_API_KEY in .env)
//   2. draft     -> local Ollama (qwen3:8b, $0 / 0 tokens). Degrades to a skeleton
//                   if Ollama is down, so a bundle is ALWAYS produced.
//   3. cover     -> cover-gen.mjs (free SVG->PNG, no API/credits/browser)
//   4. emit      -> ~/.llm-mission-control/content-queue/<slug>/{post.md, seo.json,
//                   image-prompt.txt, cover.png, sources.json, meta.json, PUBLISH.md}
//
// Usage:
//   node scripts/content-pipeline.mjs --topic "Digital rights and AI surveillance of human rights defenders"
//   node scripts/content-pipeline.mjs --all     # runs every topic in content-queue/topics.json
//   add --no-cover to skip cover, --angle "<extra framing>" to steer the draft.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const pexec = promisify(execFile);
// derive repo root from THIS script's location so it works in a git worktree or main checkout
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE = `${os.homedir()}/.llm-mission-control/content-queue`;
const OLLAMA = process.env.OLLAMA_HOST?.replace("host.docker.internal", "127.0.0.1") || "http://127.0.0.1:11434";
const MODEL = process.env.CONTENT_MODEL || "qwen3:8b";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(`--${k}`);

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const motifFor = (t) => /digital|ai|surveil|spyware|cyber/i.test(t) ? "network"
  : /climate|land|environment|indigenous/i.test(t) ? "roots"
  : /support|action|help|donate|solidarit/i.test(t) ? "circle"
  : /rank|list|most|urgent|top/i.test(t) ? "strata" : "light";

async function research(topic) {
  try {
    const { stdout } = await pexec("node", ["scripts/firecrawl.mjs", "--search", `${topic} human rights 2026`, "--json"],
      { cwd: REPO, timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    const j = JSON.parse(stdout);
    return (j.results || []).slice(0, 6).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
  } catch (e) { return []; }
}

async function draft(topic, angle, sources) {
  const sys = "You are an eCyPro human-rights editor. Write an evidence-first Substack post in English. Every statistic MUST be attributable to Amnesty International, Human Rights Watch, the UN/OHCHR, or the Business & Human Rights Resource Centre — if you are unsure of a number, write [VERIFY] instead of inventing it. No graphic content. Return STRICT JSON only.";
  const user = `Topic: ${topic}\nAngle: ${angle || "(none)"}\nResearch snippets:\n${sources.map((s) => `- ${s.title} :: ${s.snippet} (${s.url})`).join("\n") || "(none — write from general knowledge, mark unverifiable stats [VERIFY])"}\n\nReturn JSON with keys: title (<=70 chars), subtitle, seo_title (<=60), seo_description (50-160 chars), body_markdown (## headings, **bold**, lists, a TL;DR line, a short FAQ, and a Sources section listing the org names — NO markdown links, they are added at publish time), image_prompt (abstract, no faces).`;
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, stream: false, format: "json", options: { temperature: 0.4 },
        messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const j = await r.json();
    const obj = JSON.parse(j.message?.content || "{}");
    if (!obj.body_markdown) throw new Error("no body");
    // Default the title so a reply omitting it never yields a "# undefined" header.
    return { ...obj, title: obj.title || topic, _source: `ollama:${MODEL}` };
  } catch (e) {
    // graceful skeleton so a bundle is ALWAYS produced
    return {
      title: topic, subtitle: "Evidence-first — every claim sourced.",
      seo_title: topic.slice(0, 60), seo_description: `${topic} — evidence-first human rights analysis, sourced to Amnesty, HRW & the UN.`.slice(0, 160),
      body_markdown: `**TL;DR.** [DRAFT — Ollama was unreachable; enrich this from the research below.]\n\n## Overview\n${topic}.\n\n## What the sources say\n${sources.map((s) => `- ${s.title}: ${s.snippet} (${s.url})`).join("\n") || "- [add sourced facts]"}\n\n## Sources\n${[...new Set(sources.map((s) => { try { return new URL(s.url).hostname; } catch { return null; } }).filter(Boolean))].join(", ") || "Amnesty International, Human Rights Watch, UN/OHCHR"}`,
      image_prompt: `abstract symbolic editorial cover about ${topic}, no faces, no graphic content, muted documentary palette`,
      _source: "skeleton(ollama-down)",
    };
  }
}

async function makeCover(dir, title, motif) {
  try {
    await pexec("node", ["scripts/cover-gen.mjs", "--title", title, "--kicker", "eCy · HUMAN RIGHTS · 2026", "--motif", motif, "--out", `${dir}/cover.png`],
      { cwd: REPO, timeout: 30000 });
    return true;
  } catch (e) { return false; }
}

async function run(topic, angle) {
  const slug = slugify(topic);
  const dir = `${QUEUE}/${slug}`;
  mkdirSync(dir, { recursive: true });
  const sources = await research(topic);
  const d = await draft(topic, angle, sources);
  const motif = motifFor(topic);
  const cover = has("no-cover") ? false : await makeCover(dir, d.title || topic, motif);

  writeFileSync(`${dir}/post.md`, `# ${d.title}\n\n_${d.subtitle}_\n\n${d.body_markdown}\n`);
  writeFileSync(`${dir}/seo.json`, JSON.stringify({ slug, seo_title: d.seo_title, seo_description: d.seo_description }, null, 2));
  writeFileSync(`${dir}/image-prompt.txt`, d.image_prompt || "");
  writeFileSync(`${dir}/sources.json`, JSON.stringify(sources, null, 2));
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ slug, topic, angle: angle || null, motif, drafted_by: d._source, cover, status: "ready", needs_publish: "authed-browser (Substack has no publish API)" }, null, 2));
  writeFileSync(`${dir}/PUBLISH.md`, [
    `# Publish checklist — ${d.title}`, ``,
    `Headless prep is DONE. Final publish needs an authed browser (Chrome MCP / human):`, ``,
    `1. ecy1.substack.com/publish/post?type=newsletter`,
    `2. Paste title + subtitle + body from post.md (markdown auto-formats; add real source links via Cmd+K).`,
    `3. Settings → SEO: title="${d.seo_title}", description from seo.json; upload cover.png as social/cover image.`,
    `4. Continue → choose web-only or email → publish.`,
    `5. Verify: node scripts/firecrawl.mjs "https://ecy1.substack.com/archive?sort=new"`,
  ].join("\n"));

  console.log(JSON.stringify({ slug, dir, sources: sources.length, drafted_by: d._source, cover, status: "ready" }));
}

const topics = has("all")
  ? JSON.parse(existsSync(`${QUEUE}/topics.json`) ? readFileSync(`${QUEUE}/topics.json`, "utf8") : "[]")
  : [{ topic: opt("topic", "Human rights defenders in 2026"), angle: opt("angle", "") }];

if (!topics.length) { console.error("no topics — pass --topic or create content-queue/topics.json"); process.exit(2); }
for (const t of topics) await run(typeof t === "string" ? t : t.topic, typeof t === "object" ? t.angle : "");
