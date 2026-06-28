# DISPATCH_SIM — Hybrid dispatch flow trace (vO20)

> ⚠️ **Simulated flow-LOGIC proof, NOT a live perf measurement.** `dispatchsim.ts` üretti —
> saf, deterministik (sanal saat, Date.now YOK). tok/s UYDURULMAZ; `dispatch-bench.json` SEED edilmez.
> Bu = cli lane'in **executable spec / compliance oracle**'ı: cli implementasyonu bu izi üretmeli.

**Senaryo:** mac + desktop-ert7724; t1 host-tool→mac, t2 codegen→desktop (desktop down @tick3 → mac substrate failover), t3 analysis, t5 codegen post-failback→desktop

## Atamalar (assignWorker, ilk hop)
| Task | Worker | Gerekçe |
|------|--------|---------|
| t1 | mac | host-tool → mac kontrol düzlemi |
| t2 | desktop-ert7724 | GPU-ağır codegen → remote desktop-ert7724 (40 tok/s) |
| t3 | mac | remote yok → mac substrate failover (analysis) |
| t4 | mac | host-tool → mac kontrol düzlemi |
| t5 | desktop-ert7724 | GPU-ağır codegen → remote desktop-ert7724 (40 tok/s) |

## Ledger event akışı (sanal tick)
| tick | task | worker | status | not |
|-----:|------|--------|--------|-----|
| 0 | t1 | mac | claimed | host-tool → mac kontrol düzlemi |
| 2 | t1 | mac | done | completed |
| 2 | t2 | desktop-ert7724 | claimed | GPU-ağır codegen → remote desktop-ert7724 (40 tok/s) |
| 3 | t2 | desktop-ert7724 | failed | worker unhealthy mid-run (heartbeat miss) |
| 3 | t2 | mac | claimed | remote yok → mac substrate failover (codegen) |
| 6 | t2 | mac | done | completed |
| 6 | t3 | mac | claimed | remote yok → mac substrate failover (analysis) |
| 8 | t3 | mac | done | completed |
| 8 | t4 | mac | claimed | host-tool → mac kontrol düzlemi |
| 103 | t4 | mac | done | completed |
| 103 | t5 | desktop-ert7724 | claimed | GPU-ağır codegen → remote desktop-ert7724 (40 tok/s) |
| 105 | t5 | desktop-ert7724 | done | completed |

## Failover (worker down → substrate re-route)
- `t2`: desktop-ert7724 → mac @ tick 3

## Epic verdict
- `t1` (host-tool) → mac · **done**
- `t2` (codegen) → mac · **done** (failed-over)
- `t3` (analysis) → mac · **done**
- `t4` (host-tool) → mac · **done**
- `t5` (codegen) → desktop-ert7724 · **done**

**allOk=true · VERDICT: DONE**
