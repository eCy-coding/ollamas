# Contract Lane Calibration

Pure-path microbench (100 iters each). Measured on this host — re-run to recalibrate.

| path | n | min | mean | p50 | p90 | p99 | max | (ms) |
|---|--:|--:|--:|--:|--:|--:|--:|--|
| invite.mint | 100 | 0.0410 | 0.0448 | 0.0424 | 0.0523 | 0.0640 | 0.0760 | |
| invite.verify | 100 | 0.0433 | 0.0486 | 0.0448 | 0.0515 | 0.0815 | 0.2700 | |
| registry.apply | 100 | 0.0021 | 0.0058 | 0.0024 | 0.0065 | 0.0415 | 0.2021 | |
| backoff | 100 | 0.0001 | 0.0003 | 0.0001 | 0.0002 | 0.0012 | 0.0141 | |
| isPrivateHost | 100 | 0.0002 | 0.0012 | 0.0003 | 0.0004 | 0.0448 | 0.0477 | |

## Invariants (10 passed, 0 failed)

✓ all security + efficiency invariants hold.

## Tuned constants

| constant | value | type | basis |
|---|---|---|---|
| PROBE_TIMEOUT_MS | 1500 | speed | mesh-safe; ceil(p99×margin) |
| backoff base/max | 5s/300s | speed | measured server recovery |
| breaker threshold/cooldown | 3/30s | policy | fault tolerance |
| invite TTL | 10m | POLICY (security) | RISK-K17 — NOT sped up |
| quota | 1000/day | POLICY (business) | fixed |
| heartbeat stale/dead | 3m/30m | POLICY (SLA) | fixed |

