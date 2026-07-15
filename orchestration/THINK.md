# THINK.md — sustainable problem-solving loop (evidence-based, no-guess)

> Auto: `tsx orchestration/bin/think.ts` · 2026-07-12T07:52:39Z · 7 problem · 7 proven · 0 needs-research
> Rule: unknown problems are flagged NEEDS_RESEARCH — the mechanism never invents a fix (only cited, proven solutions).

## ✅ roadmap-coherence — PROVEN
- Problem: crit:roadmap-drift:v1.28 v1.28 (.1 build/catalog + keys + orchestra araç eşlemesi (roadmap c) 'plann
- Solution: Establish bidirectional requirements traceability: every roadmap item traces FORWARD to an artifact (tool/test/commit) and every artifact traces BACKWARD to a requirement. Maintain a traceability matrix (roadmap ↔ bin/*.ts tool-map), and flag both orphan requirements (a roadmap line with no implementation) and orphan artifacts (a tool with no roadmap line). Keep roadmap and tool-map in sync so coverage stays auditable rather than drifting.
- Sources: Gotel & Finkelstein 1994 — 'An Analysis of the Requirements Traceability Problem', Proc. 1st IEEE Int'l Conf. on Requirements Engineering (ICRE), pp. 94-101 · ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering (bidirectional traceability requirement)
- Evidence: orchestration/ROADMAP_ORCHESTRATION.md 'Araç–Versiyon İzlenebilirlik' tool-map (7-tool v1.28.1 subsection) + dod.ts roadmap-incoherence rule → DOD.json

## ✅ roadmap-coherence — PROVEN
- Problem: crit:roadmap-drift:v1.25 v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç kapanı) 'plann
- Solution: Establish bidirectional requirements traceability: every roadmap item traces FORWARD to an artifact (tool/test/commit) and every artifact traces BACKWARD to a requirement. Maintain a traceability matrix (roadmap ↔ bin/*.ts tool-map), and flag both orphan requirements (a roadmap line with no implementation) and orphan artifacts (a tool with no roadmap line). Keep roadmap and tool-map in sync so coverage stays auditable rather than drifting.
- Sources: Gotel & Finkelstein 1994 — 'An Analysis of the Requirements Traceability Problem', Proc. 1st IEEE Int'l Conf. on Requirements Engineering (ICRE), pp. 94-101 · ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering (bidirectional traceability requirement)
- Evidence: orchestration/ROADMAP_ORCHESTRATION.md 'Araç–Versiyon İzlenebilirlik' tool-map (7-tool v1.28.1 subsection) + dod.ts roadmap-incoherence rule → DOD.json

## ✅ coverage-gap — PROVEN
- Problem: crit:coverage-gap:lib/fleet-prompt.ts lib/fleet-prompt.ts: test'siz export → groundedPrompt
- Solution: Add a unit test for the pure core first (fast, deterministic); prefer testing IO-free functions. A pure module with property tests closes the gap without brittle IO mocking.
- Sources: Testing Pyramid (Mike Cohn / Martin Fowler): favor fast unit tests over IO-bound ones · this project: pure-core + thin-IO split (gpu-lock/backoff/think tested pure)
- Evidence: orchestration/tests/*.test.ts (pure cores) — gpu-lock/backoff/think/fleet-plan

## ✅ code-duplication — PROVEN
- Problem: crit:duplication:conduct.ts↔orchestra.ts conduct.ts ve orchestra.ts ayırt-edici amaç-örtüşmesi (2 di
- Solution: Extract the shared logic into ONE module and import it (Don't Repeat Yourself); if the two only look similar but differ in intent, record a justified suppression instead of merging.
- Sources: Martin Fowler, Refactoring (Extract Function/Module) · The Pragmatic Programmer — DRY principle
- Evidence: orchestration/bin/lib/* shared cores (claims/bench/optimize) + .policy-suppress.json for false-positives

## ✅ code-duplication — PROVEN
- Problem: crit:duplication:fleet-conduct.ts↔orchestra.ts fleet-conduct.ts ve orchestra.ts ayırt-edici amaç-ört
- Solution: Extract the shared logic into ONE module and import it (Don't Repeat Yourself); if the two only look similar but differ in intent, record a justified suppression instead of merging.
- Sources: Martin Fowler, Refactoring (Extract Function/Module) · The Pragmatic Programmer — DRY principle
- Evidence: orchestration/bin/lib/* shared cores (claims/bench/optimize) + .policy-suppress.json for false-positives

## ✅ uncommitted-green — PROVEN
- Problem: dod:uncommitted-green:2 dosya Commit'siz yeşil iş (built-not-shipped): TASKS.json, CALIBRATION.md
- Solution: Green work must be committed at the phase boundary (quality gate: tsc → tests → conventional commit). Uncommitted-green is half-work; commit when the FULL gate passes (quiesce heavy load first so the gate isn't flaky).
- Sources: AGENTS.md §3 quality gate (this project) · trunk-based development: small, gated, frequent commits
- Evidence: each vO phase closed with a gated conventional commit (d1cce40 etc.)

## ✅ roadmap-coherence — PROVEN
- Problem: COMPLETENESS crit:roadmap-drift:v1.25 v1.25 (.4 lane landing araç eşlemesi (roadmap coherence borç k
- Solution: Establish bidirectional requirements traceability: every roadmap item traces FORWARD to an artifact (tool/test/commit) and every artifact traces BACKWARD to a requirement. Maintain a traceability matrix (roadmap ↔ bin/*.ts tool-map), and flag both orphan requirements (a roadmap line with no implementation) and orphan artifacts (a tool with no roadmap line). Keep roadmap and tool-map in sync so coverage stays auditable rather than drifting.
- Sources: Gotel & Finkelstein 1994 — 'An Analysis of the Requirements Traceability Problem', Proc. 1st IEEE Int'l Conf. on Requirements Engineering (ICRE), pp. 94-101 · ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering (bidirectional traceability requirement)
- Evidence: orchestration/ROADMAP_ORCHESTRATION.md 'Araç–Versiyon İzlenebilirlik' tool-map (7-tool v1.28.1 subsection) + dod.ts roadmap-incoherence rule → DOD.json

