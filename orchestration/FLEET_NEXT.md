# FLEET_NEXT.md — prioritized next-task queue (precomputed)

> Auto: `tsx orchestration/bin/fleet-next.ts` · 2026-07-01T21:29:42Z · 26 task
> Order: P1 safe-additive apply → P2 risky-edit apply (per-lane review) → P3 research (no-guess).

| # | Task | Stream | Target | Rationale |
|---|------|--------|--------|-----------|
| 1 | P1 apply-additive | mjs-migration | `scripts/tsconfig.json` | new file, edits nothing existing → safe to apply + gate now |
| 2 | P1 apply-additive | test-coverage | `cli/lib/client.ts` | new file, edits nothing existing → safe to apply + gate now |
| 3 | P2 apply-edit | concurrency-safety | `server/host-bridge.ts` | edits live code → per-lane review before apply (0-hata) |
| 4 | P2 apply-edit | errors-resilience | `server/agent-events.ts` | edits live code → per-lane review before apply (0-hata) |
| 5 | P2 apply-edit | shell-harden | `start.sh` | edits live code → per-lane review before apply (0-hata) |
| 6 | P2 apply-edit | typescript-core | `code-formatter.ts` | edits live code → per-lane review before apply (0-hata) |
| 7 | P3 research | (think) | `crit:done-no-evidence:vO16 vO16 (E2E Integration Run, Diagno` | no proven solution yet → research ≥2 sources, then append to registry |
| 8 | P3 research | (think) | `dod:done-without-governance:vO17 vO17 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 9 | P3 research | (think) | `dod:done-without-governance:vO23 vO23 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 10 | P3 research | (think) | `dod:done-without-governance:vO22 vO22 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 11 | P3 research | (think) | `dod:done-without-governance:vO21 vO21 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 12 | P3 research | (think) | `dod:done-without-governance:vO20 vO20 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 13 | P3 research | (think) | `dod:done-without-governance:vO19 vO19 DONE ama SEYIR_DEFTERI` | no proven solution yet → research ≥2 sources, then append to registry |
| 14 | P3 research | (think) | `dod:concurrent-task:claim claim kısmen tamam — eksik eş-zama` | no proven solution yet → research ≥2 sources, then append to registry |
| 15 | P3 research | (think) | `dod:concurrent-task:council council kısmen tamam — eksik eş-` | no proven solution yet → research ≥2 sources, then append to registry |
| 16 | P3 research | (think) | `dod:concurrent-task:dispatchbench dispatchbench kısmen tamam` | no proven solution yet → research ≥2 sources, then append to registry |
| 17 | P3 research | (think) | `dod:concurrent-task:dispatchdoctor dispatchdoctor kısmen tam` | no proven solution yet → research ≥2 sources, then append to registry |
| 18 | P3 research | (think) | `dod:concurrent-task:dispatchsim dispatchsim kısmen tamam — e` | no proven solution yet → research ≥2 sources, then append to registry |
| 19 | P3 research | (think) | `dod:concurrent-task:driftguard driftguard kısmen tamam — eks` | no proven solution yet → research ≥2 sources, then append to registry |
| 20 | P3 research | (think) | `dod:concurrent-task:fleet-next fleet-next kısmen tamam — eks` | no proven solution yet → research ≥2 sources, then append to registry |
| 21 | P3 research | (think) | `dod:concurrent-task:oracle oracle kısmen tamam — eksik eş-za` | no proven solution yet → research ≥2 sources, then append to registry |
| 22 | P3 research | (think) | `dod:concurrent-task:think think kısmen tamam — eksik eş-zama` | no proven solution yet → research ≥2 sources, then append to registry |
| 23 | P3 research | (think) | `dod:roadmap-coherence:council council aracı roadmap'te anılm` | no proven solution yet → research ≥2 sources, then append to registry |
| 24 | P3 research | (think) | `dod:roadmap-coherence:fleet-agent fleet-agent aracı roadmap'` | no proven solution yet → research ≥2 sources, then append to registry |
| 25 | P3 research | (think) | `dod:roadmap-coherence:fleet-conduct fleet-conduct aracı road` | no proven solution yet → research ≥2 sources, then append to registry |
| 26 | P3 research | (think) | `dod:roadmap-coherence:fleet-launch fleet-launch aracı roadma` | no proven solution yet → research ≥2 sources, then append to registry |

## Conductor directive (next)
- Apply the 2 P1 safe-additive task(s) now through the full gate (tsc → vitest → commit): scripts/tsconfig.json, cli/lib/client.ts
