# Backend OSS-Adoption Scoreboard (2026-07-16)

Rubric: fit 30 + integration 25 + maintenance 20 + $0/local 15 + security 10. License = hard gate (MIT/Apache-2/BSD only). ADOPT ≥70 · TRIAL 50-69 · REJECT <50.

## Internal reuse (Wave 0 — no scoring, no new deps)
| Source | Gap | Decision |
|---|---|---|
| ollamas-integrate-wt `server/brain.ts` (390 lines, branch feat/complementary-integrations) | G4 brain backend | PORT (B3) |
| ollamas-integrate-wt promptfoo harness (`eval/promptfooconfig.yaml`, `scripts/gen-promptfoo-providers.mjs`, Makefile `eval-providers`) | G3 eval harness | PORT (B6) |

## External candidates
| Candidate | Gap | Score | Decision | Rationale |
|---|---|---|---|---|
| OTel stack: open-telemetry/opentelemetry-js + js-contrib + traceloop/openllmetry-js (Apache-2.0, 2026-07/06) | G2 | 90 | ADOPT (B2) | ESM/TS native, no server required, openllmetry closes LLM-span gap |
| Hexagon/croner (MIT, 2026-07) + in-house sqlite job table on db-adapter | G1 | 90 | ADOPT (B1) | Zero native deps; only true sqlite queue rival (plainjob) is 96★ v0.0.x |
| justjake/quickjs-emscripten (MIT, 2026-03) | sandbox exec (new) | 89 | ADOPT (B4) | Pure WASM, single dep, first sandboxed-exec capability |
| huggingface/transformers.js (Apache-2.0, 2026-07) + jparkerweb/semantic-chunking (MIT, 2026-05) | G5 | 88 | ADOPT (B5) | Keep sqlite-vec store; add local BGE rerank + semantic chunk boundaries |
| BoundaryML/baml (Apache-2.0) | structured output | 76 | TRIAL wave-2 | Valuable but compiler toolchain heavy |
| jaegertracing/jaeger (Apache-2.0) | G2 viewer | 76 | OPTIONAL | Single-container OTLP viewer; default off (host fatigue) |
| justplainstuff/plainjob (MIT) | G1 | 68 | TRIAL | better-sqlite3 vs node:sqlite conflict; 96★ v0.0.x maturity |
| langfuse/langfuse (MIT-core) | G2 platform | 68 | TRIAL wave-2 | 4-service Docker Compose self-host |
| oramasearch/orama (Apache-2.0) | G5 hybrid | 65 | TRIAL | Only if hybrid BM25 becomes hard requirement |
| lancedb/lancedb (Apache-2.0) | G5 replace | 60 | TRIAL | Replacement churn unjustified at current scale |
| mem0ai/mem0 (Apache-2.0) | memory | 57 | TRIAL | Overlaps brain.ts port; Python sidecar |
| taskforcesh/bullmq (MIT) | G1 | 55 | REJECT | Redis-only, contradicts sqlite-first |
| breejs/bree (MIT) | G1 | 52 | REJECT | No durable storage |
| timgit/pg-boss (MIT) | G1 | 48 | REJECT | Forces pg mandatory |
| graphile/worker (MIT) | G1 | 46 | REJECT | Forces pg mandatory |
| BerriAI/litellm / Portkey-AI/gateway / lm-sys/RouteLLM / TensorZero | G6 routing | — | REJECT | In-house council+Wilson-gate stronger; RouteLLM dead 2yr; wrong language (Py/Rust) |
| Arize phoenix (ELv2), SigNoz (AGPL-3.0), Restate (BSL), asg017/sqlite-lembed (no license), Trigger.dev/Inngest (dual-license self-host) | — | GATE | REJECT | License gate |
| asg017/sqlite-rembed (Apache-2.0, 2024-11) | G5 | 48 | REJECT | Unmaintained ~20mo |

## T0-approved wave-1 build queue (sequential, dependency-driven)
B1 croner + sqlite queue (first jobs: key-health tick migration + db backup; graceful shutdown) →
B2 OTel stack + in-process trace ring-buffer + /api/traces →
B3 brain.ts port + ToolRegistry registration →
B4 quickjs safe_exec tool + policy gate →
B5 reranker + semantic-chunking into rag.ts →
B6 promptfoo port + eval proving B5 uplift →
B7 hierarchy µ2/µ3 wiring (internal, no repo) →
B8 full quality gate + live :3000 smoke.

## Wave-2 results (2026-07-16)
- C0 merge to parent `9e6def5` (feat/v-final-train); cockpit :3000 restarted, /api/jobs + /api/hierarchy live in production.
- C1 `1413b73` — pollinations host fix (text.pollinations.ai/v1) + cohere/hf entries ported from 0a916bb.
- C2 `94b7311` — oauth-gc → durable job (hourly cron), webhook-retry → registerRecurring(30s); server.ts:3305/:3509 were CLIENT-side script intervals (discovery mis-categorization, correctly left); prom metrics: ollamas_jobs_runs_total, ollamas_jobs_duration_ms, ollamas_tracing_spans_exported_total, ollamas_hierarchy_recommendations_total.
- C3 `442db62` — µ2 calibration HONESTLY BLOCKED: council-ledger = 4-agent vote data (no loss denominator, 50-entry ring, no tier taxonomy) → no policy fabricated; evidence-gap report at docs/plans/mu2-calibration-report.md.
- Wave-6 discovery: NO TS-native embedded semantic-cache lib exists (GPTCache=Python, upstash stale+cloud, betterdb=Valkey-dep, langchain-js=exact-only) → in-house verdict proven.
- C4 `86e762f` — in-house semantic cache (exact sha256 + sqlite-vec cosine ≥0.95 + TTL 3600s, SEMANTIC_CACHE=1 opt-in), ollamas_semantic_cache_events_total, GET /api/cache. Root-cause find: vec0 default distance = raw L2, not squared.
- C5 rerank uplift LIVE PROOF: MRR@5 OFF 0.2733 → ON 0.9333, delta +0.6600 (bge-reranker-base local, 10q×8cand fixture). B5 adoption justified numerically.
