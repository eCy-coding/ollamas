# THINK.md — sustainable problem-solving loop (evidence-based, no-guess)

> Auto: `tsx orchestration/bin/think.ts` · 2026-07-01T13:22:17Z · 29 problem · 6 proven · 23 needs-research
> Rule: unknown problems are flagged NEEDS_RESEARCH — the mechanism never invents a fix (only cited, proven solutions).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: crit:done-no-evidence:vO16 vO16 (E2E Integration Run, Diagnose, Repair & Publish lane'ler int) DONE ama eşleşen araç/art
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## ✅ orphan-artifact — PROVEN
- Problem: crit:orphan-artifact:COUNCIL_PROMPT.md COUNCIL_PROMPT.md hiçbir araçça okunmuyor (orphan/rename drif
- Solution: Wire the artifact into a consumer (produced JSON must be consumed) OR delete it. An orphan that is generated-but-never-read is either half-work (wire it) or dead code (remove it).
- Sources: this project RISK-ORCH-015 (orphan-tool wiring: produce+consume together) · dead-code elimination (standard practice)
- Evidence: autopilot chain consumes critic/dod/fuse/think outputs (no orphan generators)

## ✅ coverage-gap — PROVEN
- Problem: crit:coverage-gap:lib/gpu-lock.ts lib/gpu-lock.ts: test'siz export → pullTicket, tryTurn, renewTurn,
- Solution: Add a unit test for the pure core first (fast, deterministic); prefer testing IO-free functions. A pure module with property tests closes the gap without brittle IO mocking.
- Sources: Testing Pyramid (Mike Cohn / Martin Fowler): favor fast unit tests over IO-bound ones · this project: pure-core + thin-IO split (gpu-lock/backoff/think tested pure)
- Evidence: orchestration/tests/*.test.ts (pure cores) — gpu-lock/backoff/think/fleet-plan

## ✅ code-duplication — PROVEN
- Problem: crit:duplication:dispatchdoctor.ts↔doctor.ts dispatchdoctor.ts ve doctor.ts ayırt-edici amaç-örtüşme
- Solution: Extract the shared logic into ONE module and import it (Don't Repeat Yourself); if the two only look similar but differ in intent, record a justified suppression instead of merging.
- Sources: Martin Fowler, Refactoring (Extract Function/Module) · The Pragmatic Programmer — DRY principle
- Evidence: orchestration/bin/lib/* shared cores (claims/bench/optimize) + .policy-suppress.json for false-positives

## ✅ code-duplication — PROVEN
- Problem: crit:duplication:fleet-conduct.ts↔fleet-launch.ts fleet-conduct.ts ve fleet-launch.ts ayırt-edici am
- Solution: Extract the shared logic into ONE module and import it (Don't Repeat Yourself); if the two only look similar but differ in intent, record a justified suppression instead of merging.
- Sources: Martin Fowler, Refactoring (Extract Function/Module) · The Pragmatic Programmer — DRY principle
- Evidence: orchestration/bin/lib/* shared cores (claims/bench/optimize) + .policy-suppress.json for false-positives

## ✅ code-duplication — PROVEN
- Problem: crit:duplication:oracle-serve.ts↔oracle.ts oracle-serve.ts ve oracle.ts ayırt-edici amaç-örtüşmesi (
- Solution: Extract the shared logic into ONE module and import it (Don't Repeat Yourself); if the two only look similar but differ in intent, record a justified suppression instead of merging.
- Sources: Martin Fowler, Refactoring (Extract Function/Module) · The Pragmatic Programmer — DRY principle
- Evidence: orchestration/bin/lib/* shared cores (claims/bench/optimize) + .policy-suppress.json for false-positives

## ✅ uncommitted-green — PROVEN
- Problem: dod:uncommitted-green:35 dosya Commit'siz yeşil iş (built-not-shipped): .autopilot-refresh.json, AUT
- Solution: Green work must be committed at the phase boundary (quality gate: tsc → tests → conventional commit). Uncommitted-green is half-work; commit when the FULL gate passes (quiesce heavy load first so the gate isn't flaky).
- Sources: AGENTS.md §3 quality gate (this project) · trunk-based development: small, gated, frequent commits
- Evidence: each vO phase closed with a gated conventional commit (d1cce40 etc.)

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO17 vO17 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO23 vO23 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO22 vO22 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO21 vO21 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO20 vO20 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:done-without-governance:vO19 vO19 DONE ama SEYIR_DEFTERI'nde girdisi yok (kanıt eksik)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:claim claim kısmen tamam — eksik eş-zamanlı: SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:council council kısmen tamam — eksik eş-zamanlı: roadmap-row, SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:dispatchbench dispatchbench kısmen tamam — eksik eş-zamanlı: SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:dispatchdoctor dispatchdoctor kısmen tamam — eksik eş-zamanlı: SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:dispatchsim dispatchsim kısmen tamam — eksik eş-zamanlı: SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:driftguard driftguard kısmen tamam — eksik eş-zamanlı: SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:oracle oracle kısmen tamam — eksik eş-zamanlı: test, SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:concurrent-task:think think kısmen tamam — eksik eş-zamanlı: roadmap-row, SEYIR-entry
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:council council aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:fleet-agent fleet-agent aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:fleet-conduct fleet-conduct aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:fleet-launch fleet-launch aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:fleet-watch fleet-watch aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:oracle-serve oracle-serve aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: dod:roadmap-coherence:think think aracı roadmap'te anılmıyor (izlenebilirlik boşluğu)
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

## 🔬 NEEDS_RESEARCH (no proven solution in registry — do NOT guess)
- Problem: CRITICAL red:integration/v17-core tsc 18 hata
- Action: research ≥2 authoritative sources, verify, then append to PROBLEM_REGISTRY.json (mechanism learns).

