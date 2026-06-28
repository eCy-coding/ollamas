# RECONCILE — autonomous fleet reconcile loop (vO23)
<!-- AUTO reconcile.ts · 2026-06-28T20:11:51.913Z · regenerate: tsx orchestration/bin/reconcile.ts -->

> Level-based reconcile (K8s-operator pattern): desired-vs-actual → tek sonraki aksiyon. Benchmark-driven, soru yok.

## Desired (istenen)
- mode: **inference-offload** · gerekli model: `qwen3:8b` · variant: —

## Actual (gerçek · dispatchdoctor)
- anyReachable: true · offload-GO: true · full-remote-GO: false

## Action (tek sonraki adım — converge)
**▶ REBENCH** — ölçülmüş varyant yok (DISPATCH_SELECTION null) → dispatchbench koş, sonra dispatch
