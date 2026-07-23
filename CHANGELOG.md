# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.34.0](https://github.com/eCy-coding/ollamas/compare/v1.33.0...v1.34.0) (2026-07-23)


### Features

* **agent-policy:** safePreset + appRiskClasses saf cekirdek (ajan izinler paneli) ([765469f](https://github.com/eCy-coding/ollamas/commit/765469f5f0ca0943dde4bb86f79ccc37b19320e0))
* **apps:** 100 ranked macOS app cards for ollamas/eCym/odysseus ([dee167e](https://github.com/eCy-coding/ollamas/commit/dee167edd644639e8844d6a4ea357303a2d90258))
* **apps:** app-literacy DERINLIK — usage kilavuzu + ornek komut + canDo (top-20) ([b526a43](https://github.com/eCy-coding/ollamas/commit/b526a43a6bb75c0e72a4ab1305a06d34b8d19ffe))
* **apps:** eCym match-regression gate for teaching the 100 app cards ([ee3974f](https://github.com/eCy-coding/ollamas/commit/ee3974f370751294aff0524cfed05280b010c3ac))
* **apps:** odysseus app-literacy erisimi — GET endpoint + app-help (uc sistem esit) ([f67ec68](https://github.com/eCy-coding/ollamas/commit/f67ec6834478dbe8fbe6575035190d200ca194fc))
* **backend:** add durable sqlite job queue + croner scheduler (B1) ([ec5448a](https://github.com/eCy-coding/ollamas/commit/ec5448a8c6c66898af90519a35eed652e47aaade))
* **backend:** add local cross-encoder rerank + semantic chunking to RAG (B5) ([c8acb22](https://github.com/eCy-coding/ollamas/commit/c8acb227bc14c181bd8b8a70dc7dbd01a51b6bb8))
* **backend:** add OpenTelemetry tracing + in-process trace buffer + /api/traces (B2) ([c7b9450](https://github.com/eCy-coding/ollamas/commit/c7b94507907d616a789a150846b355f95da0a969))
* **backend:** add quickjs WASM sandbox + sandbox_eval tool (B4) ([954a0a7](https://github.com/eCy-coding/ollamas/commit/954a0a790c68e53c0df8d4b3e8bbc6aa3184e4a0))
* **backend:** in-house semantic LLM response cache + /api/cache (C4) ([86e762f](https://github.com/eCy-coding/ollamas/commit/86e762fa33a8bee1ff33a88cc92d1fa6dbfdd1f9))
* **backend:** migrate periodic loops to jobs + prom metrics for jobs/tracing/hierarchy (C2) ([94b7311](https://github.com/eCy-coding/ollamas/commit/94b73112a45cb23a92b3c7dea8d239edcf834a9f))
* **backend:** port brain v1 module + tool registration from integrate-wt (B3) ([69986e2](https://github.com/eCy-coding/ollamas/commit/69986e23ebc56d5ba7e026f318caf48129662440))
* **backend:** port promptfoo eval harness + rerank uplift eval (B6) ([140252e](https://github.com/eCy-coding/ollamas/commit/140252ede70d34d97bc5d566d981445cbd248d87))
* **backend:** wire hierarchy tier-router as advisory bridge + /api/hierarchy (B7) ([fcd1589](https://github.com/eCy-coding/ollamas/commit/fcd1589c8003a4bb21973b4e65d04fe6673a0cc5))
* **brain:** /brain panel + brain API routes hoisted to module top level ([d129b98](https://github.com/eCy-coding/ollamas/commit/d129b982af85337b2f4cca08a05a266554e11f63))
* **brain:** 2026-standards governance — abstention, audit ledger, right-to-be-forgotten ([27eeea8](https://github.com/eCy-coding/ollamas/commit/27eeea83029298c588459cc7babfd156c850ea4b))
* **brain:** 2026-standards recall semantics — actor attribution + relative-time windows ([8729724](https://github.com/eCy-coding/ollamas/commit/8729724841879c38a87602c8b85835f9fd59f207))
* **brain:** A-MAC admission gate — noise turns never reach the store ([acbb02d](https://github.com/eCy-coding/ollamas/commit/acbb02d41180bb467d8c4fbd284e478e930c190b))
* **brain:** adopt B5 cross-encoder rerank on recall, evidence-gated opt-in ([50d3fde](https://github.com/eCy-coding/ollamas/commit/50d3fde0fa1303cbf98803580b4df8f0494ad1d8))
* **brain:** ask — synthesized, cited, confident answers that never go silent ([3b175af](https://github.com/eCy-coding/ollamas/commit/3b175af61990c10fe12faeb77f21f97aaeee0e4c))
* **brain:** belief revision — a negation write supersedes contradicted memories ([50fcd21](https://github.com/eCy-coding/ollamas/commit/50fcd21e803d0eed9e94506cd43315d79487cd7c))
* **brain:** claudecode 4th ask-shared expert + orchestra observability + Obsidian Dalga-2 ([80d975a](https://github.com/eCy-coding/ollamas/commit/80d975a62fa13272bd1c1bfae368ab25b0ae0bea))
* **brain:** coherence audit — semantic-bond measurement with safe quarantine ([a2f51de](https://github.com/eCy-coding/ollamas/commit/a2f51de341a2e767048d87174380863ebd6657e2))
* **brain:** dalga-10 — the brain learns its own codebase ([8750df4](https://github.com/eCy-coding/ollamas/commit/8750df4a73af916dc65987ead13791b2d674aa8d))
* **brain:** dalga-11 — tool catalog, test map and frontend map (live-parsed) ([f7efd11](https://github.com/eCy-coding/ollamas/commit/f7efd116810185cb98ee40c95cd8609a4ef319b4))
* **brain:** dalga-12 — impact analysis, type/dependency catalogs, dead-code audit ([54373f3](https://github.com/eCy-coding/ollamas/commit/54373f39e13ca6ff1cb0e359df174bea7b98afe7))
* **brain:** dalga-5 ecosystem sync — ollamas, eCym and odysseus update together ([84013e6](https://github.com/eCy-coding/ollamas/commit/84013e6c23cf27b7abdd321af7a8891ee6cb1e5c))
* **brain:** dalga-6 — ask multi-ns fan-out root-fix + four active-lane datasets ([5f01c00](https://github.com/eCy-coding/ollamas/commit/5f01c006197586a7f16e0aeb41b64cf2555a2ce9))
* **brain:** dalga-7 — daily-work datasets (prompt-eng, vitest, regex, resmi-TR) ([ffb4998](https://github.com/eCy-coding/ollamas/commit/ffb4998e805cbd14a673f25f587f7964844e7cc0))
* **brain:** dalga-8 — ollamas-e2e critical sets (error dictionary, live API surface, live env flags) ([b3a8459](https://github.com/eCy-coding/ollamas/commit/b3a8459cc1b1abfe1964312158f22d2e2f70eed0))
* **brain:** episodic dup-collapse + live 50-service catalog (dalga-9) ([1b6b5fb](https://github.com/eCy-coding/ollamas/commit/1b6b5fbad9dc0be1fa24abc53d0fa5edf0fee153))
* **brain:** F3c q* kisisellestirme HTTP route'ta canli (formul her yerde) ([6be589a](https://github.com/eCy-coding/ollamas/commit/6be589a889ff2260ab4ca1cf79e3ccc46b8adcde))
* **brain:** F7 GERCEK p_final dirilt (ollamas-only, coverage-durust) ([6ae590f](https://github.com/eCy-coding/ollamas/commit/6ae590f83885fe28a3d38853bbf31511f0ce4310))
* **brain:** fact hygiene — sweep prunes facts invalidated past retention ([fa9752c](https://github.com/eCy-coding/ollamas/commit/fa9752c0f57efc07f5ab14e6f35070d124716186))
* **brain:** fact write-behind — a busy embedder can no longer lose facts ([f1a13bb](https://github.com/eCy-coding/ollamas/commit/f1a13bb95ce0a746d02c98b52609d4028974f75e))
* **brain:** FAZ-12 — 3 systems actively use Obsidian e2e (L22/L23/L24) ([4d5b2f0](https://github.com/eCy-coding/ollamas/commit/4d5b2f01aaf04a695edf575d516a0d785f205f6e))
* **brain:** FAZ-13 — odysseus real Khoj retrieval + world-class Dalga-3 + claudecode liveness ([9dcd61a](https://github.com/eCy-coding/ollamas/commit/9dcd61ade948bb0701ab16a2bb523032f31883ed))
* **brain:** GPU-aware backfill gate — embedding yields to live generations ([c2c0524](https://github.com/eCy-coding/ollamas/commit/c2c05248ee507b5d553a20a3fa1693b1768ed286))
* **brain:** iterative deepening closes the multi-hop gap ([#2](https://github.com/eCy-coding/ollamas/issues/2)) ([3233170](https://github.com/eCy-coding/ollamas/commit/3233170eb89960322a90eeea14e4cd74d702824d))
* **brain:** L14 orchestra transparency + L16 eCym learn-loop + L18 entity-map canvas ([a5b507d](https://github.com/eCy-coding/ollamas/commit/a5b507dfd15e9bb51c22b98a8c600138ddf233a6))
* **brain:** L19 claudecode gate learning (cold→learned) + L21 workspace polish ([24eb369](https://github.com/eCy-coding/ollamas/commit/24eb369d905a6532db57e299f367a192bbb6706c))
* **brain:** loop self-authoring — kalan 80 app kartini loop zenginlestirir ($0) ([c3cf954](https://github.com/eCy-coding/ollamas/commit/c3cf954403747a70e6e19a54bc17d5171f1197bc))
* **brain:** measure every loop turn, add brain-loop-health (F10) ([3a1853c](https://github.com/eCy-coding/ollamas/commit/3a1853c2baaa588b18c8f0efc67e65f006e42a14))
* **brain:** nightly golden-set MRR joins the maintenance pass (S2) ([e2488b4](https://github.com/eCy-coding/ollamas/commit/e2488b4bac81cf97b27466690ef1d899d9d3753a))
* **brain:** Obsidian brain v2 — world-class PKM (aliases, Bases, Home, callouts) ([9a8a88d](https://github.com/eCy-coding/ollamas/commit/9a8a88d390a2bdcdeff19f1d42afeaf388408a4b))
* **brain:** Obsidian mirror prune + tier-move dedup (drift→0) ([acae74f](https://github.com/eCy-coding/ollamas/commit/acae74f07679be1afae995244e71e9b52f650169))
* **brain:** Obsidian ORCHESTRA — ollamas + eCym + odysseus federation ([7788c99](https://github.com/eCy-coding/ollamas/commit/7788c999bd3b4ad687d5871fdbccd4a74b4f341f))
* **brain:** omniscient scope — the brain finally knows the machine it lives on ([823cc52](https://github.com/eCy-coding/ollamas/commit/823cc52736bb5fb26ed0ae6b93de4462abdf5952))
* **brain:** orchestra bidirectional — L9 ask-from-vault, L10 eCym queue, L11 Khoj, L12 kanban ([936e25b](https://github.com/eCy-coding/ollamas/commit/936e25b5b57e686c868a99d1cbbc80cb1e67eb4a))
* **brain:** org ledger dual-write mirror + one-shot migration into 5-tier brain ([c123d98](https://github.com/eCy-coding/ollamas/commit/c123d98274d58bb58a665ad6652347cc0f28f468))
* **brain:** ortak-brain formulas as real code + the infinite loop ([2ea2046](https://github.com/eCy-coding/ollamas/commit/2ea2046254330a1d9a3041b9f7e51416ee2968c2))
* **brain:** port full brain from integrate-wt — B-pattern (precedent 69986e2) ([fe58efa](https://github.com/eCy-coding/ollamas/commit/fe58efa35635468310aa8c62efee63d2f080abbe))
* **brain:** provenance confidence closes [#10](https://github.com/eCy-coding/ollamas/issues/10) and [#12](https://github.com/eCy-coding/ollamas/issues/12) with one mechanism ([ae35a98](https://github.com/eCy-coding/ollamas/commit/ae35a98c600606e1e3074f5f0f82af83c050f86b))
* **brain:** RAG-Sequence context weighting by p_ret (F3a) ([bb4eb44](https://github.com/eCy-coding/ollamas/commit/bb4eb449cf2741215243ba7d8c4efa11a703c381))
* **brain:** ReAtt avg-max scoring and real p_final from logprobs (F4/F3a) ([8aa392d](https://github.com/eCy-coding/ollamas/commit/8aa392def8b4fcefb421416ac0bed9f26ad419a9))
* **brain:** rich Obsidian graph — dense links + color groups + Dataview ([f154e9e](https://github.com/eCy-coding/ollamas/commit/f154e9edf2b01356d0e07c7fe74ab86a3033bf56))
* **brain:** S21 brain-metrics — brain gauges on the existing /metrics scrape ([828dd49](https://github.com/eCy-coding/ollamas/commit/828dd49a30067e058393ac32a22edb914bd7dc1e))
* **brain:** S22 portable export/import — versioned vector-free JSON DR ([028f8c9](https://github.com/eCy-coding/ollamas/commit/028f8c977d2ff1e62a4812c34cc494d5b1d60aba))
* **brain:** S23 re-embed migrator — the drift remediation health only suggested ([ed7c43a](https://github.com/eCy-coding/ollamas/commit/ed7c43af4129b9e589cf9beeeb117b1884481723))
* **brain:** S24 redaction gate — secrets never persist in brain.db ([6bad77b](https://github.com/eCy-coding/ollamas/commit/6bad77be511808dbbb08aaccca9e6171ae32fde4))
* **brain:** S25 consistency sentinel — report-only cross-table invariants ([0fee7dc](https://github.com/eCy-coding/ollamas/commit/0fee7dcf65227cd7a8e6beab284e59c8704104b1))
* **brain:** S26+S46 brain-bus — typed event choke-point + per-source ingest budget ([9a88a69](https://github.com/eCy-coding/ollamas/commit/9a88a69b31f87d206ac122365cd64f8642933319))
* **brain:** S29/S36/S41/S38+S48 durable-source bridges ride the nightly pass ([23e38f6](https://github.com/eCy-coding/ollamas/commit/23e38f6421db1072812533dbc5322b9721037c28))
* **brain:** S30-S45 event-side integration — subscribers, pollers, query surfaces ([dccb9a2](https://github.com/eCy-coding/ollamas/commit/dccb9a2d436739993f18a2a0fc40b48e58ec3f8a))
* **brain:** S47 restore drill — a backup you never restored is a hope ([ed86879](https://github.com/eCy-coding/ollamas/commit/ed868791407f8f7c2677abd8beab1a635390bde5))
* **brain:** S50 e2e-proof — the 50-service contract closes ([9f47054](https://github.com/eCy-coding/ollamas/commit/9f47054728b0db1c5172ef72a10548f464227c93))
* **brain:** sandbox exerciser — three capabilities could never promote (S) ([43480e4](https://github.com/eCy-coding/ollamas/commit/43480e413f3c73df5a6e6651d4222c8edc206147))
* **brain:** sandbox-to-autonomous promotion gate for loop capabilities (F8) ([fdbb31f](https://github.com/eCy-coding/ollamas/commit/fdbb31f9524b578432258d402bc34b196bc3811f))
* **brain:** session-end distill via idle timer (S1) ([6f402c1](https://github.com/eCy-coding/ollamas/commit/6f402c148b9fc0d56ef6a3d86c502355aa73f3ce))
* **brain:** shadow evaluation — sampled counterfactual recall telemetry ([f18464a](https://github.com/eCy-coding/ollamas/commit/f18464ac2301d6c32e5a38f067a9a5461b258dbc))
* **brain:** shared encoder contract brain-encoder/v1 (F0) ([df76942](https://github.com/eCy-coding/ollamas/commit/df76942ca99126605ce32796160187d35e0fc593))
* **brain:** teach — Python + macOS knowledge datasets from the machine itself ([40beefe](https://github.com/eCy-coding/ollamas/commit/40beefe55f9da79c15b829ade633165c5c865346))
* **brain:** teach v2 — six critical-priority datasets (node/ts, git, sqlite, shell, http, launchd) ([c888c4c](https://github.com/eCy-coding/ollamas/commit/c888c4c458ef350a1c06366d9f9897903c3a373a))
* **brain:** teach v3 — dalga-3 critical sets (ollamas-internal, llm-ops, react, security, docker, glossary) ([331d7ef](https://github.com/eCy-coding/ollamas/commit/331d7ef37c0971ee5759d6ce8b8af18e28ca40e4))
* **brain:** teach v4 — foundational starter datasets (dalga-4) ([02cf9ba](https://github.com/eCy-coding/ollamas/commit/02cf9ba449389c7ae4f235e829025969c12dfea7))
* **brain:** vector-driven recall + query embed surface (F3c) ([0591378](https://github.com/eCy-coding/ollamas/commit/059137882bedbcf0953ba9a11c7bb60404f4b6c9))
* **brain:** weekly rollup completes the summarization hierarchy ([#11](https://github.com/eCy-coding/ollamas/issues/11)) ([cad6bc9](https://github.com/eCy-coding/ollamas/commit/cad6bc9e36395b2e52778cb6c5028472ea06e261))
* **brain:** write-behind embedding — a contended embedder no longer loses writes ([58233cb](https://github.com/eCy-coding/ollamas/commit/58233cb4d9b239670e1cdb3cb3928d72f04dc20e))
* **cache:** semantic-cache near-miss telemetry (evidence for threshold tuning) ([1ea908e](https://github.com/eCy-coding/ollamas/commit/1ea908e48230c188949aeca31cf1d129af40454b))
* **chat:** certainty engine — definitive source-verified answers, no hedging ([1f64024](https://github.com/eCy-coding/ollamas/commit/1f6402449af66f0cd8699d59b1367714bc831927))
* **cookbook:** hardware-aware recipe runner backend + routes ([2f4a650](https://github.com/eCy-coding/ollamas/commit/2f4a65065e7ac00ea40d9c7b006f1b788153315a))
* **cookbook:** Recipe Library panel + tab wiring ([274a072](https://github.com/eCy-coding/ollamas/commit/274a072b87d7928101e575f84ef31a35f7c43b75))
* **disk:** read-only survey with hash-verified duplicate detection (F9-lite) ([ae6dfca](https://github.com/eCy-coding/ollamas/commit/ae6dfca5b5c9b242ca413727e4ee22fa9b498beb))
* **documents:** Documents panel over the workspace file APIs ([7ea59fd](https://github.com/eCy-coding/ollamas/commit/7ea59fd50ad350b05d6bf2f59d4232256438efb1))
* **e2e:** give the vault mirror a consumer and stop the watchdog restarting mid-boot ([e9cfe3d](https://github.com/eCy-coding/ollamas/commit/e9cfe3d389480735c41effcf95c7770bb3a7bed6))
* **e2e:** make the machine's memory the gate can see, not the thing it hides ([262293b](https://github.com/eCy-coding/ollamas/commit/262293b85af8fb2aae97e43267ca6ea77d5e1cb8))
* **ecym:** control plane + 5 panel specialist drawers (v12) ([0f9c0a6](https://github.com/eCy-coding/ollamas/commit/0f9c0a6471405f53a4a202c39344462255681663))
* **ecym:** hybrid bake — real ecy-&lt;panel&gt;:latest specialist tags on demand ([8be5d2a](https://github.com/eCy-coding/ollamas/commit/8be5d2a59c658ede6a9b520cd000dcfe84310fea))
* **ecym:** opt-in boot auto-distill of panel briefs (v13-D) ([8e9b72e](https://github.com/eCy-coding/ollamas/commit/8e9b72e5dbc1b7e099e1d3f13427f501badca25f))
* **keys:** autonomous gemini pool healer + launchd job ([7ab158d](https://github.com/eCy-coding/ollamas/commit/7ab158daccdef9af373a4b21ba0ad8811259d70d))
* **keys:** drop-triggered key rescan + buddy-status (v15 layers 2 & 4a) ([c54bdb6](https://github.com/eCy-coding/ollamas/commit/c54bdb67fd2a5309d4e36440b8d59da2d034b96f))
* **keys:** opt-in key minting from already-authed tooling (v15 layer 3) ([dc6ec7d](https://github.com/eCy-coding/ollamas/commit/dc6ec7d35d728890c94c7802a9d4bfa0ec30ab0a))
* **obsidian:** /obsidian panel over status+sync (dark-theme, live drift/conflict badges, loopback sync buttons) ([a72edc2](https://github.com/eCy-coding/ollamas/commit/a72edc23b238f225d1c25a1296db00faa63f3195))
* **obsidian:** give ollamas and eCym the vault surfaces they were missing ([9bc1e06](https://github.com/eCy-coding/ollamas/commit/9bc1e06bb5010a568dcb784f1e60c6a88635c673))
* **obsidian:** L25 plugin runtime — 11 pinned, checksum-locked community plugins ([f78a613](https://github.com/eCy-coding/ollamas/commit/f78a6132a944fe4b86f33c84aecc731d39c9d0de))
* **obsidian:** L26 live vault surface — all 4 experts can read the vault ([ed33a9d](https://github.com/eCy-coding/ollamas/commit/ed33a9d93787192b32361334f6b6010d12451b1c))
* **obsidian:** L27 human capture — inbox + root notes reach the brain ([00ce37e](https://github.com/eCy-coding/ollamas/commit/00ce37e83489dc2a1aede945a3e91125fd21aaa4))
* **obsidian:** L28 voice memos become memories + stop littering the vault root ([cd7ecbc](https://github.com/eCy-coding/ollamas/commit/cd7ecbcc0b15c3ff1ac96e3d36f5f6e96e9c68f5))
* **obsidian:** L29 recall queue — ask the brain from inside the vault ([07ec0b4](https://github.com/eCy-coding/ollamas/commit/07ec0b470e0d852f60de121f6f10763446329efb))
* **obsidian:** L32.1 zero-touch plugin trust — record the owner's consent ([25a480d](https://github.com/eCy-coding/ollamas/commit/25a480df063d8123544d880a974a26c81a2b78e2))
* **obsidian:** mandatory soft vault gate before every operation ([5a37eda](https://github.com/eCy-coding/ollamas/commit/5a37eda5ae05876b19d2bb2c960cdb5287ce6c72))
* **obsidian:** operations note, saved review workspace, and property types ([0deae17](https://github.com/eCy-coding/ollamas/commit/0deae17f24728ff5ad5d201a2158d9f9c5a2118d))
* **odyssey:** chat panel visual upgrade — ODYSSEY skin on ReactAgentTab [chat.visual] ([6ba779c](https://github.com/eCy-coding/ollamas/commit/6ba779cb92cdd33bed83065e0e5dff4bd9415350))
* **odyssey:** O0 foundation — module registry, /api/modules guard, per-collection vector store, migration reservation ([98e0049](https://github.com/eCy-coding/ollamas/commit/98e00492ea16fadcdb6042b12b2ef734879489b7))
* **odyssey:** O2 research (deep_research+SearXNG+MCP tool) + O5 notes-tasks modules ([71e4b03](https://github.com/eCy-coding/ollamas/commit/71e4b0394184b75f52be86296a83c68c35f2e55d))
* **odyssey:** O3 documents (PDF/office/md + viewer) + O6 calendar (CalDAV/ICS + RRULE) modules ([215e624](https://github.com/eCy-coding/ollamas/commit/215e6242a727d691cdb04629e5aa56f26f10cb81))
* **odyssey:** O4 email (IMAP/SMTP triage + AI) + O8 settings (2FA/RBAC/tool-policy) modules ([88903d3](https://github.com/eCy-coding/ollamas/commit/88903d3b9147086f6a9eb1ad9b013f54a5ecb83a))
* **odyssey:** O7 cookbook module — hardware-aware model recommendations panel [PILOT] ([19a6c8e](https://github.com/eCy-coding/ollamas/commit/19a6c8ea13e3b5c3e9cab2ef6ec34c3da041aa57))
* **odyssey:** shell/nav visual upgrade — grouped nav + eCy-cyan accent [shell.visual] ([b9e7d5a](https://github.com/eCy-coding/ollamas/commit/b9e7d5abf7558d397ecaebeba4bcadb943c2a085))
* **ops:** MCP process inventory + debounce chat writes — batch 3 (v16) ([24dac92](https://github.com/eCy-coding/ollamas/commit/24dac92c72c97833b564ced77ce876d78fbdd9a6))
* **ops:** monitor host terminal-bridge in doctor ([51e1615](https://github.com/eCy-coding/ollamas/commit/51e161522e68b18fe0efc7ae9c3ff70cea7d8435))
* **ops:** unified e2e health gate + churn-safe self-heal watchdog (9-leg green/red, 3-red debounce, hub never auto-kicked) ([251f12b](https://github.com/eCy-coding/ollamas/commit/251f12bd2e875dcc0e263b29bed7a244152c18e8))
* **orchestra:** L35 eCym stays reachable under GPU contention ([3ad3bfa](https://github.com/eCy-coding/ollamas/commit/3ad3bfa63c714c14c99717922f137b3544ccab08))
* **orchestra:** L36 distinct roles — brain, machine, vault ([8233682](https://github.com/eCy-coding/ollamas/commit/8233682b9468e3030e2e80c0ab341e53900a8191))
* **orchestra:** L37 the sprint board actually runs — real tasks, real evidence ([07ed813](https://github.com/eCy-coding/ollamas/commit/07ed8136887d44b7b315f0718e361dc0895e2966))
* **orchestra:** L38 one gate that proves the claims + read-only diagnostics ([e8be9ca](https://github.com/eCy-coding/ollamas/commit/e8be9ca8f10c72ef25307a5c5e589b7cc8dd0e4e))
* **orchestra:** L39+L40 tasks answer the question, and the answer becomes memory ([0ec45f0](https://github.com/eCy-coding/ollamas/commit/0ec45f05c7bcc8b0e8901a3dcf6eea913cee575c))
* **orchestra:** L41 obsidian finally writes, and stops searching with the sentence ([7d3dab3](https://github.com/eCy-coding/ollamas/commit/7d3dab356f099449b1ee0c97fa05e52f63ee117c))
* **orchestra:** L42 bounded step chaining — catalog-only follow-up, 2 rounds max ([7112b98](https://github.com/eCy-coding/ollamas/commit/7112b98b3937966a4bdf6ab4f1f56595938444fc))
* **orchestra:** L43 task outcome ledger + e2e coverage for answer/learn/report ([449bc99](https://github.com/eCy-coding/ollamas/commit/449bc99d2cdab815043500c0dcf9f44eff8d405f))
* **orchestra:** L44 chain triggers end-to-end — one shell exception for `| head -n N` ([c363423](https://github.com/eCy-coding/ollamas/commit/c3634233d14b6b841992866681aa9772b2ae6ee4))
* **orchestra:** L45 grounding guardrail — use the evidence or say you didn't ([5769c08](https://github.com/eCy-coding/ollamas/commit/5769c08075bced8c40cee7efaf93a51eb214b121))
* **orchestra:** L46 scenario matrix — resilience is measured, and it found two bugs ([a86a015](https://github.com/eCy-coding/ollamas/commit/a86a015db5d4b38d94237cc6e3a6663df2ccdad7))
* **orchestra:** L47 task lifecycle — stale-freeze + live orchestra panel ([e4f2ad7](https://github.com/eCy-coding/ollamas/commit/e4f2ad7a48ac6c867e4cea83ce68d442ca3dfe06))
* **orchestra:** L48 e2e coverage for grounding + panel, docs, honest surfacing ([c44a13b](https://github.com/eCy-coding/ollamas/commit/c44a13bbabbf8ba150ee222ae22abe68bc5eb2ce))
* **orchestra:** L53 bounded-parallel task batches — concurrency is measured ([f76c44d](https://github.com/eCy-coding/ollamas/commit/f76c44d8c935b36adb748d96d11e84e21bf4891a))
* **orchestra:** L54 deterministic synthesis fallback — the answer was in the output ([3e5b24d](https://github.com/eCy-coding/ollamas/commit/3e5b24daf5a743a38af9d8a38298aba8e7cb6a61))
* **orchestration:** 25 critical µ-services under one uniform contract ([f8513c0](https://github.com/eCy-coding/ollamas/commit/f8513c01dc802c27b6e6e44a3de272cc8f261285))
* **orchestration:** Definitive Answer Doctrine — grounded, assumption-free answering ([7576292](https://github.com/eCy-coding/ollamas/commit/7576292c0cb744b82ac9c9be7aee299433cba486))
* **orchestration:** expand to 50 critical µ-services (complete surface coverage) ([e147cb6](https://github.com/eCy-coding/ollamas/commit/e147cb68e4c47bef10837ca1a3daf7ca79fe2032))
* **orchestration:** live task tracker — Claude-Code-style progress UX ([fdf2db6](https://github.com/eCy-coding/ollamas/commit/fdf2db6e10794a72ed8c415d8ddb69b8c1f9253d))
* **orchestration:** ORG layer v2 — academic grounding + sustained sandbox ([bceedc4](https://github.com/eCy-coding/ollamas/commit/bceedc4fc364726ca555fe0d3bba61da36751956))
* **orchestration:** ORG v3 — learned authority (ML-built responsibilities) ([13f2a2f](https://github.com/eCy-coding/ollamas/commit/13f2a2fbd89372b522b009f8f1a4a67e66650f4f))
* **orchestration:** research-until-verified — facts never stop at 'unknown' ([443da79](https://github.com/eCy-coding/ollamas/commit/443da79630c80142166989a82119af8c06f6212d))
* **orchestration:** self-improving answer loop — learned channel ranking + accuracy bench ([4d7a036](https://github.com/eCy-coding/ollamas/commit/4d7a036bec16229eb53c9502f3328b027a6ddb32))
* **orchestration:** unified management/organization layer (ORG) ([a7cfe95](https://github.com/eCy-coding/ollamas/commit/a7cfe952fba9bf855df56b6a03acf2f9a58ff581))
* **policy:** operator-governed agent permissions for macOS app actions ([8f66a80](https://github.com/eCy-coding/ollamas/commit/8f66a80168cb5048016d84a871209fa7065110b0))
* **policy:** permission-test harness — prove what the granted permissions do ([cda1a68](https://github.com/eCy-coding/ollamas/commit/cda1a68afc04da13ff7aa170d2fc011cee84987b))
* **policy:** propagate policy changes to eCym command safety ([8c299e6](https://github.com/eCy-coding/ollamas/commit/8c299e68c30b7d279de882c2d5dadfb457e0630c))
* **providers:** add Perplexity to the catalog + v1 fallback tier ([d68095b](https://github.com/eCy-coding/ollamas/commit/d68095b2aefafb30443921edc0ea2c09180aad9f))
* **providers:** buddy system — proactive health-aware failover ordering (v15 layer 1) ([fd54b5e](https://github.com/eCy-coding/ollamas/commit/fd54b5ee41f7db6f497e8fc2644974626da2edbf))
* **research:** Deep Research panel + tab wiring ([818a7fc](https://github.com/eCy-coding/ollamas/commit/818a7fc77f61117c741bc3a8370995f0ccf05d86))
* **research:** deep-research backend — plan/search/summarize/synthesize (SSE) ([4d7e3be](https://github.com/eCy-coding/ollamas/commit/4d7e3be6848b385f70b2c3ab6fe6d54c4b9d080f))
* **security:** audit eCym's risky() blindness to GUI automation ([2793573](https://github.com/eCy-coding/ollamas/commit/2793573e056351a23c17b65593462985bbfd8ce5))
* **server:** ORG management-layer status surface — /api/org/overview + /org panel ([342e403](https://github.com/eCy-coding/ollamas/commit/342e40310c5beaa7415f491102719235b24c1fe8))
* **terminal:** add ollamas doctor/top/ecysearcher to sandbox CLI ([28602fa](https://github.com/eCy-coding/ollamas/commit/28602fa9efecbc351ed2bdff627ca32432fff047))
* **threatfeed:** operator-added custom feeds (v12 connection [#9](https://github.com/eCy-coding/ollamas/issues/9)) ([4549ba6](https://github.com/eCy-coding/ollamas/commit/4549ba61719b0be0c72dda54d893f1b193ac42f0))
* **v10:** Chat (eCy) + eCy Studio — odysseus-core service + model distillation ([796fcab](https://github.com/eCy-coding/ollamas/commit/796fcab62c521d257b0109f2629c3162b4bdc9c9))
* **vault:** buddy-system banner in the Hardware Vault (v15 layer 4) ([172a480](https://github.com/eCy-coding/ollamas/commit/172a4800602f65dc69861ce7295b1b3fed51fa1b))


### Bug Fixes

* **backend:** jobs claim loop skips unregistered handlers — boot ordering race (C2r) ([8dfee04](https://github.com/eCy-coding/ollamas/commit/8dfee045fa56afa0c0c7bb1f5c5bfb64a20fca85))
* **brain:** altyapi hatasi yetenegi karantinaya almasin (yanlis-karantina fix) ([e058764](https://github.com/eCy-coding/ollamas/commit/e05876462b59dc8d56eb611d5943728bb080c30e))
* **brain:** ask fan-out dedupes by id and leads with knowledge namespaces ([ef1a9c5](https://github.com/eCy-coding/ollamas/commit/ef1a9c5e80e4f1f7fa8a025bc24f205c79b882d8))
* **brain:** ask route no longer clobbers the fan-out's namespace choice ([80de5f4](https://github.com/eCy-coding/ollamas/commit/80de5f4797a85c192c4335fc5971e950b0f638e2))
* **brain:** brain-loop's GPU-busy check was structurally inert (G7) ([5c79a86](https://github.com/eCy-coding/ollamas/commit/5c79a867b0d9c7cbb467544a74f521584e8a3bfa))
* **brain:** build p_u from prior questions, not the current one (F3c) ([41a9d93](https://github.com/eCy-coding/ollamas/commit/41a9d932250f3aeccd4c92a7d25c022272cc8842))
* **brain:** candidate→autonomous canlı-gölge + egzersizi yazma-bütçesinden ayır ([00004f1](https://github.com/eCy-coding/ollamas/commit/00004f1c9883cd9f9fbb90699eeea7dfbe20148e))
* **brain:** drift probe must recall in the probed memory's own namespace ([ba55077](https://github.com/eCy-coding/ollamas/commit/ba55077a6460ef240c8831e6be2c21eed669d427))
* **brain:** FTS query drops TR/EN question filler — keywords keep their rank ([c995955](https://github.com/eCy-coding/ollamas/commit/c995955639bf3909ffbebf05c8e56868566402ef))
* **brain:** gate-ce-train candidate→autonomous kopru + tsconfig artifacts exclude ([a8093bf](https://github.com/eCy-coding/ollamas/commit/a8093bfcf39b851a78e2a12342a77b231e30f53d))
* **brain:** graph/data hygiene — the entity map shows entities, not commit titles ([84e818c](https://github.com/eCy-coding/ollamas/commit/84e818ce0ab79560e5a88ac3fc72be15470bbe14))
* **brain:** honest embedding-drift probe (cosine space-match) ([f0e83af](https://github.com/eCy-coding/ollamas/commit/f0e83af810b54f0fa0ac570cfd3ece9d52e79ca0))
* **brain:** live system truth outranks a balking synthesizer ([25e6708](https://github.com/eCy-coding/ollamas/commit/25e67086946b2592e4a59fb77994203895a45ad2))
* **brain:** loop target pool can no longer exhaust (F1) ([6f57285](https://github.com/eCy-coding/ollamas/commit/6f57285a677a72b4033b726e423dfba193548d61))
* **brain:** loop treats 503/busy as a transient skip, not an error ([6884a1d](https://github.com/eCy-coding/ollamas/commit/6884a1d6e5329fa78e158782871983489ec15f3d))
* **brain:** loop-health dry-streak warning now names the real cause ([b4ff55b](https://github.com/eCy-coding/ollamas/commit/b4ff55b914deb94edea4af1a8acd062c822452de))
* **brain:** overview degrades health under embedder load instead of dying ([099937c](https://github.com/eCy-coding/ollamas/commit/099937cee49736a754027d9a6911ea97187ceb4a))
* **brain:** ragseq metrik dururlugu — kume-disi atif sahte retention=0 uretmesin ([c33dbaf](https://github.com/eCy-coding/ollamas/commit/c33dbaf90da7cbbf2a514c76933d5f65a90df062))
* **brain:** recall API degrades fast under embedder load (bounded 503) ([d8775e2](https://github.com/eCy-coding/ollamas/commit/d8775e2c886e1fa37e2dec68dfc3a3ebaeacbe65))
* **brain:** recall API honors the degrade contract on fast embedder failures ([a576483](https://github.com/eCy-coding/ollamas/commit/a576483c939860c7a28dbcc6d46b55f58d3393c5))
* **brain:** revive the dead gate and personalization paths (F3b/F3c) ([5ae90cd](https://github.com/eCy-coding/ollamas/commit/5ae90cd3b00e5d4dba61656a65754626fac49103))
* **brain:** safe regresyonu kök-fix — loadPolicyStrict, okunamadı ≠ kısıtlı ([b160593](https://github.com/eCy-coding/ollamas/commit/b160593120a273a4df66ea263488a8e1e56a7340))
* **brain:** stop the gate from training on its own output (F3b) ([938073d](https://github.com/eCy-coding/ollamas/commit/938073d9e6ba825cd8562c588467c158ebd63825))
* **brain:** store raw vectors — normalizing halved retrieval quality (F2) ([0bb0c64](https://github.com/eCy-coding/ollamas/commit/0bb0c6433c7bdb5e33011ef111827cbde877afdf))
* **chat:** surface fallback provenance — no silent model substitution (v20) ([876de09](https://github.com/eCy-coding/ollamas/commit/876de09c4d22ee54ef2d989bd5f75dd66ef09d2a))
* **ecym:** assist drawer 90s watchdog — honest fail instead of infinite queue ([895ee99](https://github.com/eCy-coding/ollamas/commit/895ee999a7093550eab3e228e9676289bb6bdda2))
* **ecym:** distill preserves Emre's existing eCy persona verbatim ([4b12e5d](https://github.com/eCy-coding/ollamas/commit/4b12e5d5f535c699f05546711a32a9b619150c64))
* **keys:** per-provider remedy hints in the autoheal alert path ([ca24015](https://github.com/eCy-coding/ollamas/commit/ca24015d4810913098aa75ae97dce641d36a9335))
* **monitor:** point health/metrics checks at :3000/api ([004e9f8](https://github.com/eCy-coding/ollamas/commit/004e9f88751bcf1f6d7e52a17f43b41d9d63898a))
* **obsidian:** L25 surface Restricted Mode — plugins installed but inert ([fbc700d](https://github.com/eCy-coding/ollamas/commit/fbc700dd558598541d0daf6e31e158a50e3122f3))
* **obsidian:** the eCym catalog pruner was deleting everything else in the folder ([1172c81](https://github.com/eCy-coding/ollamas/commit/1172c81e838d87396ea5ba67fe83bf6f95ca92b0))
* **odyssey:** register documents in module barrel — Dalga3 clobber dropped the import ([655897d](https://github.com/eCy-coding/ollamas/commit/655897de889b2ebcdf2001da9e5629ce2ffe5896))
* **orchestra:** L33+L34 a failed seat is not an opinion; measured quality can win ([1ceb760](https://github.com/eCy-coding/ollamas/commit/1ceb76064a209190bfd70f1f852614f91a3ad3d5))
* **orchestra:** L44 the chain actually triggers — judge, then select ([b9d0d56](https://github.com/eCy-coding/ollamas/commit/b9d0d56b090ef1d35bc70425e21c95dd321e875e))
* **orchestra:** L49-L51 grounding guardrail was flagging correct answers weak ([a1a6a92](https://github.com/eCy-coding/ollamas/commit/a1a6a9200c34b3012629049e2d314a83b01ae0e7))
* **orchestration:** org-sandbox plist — exec node directly (E-launchd-01) ([17ee3cb](https://github.com/eCy-coding/ollamas/commit/17ee3cb512b9b0558c6671f9fbd4ced5830855a6))
* **orchestration:** tracker run-isolation + orchestration-rank test (live e2e run) ([a79d511](https://github.com/eCy-coding/ollamas/commit/a79d511eae35c3ffcdaa10f05d38787c96811800))
* **package:** rename duplicate "doctor" key to doctor:host-bridge (invalid-JSON dedupe) ([19e4dd5](https://github.com/eCy-coding/ollamas/commit/19e4dd5118fc3c00a81ea82613c5bbf2045ded72))
* **perf:** honest inference timeouts + non-blocking boot + clean shutdown — batch 2 (v16 A2/A4/B3/B5) ([d38b313](https://github.com/eCy-coding/ollamas/commit/d38b31328d1731f04e664fd8bc153fde76c82d0d))
* **perf:** unblock the measured stall chain — batch 1 (v16 A1/A3/B1/B2/B6) ([1aae4b7](https://github.com/eCy-coding/ollamas/commit/1aae4b79b10db993aed24ed7c495705c8c16fd72))
* **providers:** port pollinations host fix + catalog corrections from integrate-wt (C1) ([1413b73](https://github.com/eCy-coding/ollamas/commit/1413b73e4a36262baad5ad89619399096f4df86b))
* **scripts:** odysseus bridge agent-session rotation — stale-session simulated-exec trap (AGENT_SESSION_MAX_USES=6) ([0333a47](https://github.com/eCy-coding/ollamas/commit/0333a479ea00a4945be8696bd3354b2845a568b6))
* **security:** clear all 18 npm audit vulns (6 high → 0) ([19770c4](https://github.com/eCy-coding/ollamas/commit/19770c4e2e8632c851f825d16d8041fd755b4e7c))
* **sync:** ecosystem-sync reconciles app-command safety, not just appends ([9e26188](https://github.com/eCy-coding/ollamas/commit/9e2618873419b31841c1445072b144509619e6db))
* **tests:** stop the suite from revoking live Obsidian REST access ([c32dc46](https://github.com/eCy-coding/ollamas/commit/c32dc468e3e4363f8c3b5c7b35d04073cd4db254))
* **ui:** ReAct stall-watchdog + immediate done-reset — un-stick the 'running' button ([6149a33](https://github.com/eCy-coding/ollamas/commit/6149a33005245dffb88a94f55988c8258d2e66bd))
* **ui:** register the agent-policy tab label in both locale catalogs ([f6fb4b6](https://github.com/eCy-coding/ollamas/commit/f6fb4b67a130f938602789d7eb6739449a295c9b))
* **ui:** render the agent-policy panel from a static tab block ([48155d8](https://github.com/eCy-coding/ollamas/commit/48155d8c22f20350f84cac2870e607d4f091a2f1))
* **ux:** Actions assist drawer is discoverable in the panel header (v19) ([d9cc793](https://github.com/eCy-coding/ollamas/commit/d9cc79392915b2f791ac25771ffbea2a9fad4f1d))
* **ux:** eCy nav group + demo label key + e2e coverage for chat/ecym/module tabs (v18 K2-K4) ([f4079c3](https://github.com/eCy-coding/ollamas/commit/f4079c351bed412902656c372986646481141c9a))
* **ux:** streams survive panel switches — module-level stream store (v19) ([4d49efc](https://github.com/eCy-coding/ollamas/commit/4d49efc2eb192fea836a2541c9d9193a099ea607))
* **vault:** real GitHub (repo) connect in the Hardware Vault (v14) ([5baeca9](https://github.com/eCy-coding/ollamas/commit/5baeca9c910d77e0513e6e9e656246f82b7aea73))


### Performance Improvements

* **ecym:** adaptive warm-model — instant specialist answers, no GPU swap (v13) ([81feb47](https://github.com/eCy-coding/ollamas/commit/81feb47851196b25e5a89a6bc2d9a3e57a824c1b))
* **server:** non-blocking background MCP connect (no boot delay on npx cold-start) + ReAct hang-guard timeout (abort stalled run → client unstucks) + providers headless reorder + tools.json odysseus upstream ([90defc7](https://github.com/eCy-coding/ollamas/commit/90defc749c8769d8b37662843ce9b6b59b33a969))

## [Unreleased]

Work on branch `feat/v-final-train` since v1.23.0. It has two layers: the
integrated lane work (tunnel, contract/federation, providers, orchestration,
security) and the v-final release train (V1–V8 below, staged as
v1.24.0–v1.31.0; not yet tagged individually — a single GA tag, v1.33.0,
lands at general availability).

### Added (integrated lane work since v1.23.0)

- Cloudflare tunnel transport (quick + named tunnels), streaming reverse-proxy
  gateway with auth, rate limiting and access logs, and one-command zero-touch
  setup with launchd daemons (vT12–vT15).
- Contract/federation layer: multi-machine pool ledger, heartbeats, RPC shard
  orchestration, scheduler federation, one-click device onboarding with a
  signed CLI bundle (vK1–vK19).
- Free-provider harness: catalog of free-tier cloud providers (Groq, Mistral,
  Cerebras, Scaleway, Pollinations, Cloudflare Workers AI, ...),
  `provider::model` routing, API key pool with auto-rotation, key-doctor
  (validate/connect/keychain scan), guided `keys onboard`, quota-aware
  scheduling and persistent cooldowns.
- Hardware vault: Secure-Enclave-backed master key with keychain write-back,
  always-running key-health loop and `/api/keys/health` convergence signal.
- $0 local conductor: autonomous orchestra loop with council quorum voting,
  task catalog, fleet worker dispatch (Terminal.app/iTerm2 tabs), gated
  SEARCH/REPLACE apply path and Constitutional-Alignment harness (vO31–vO65).
- Telemetry cockpit: per-request telemetry core with SSE feed, model-ops
  panels, GitHub Actions panel, first-party GitHub search, threat-intel feed,
  Google Calendar/Gmail read-only tabs, Siri search assistant, key-health
  panel.
- OpenAPI documentation for ~26 public routes; Brewfile + deps-doctor;
  Fable-5 orchestra-conductor skill with slash commands.

### Fixed (integrated lane work since v1.23.0)

- Security: SSRF guard and command allowlist for tenant-supplied MCP
  upstreams (RCE fix), zero-leak redaction of agent tool-call args,
  shell-string `execSync` migrated to argv `execFileSync`, blocking security
  CI gate (gitleaks + semgrep + trivy), explicit GCM authTagLength.
- Reliability: atomic config/master-key writes, fail-closed master key on
  restart, streaming abort fail-safe, atomic-write race fix, orchestra
  conductor thrash root-fixes, deterministic (de-flaked) provider tests.

### Changed (integrated lane work since v1.23.0)

- `@ts-check` migration across host-bridge, scripts and hooks (98-file
  manifest, batches 1–8); IO-free pure cores extracted for catalog tools;
  DoD/coverage gates (v8 coverage `lines:70`, perf-smoke p95 CI budget).

### v-final release train (V1–V8, staged as v1.24.0–v1.31.0, tagged at GA)

#### V1 — honest identity (staged v1.24.0)

- Added: real README, `setup.sh` wrapper, `CONTRIBUTING.md` + Code of
  Conduct; package version bumped to 1.24.0 [M-026, M-027, M-021, M-028].
- Changed: canonical pointer to the 16-VERSIYON roadmap [M-025].

#### V2 — bring-your-own-model (staged v1.25.0)

- Added: usable BYO-model flow — custom-OpenAI endpoint with catalog dropdown
  and server model list [M-031], first-run onboarding [M-037], model guide
  [M-033].

#### V3 — developer docs (staged v1.26.0)

- Added: developer-extensibility docs — adding-a-tool, extension guide,
  HOWTO-ADD-SKILL, CLI guide, API quickstart, troubleshooting
  [M-029, M-030, M-034, M-035, M-040, M-032].

#### V4 — security tests (staged v1.27.0)

- Added: security regression coverage for localOwnerGuard, commander, store,
  providers and threatfeed ReDoS; Colab urllib guard; docker-compose
  `read_only` [M-001..M-011].

#### V5 — test integrity (staged v1.28.0)

- Added: boot harness making pipeline + adminGuard testable [M-050, M-004,
  M-006]; migration uniqueness + rollback tests [M-012, M-045].
- Fixed: M-037 ai.test regression; fresh suite 1518 passing [M-014].

#### V6 — billing, i18n, GDPR, performance (staged v1.29.0)

- Added: billing e2e chain [M-017], i18n parity with RTL/Intl [M-019, M-048],
  GDPR erasure/export [M-047]; Lighthouse run at performance 0.96 [M-018].

#### V7 — per-model overrides + GGUF guide (staged v1.30.0)

- Added: per-model `num_ctx` / `temperature` / `keep_alive` / system-prompt
  overrides (UI + API) [M-038]; GGUF/Modelfile import guide [M-039].
- Fixed: `/api/model-overrides` gated behind localOwnerGuard [M-038].

#### V8 — deployment robustness (staged v1.31.0)

- Added: cloud master-key fail-closed [M-020], unified deploy guide
  [M-036, M-046], install/rollback drills and doc fixes
  [M-023, M-024, M-022].

## [1.23.0] - 2026-06-25

### Added

- Measured model combination wired into the live ReAct agent
  (`/api/agent/chat`) with correctness-max policy.
- Binary upload/download across HTTP routes, agent tools, MCP and UI.
- Instant-on onboarding layer: ready gate, slash commands, quickstart.
- API key pool with auto-rotation on quota/auth errors (user keys only).
- Deterministic system-invariant monitor with self-improving `--heartbeat`
  loop and launchd job; 3-tier fleet agent hierarchy and calibrated
  sub-agent dispatcher.
- Autonomous headless content pipeline, Substack toolkit and Firecrawl REST
  wrapper.

### Fixed

- Multi-step tool ReAct on strict cloud providers (Anthropic/OpenAI) and
  cross-provider tool-call robustness (repair + validator feedback).
- Demo-fallback honesty: no fabricated output ever reaches the live agent.
- Bridge realpath write-confinement (symlinks cannot escape
  `BRIDGE_WRITE_ROOTS`); heartbeat reads the real claim ledger; empty
  suppress `kindPattern` rejected (was suppressing all findings).
- `grep_search` via no-shell argv; MCP `resources/list` tree flattening;
  localhost Ollama fallback in `listModels`; orchestration lock acquisition
  and champion-gate ranking.

### Changed

- Project-wide non-working-function audit ledger and harness scripts
  (Faz 11–13).

## [1.22.1] - 2026-06-21

### Fixed

- Security: terminal exec hardened to `execFile` and confined filesystem
  paths annotated (Semgrep P0).

## [1.22.0] - 2026-06-21

### Fixed

- Agent tool-path unbroken across all providers (real coding, no demo).
- `.env` loaded via dotenv at boot so provider keys resolve in local dev.
- Per-instance Vite HMR websocket port (PORT+20000) — no more 24678
  collisions across dev/test servers.

### Changed

- Dependency override `tmp@^0.2.7`, fixing a high-severity symlink /
  path-traversal advisory in the dev-only `@lhci/cli` chain.

## [1.21.0] - 2026-06-21

First tagged release: the all-lanes integration merge (tunnel, orchestration,
Colab, deploy hardening, scripts, frontend, CLI, ingest).

### Added

- Choke-point tools: `bench_model` (llama-bench tok/s), `mac_power`
  (powermetrics telemetry), `eval_prompt` (promptfoo verify),
  `count_tokens` (js-tiktoken).
- MCP consume fan-out to multiple upstream clusters and MCP v1.20 resource
  subscriptions (`resources/subscribe` + update notifications).
- Colab local-runtime (Docker-first, auto-port) with a zero-manual headless
  dev-loop and hybrid bug triage (local first-pass + egress-gated Gemini).
- Canonical `artifacts/` binary-folder build architecture.

### Fixed

- Security: SaaS fail-closed gate for the dashboard surface, credential-vault
  `/api/keys` + `/api/models` gating in SaaS mode, command-injection via
  `execFile`, tool-call `JSON.parse` guard, CI ref-name injection.
- Billing: crypto-random Stripe meter idempotency key (was `Math.random`).
- Workspace file API input validation; agent `messages[]` validation;
  host-bridge `import.meta.url` guard so the bundled `dist/server.cjs` boots.

[Unreleased]: https://github.com/eCy-coding/ollamas/compare/v1.23.0...HEAD
[1.23.0]: https://github.com/eCy-coding/ollamas/compare/v1.22.1...v1.23.0
[1.22.1]: https://github.com/eCy-coding/ollamas/compare/v1.22.0...v1.22.1
[1.22.0]: https://github.com/eCy-coding/ollamas/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/eCy-coding/ollamas/releases/tag/v1.21.0

<!--
Release notes template (copy for each new release):

## [X.Y.Z] - YYYY-MM-DD

### Added
- New features.

### Fixed
- Bug fixes.

### Changed
- Changes in existing functionality (refactor/chore/docs).
-->
