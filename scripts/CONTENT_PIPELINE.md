# Autonomous content pipeline (runs WITHOUT Claude Code)

Headless prep for the **eCy** human-rights Substack. Produces publish-ready bundles
with zero Claude Code, zero paid APIs for the image, and $0 LLM cost (local Ollama).

## Scripts
| script | does | cost | headless |
|---|---|---|---|
| `scripts/cover-gen.mjs` | abstract symbolic SVG → PNG cover (rsvg-convert / magick) | free | ✅ |
| `scripts/content-pipeline.mjs` | research → draft → cover → publish-ready bundle | free ($0 local LLM) | ✅ |
| `scripts/firecrawl.mjs` | web research/scrape (FIRECRAWL_API_KEY) | free tier | ✅ |
| `scripts/system-monitor.mjs` | `content_queue` invariant counts ready bundles | — | ✅ |

## Run
```bash
npm run content:gen -- --topic "Digital rights and AI surveillance of human rights defenders" --angle "spyware, facial recognition"
npm run content:gen -- --all          # every topic in ~/.llm-mission-control/content-queue/topics.json
npm run cover:gen   -- --title "..." --kicker "eCy · HUMAN RIGHTS · 2026" --motif network --out ~/c.png
```
Each run writes `~/.llm-mission-control/content-queue/<slug>/`:
`post.md` · `seo.json` · `image-prompt.txt` · `cover.png` (+`.svg`) · `sources.json` · `meta.json{status:ready}` · `PUBLISH.md`.

Pipeline degrades gracefully: if Ollama is down it still emits a skeleton from the
research; numbers it can't verify are flagged `[VERIFY]` (never invented).

## The one step that is NOT headless — publishing
**Substack has no publish API**, uses an **httpOnly session cookie**, and **Cloudflare-gates**
plain HTTP. So a script CANNOT publish. The pipeline goes as far as a fully prepared
bundle; the final publish needs an **authed browser** — Claude Code (Chrome MCP) or a
human pasting `post.md` + uploading `cover.png` and clicking Publish (steps in each
bundle's `PUBLISH.md`). This is a Substack constraint, not a limitation of this system.

Verify a published post server-side (no browser):
```bash
node scripts/firecrawl.mjs "https://ecy1.substack.com/archive?sort=new"
```

## Schedule (optional, cron-friendly)
`system-monitor.mjs --heartbeat` already runs under launchd (`ops/launchd/…`). Add a
weekly `content:gen --all` the same way to keep the queue stocked; a human/agent then
publishes from the queue. See [[substack-mastery]] for the authed-browser write playbook.
