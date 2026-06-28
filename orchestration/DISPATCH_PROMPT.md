# OLLAMAS — DISTRIBUTED DISPATCH WORKING PROMPT (self-optimizing, portable)

> Mac ↔ desktop-ert7724 dağıtık alt-agent işbirliği. `dispatchbench.ts` üretti — ölçüme-dayalı, deterministik.
> Veri (`dispatch-bench.json`) değişince makine-başı en-iyi working-principle seçimi OTOMATİK güncellenir.
> ⚠️ **STALE / veri yok** — seçim son ölçüme dayanır. Taze ölçüm için cli/scripts lane'de dispatch-bench koş, `~/.llm-mission-control/dispatch-bench.json` güncellensin.

<selected-variants>  (makine → en-iyi working-principle varyantı, ordered gate: correct → adım/dup → latency → tok/s)
| Makine | Variant | correct | adım | latency | tok/s | gerekçe |
|--------|---------|--------:|-----:|--------:|------:|---------|
| desktop-ert7724 | — | 0 | 0 | 0ms | 0 | veri yok — bu makinede dispatch-bench koşulmadı (cli/scripts lane üretir) |
| mac | — | 0 | 0 | 0ms | 0 | veri yok — bu makinede dispatch-bench koşulmadı (cli/scripts lane üretir) |
</selected-variants>

<routing>  (assignWorker — pure, fleet.ts decideTransition deseni)
- host-tool (macos_terminal/iTerm) → YALNIZ mac kontrol düzlemi.
- codegen/analysis (GPU-ağır) → sağlıklı remote worker, en yüksek tok/s; yoksa mac substrate failover.
- thrash-guard: mevcut worker hâlâ uygunsa değiştirme.
</routing>

<protocol>  (choke-point yasası N-012)
- Dispatch YALNIZ HTTP: POST http://<worker>:<port>/api/agent/chat (SSE), agent-dispatch.mjs gövde-şekli.
- ToolRegistry import YOK — her makine kendi server'ı kendi dosya-sisteminin tek choke-point'i.
- Görev-başı yazma-kökü izolasyonu (--root); ledger claim→heartbeat→done (claims.ts deseni).
</protocol>

<evidence-law>
Bir "çalışıyor" iddiası ANCAK yapılı raporla geçerli: steps>0 && !demoSuspected && non-demo provider && verdict===DONE.
Mock YOK — gerçek SSE structured report. Yanlış-ama-hızlı varyant diskalifiye (correctness-gate 0.7).
</evidence-law>
