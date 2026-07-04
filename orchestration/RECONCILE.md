# RECONCILE — autonomous fleet reconcile loop (vO23)
<!-- AUTO reconcile.ts · 2026-07-04T11:00:46.021Z · regenerate: tsx orchestration/bin/reconcile.ts -->

> Level-based reconcile (K8s-operator pattern): desired-vs-actual → tek sonraki aksiyon. Benchmark-driven, soru yok.

## Desired (istenen)
- mode: **inference-offload** · gerekli model: `qwen3:8b` · variant: ecypro-strict

## Actual (gerçek · dispatchdoctor)
- anyReachable: true · offload-GO: true · full-remote-GO: false

## Action (tek sonraki adım — converge)
**▶ DISPATCH (inference-offload · ecypro-strict)** — converged — inference-offload GO + varyant 'ecypro-strict' → dispatch (steady-state)
