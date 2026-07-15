# Observability — ollamas MCP gateway

The gateway already exposes Prometheus metrics at **`GET /metrics`** (wired in
`server/metrics.ts`, registered in `server.ts` *before* the auth middleware → it is
**unauthenticated by design**; restrict it at the network layer, not with app auth).
This directory wires the *consume* side that was missing: scrape, alerts, dashboard.

## Metrics inventory (what /metrics exposes)
| metric | type | labels | meaning |
|--------|------|--------|---------|
| `http_request_duration_ms` | histogram | method, route, status | request latency (use `_bucket`/`_count`) |
| `mcp_tool_calls_total` | counter | tool, tier, ok | tool calls through the choke-point |
| `ukp_stage_events_total` | counter | event_type, recorded | UKP ingest stage events |
| `ollamas_db_pool_connections` | gauge | state=total\|idle\|waiting | pg pool (absent on sqlite) |
| `ollamas_webhook_queue_depth` | gauge | — | pending webhook deliveries |
| `ollamas_migration_version` | gauge | — | applied schema version |
| `ollamas_shutdown_total` | counter | — | graceful shutdowns |
| + `process_*` / `nodejs_*` | — | — | prom-client default metrics |

## Apply

### With the Prometheus Operator (kube-prometheus-stack) — preferred
```bash
kubectl apply -f deploy/observability/servicemonitor.yaml
kubectl apply -f deploy/observability/prometheusrule.yaml
```
Or via Helm (gated, off by default — enable once the CRDs exist):
```bash
helm upgrade ollamas deploy/helm/ollamas \
  --set observability.serviceMonitor.enabled=true \
  --set observability.prometheusRule.enabled=true
```
Edit the `release: prometheus` label in the manifests to match your Prometheus
`serviceMonitorSelector` / `ruleSelector`.

### Without the Operator (plain Prometheus / docker-compose / VM)
Merge `prometheus-scrape.yaml` into your `prometheus.yml` `scrape_configs:` (it has a
static job and an annotation-based k8s-pod job; the pod annotations are already on the
Deployment in `deploy/k8s/ollamas.yaml` and the Helm chart when
`observability.podAnnotations=true`).

### Grafana
Import `grafana-dashboard.json` (Dashboards → Import) and pick your Prometheus datasource.

## Alert thresholds (tune to your SLOs)
`OllamasTargetDown` (crit), `OllamasDbPoolExhausted`, `OllamasWebhookQueueBacklog`
(>100 pending), `OllamasToolErrorRateHigh` (>5% tool failures), `OllamasHttpP99LatencyHigh`
(>2s). Helm exposes the thresholds under `observability.prometheusRule.*`.

## Next step — autoscale on a custom metric
The default HPA is CPU-only. To scale on, e.g., `ollamas_webhook_queue_depth`, install
[prometheus-adapter](https://github.com/kubernetes-sigs/prometheus-adapter), expose the
metric via the custom-metrics API, then add an `External`/`Pods` metric to the HPA. Kept
out of the chart by default because it requires that cluster-side component.
