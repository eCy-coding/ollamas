# SPEC_DISPATCH — Distributed E2E Fleet Agent Collaboration (Mac ↔ desktop-ert7724)

> **vO17 spec.** Orchestration lane üretir; **kod cli/scripts lane'lerinde** yazılır (Scope §3).
> Mevcut fleet yalnız **backend-seçimi** yapar (hangi ollama'ya gidilecek). Bu spec eksik halkayı
> tanımlar: **remote agent dispatch** (ReAct loop'u `desktop-ert7724` ÜZERİNDE koşturma) + **dağıtık
> görev ledger'ı**. Mimari = **Hybrid** (Emre onayı 2026-06-28).

## 1. Mimari — Hybrid (remote dispatch + inference-substrate failover)

```
                 ┌─────────────────────────── MacBook (orkestratör + kontrol düzlemi) ─────────────┐
  epic ──split──▶│ dispatch ledger (taskId)  ──assignWorker(task, fleet)──┐                        │
                 │                                                        ▼                        │
                 │   host-tool/latency işleri ──▶ mac /api/agent/chat (local ReAct + iTerm/Terminal)│
                 └───────────────────────────────────────────┬──────────────────────────────────-─┘
                                                              │ codegen/analysis (GPU-ağır)
                                                              ▼ HTTP POST /api/agent/chat (SSE)  [Tailscale MagicDNS]
                 ┌─────────────────────── desktop-ert7724 (remote GPU worker) ─────────────────────┐
                 │   kendi ollamas server'ı + kendi local ollama GPU + kendi ToolRegistry          │
                 │   ReAct iç-loop BURADA döner → yalnız task-spec + final report Tailscale'i geçer │
                 └──────────────────────────────────────────────────────────────────────────────-─┘
   worker down ──▶ ledger stale-takeover ──▶ task mac inference-substrate'e re-route (decideTransition)
```

**Neden Hybrid:** (A) sadece-inference zaten var (`cli/lib/remote.ts:selectBackend`, `cli/lib/fleet.ts:decideTransition`) ama desktop'un CPU/disk/tool'ları kullanılmaz, sadece token üretir. (B) saf remote-dispatch failback substrate'i olmadan worker çökünce iş kaybeder. **Hybrid = B (gerçek dağıtık yürütme) + A (kanıtlı failover substrate).** ReAct iç-loop'u Tailscale'i geçmez → token-streaming gecikmesi yok; yalnız task-spec + yapılı rapor gider.

## 2. Choke-point yasası (N-012) — dispatch protokolü

- Orkestratör görevi **YALNIZ HTTP** ile yollar: `POST http://<worker-host>:<port>/api/agent/chat`, `Accept: text/event-stream`, gövde-şekli `scripts/agent-dispatch.mjs` ile birebir (`{ provider, model?, autoApply:true, maxSteps, messages:[{role:"user", content:STANDARDS+TASK}] }`).
- **`ToolRegistry` import YOK** dispatch yolunda. Her makine kendi server'ı kendi dosya-sisteminin **tek** tool choke-point'idir. cli lane bunu ince `RemoteAgentClient` (fetch sarmalayıcı, `agent-dispatch.mjs` aynası) ile yapar — `cli/lib/client.ts:GatewayClient` deseni.
- Worker keşfi: `tailscale status --json` → `cli/lib/remote.ts:parseTailscalePeers` (zaten `desktop-ert7724.<tailnet>.ts.net` FQDN'i ayıklar). Güvenlik: Tailscale ACL ile yalnız Mac↔worker grant.

## 3. Dağıtık görev ledger'ı (taskId)

`orchestration/bin/lib/claims.ts` motorunu `(lane|version)` → `(taskId)` iş-kalemine **genelle** (cli lane kendi choke-point'i ardında reimplement eder; bu spec referans). Aynı atomic mkdir-lock + append-only JSONL + LWW (`ts→fence→tab`) + TTL/heartbeat/stale-takeover + monoton fencing değişmeden kalır.

**Olay şeması** (`dispatch-ledger.jsonl`):
```jsonc
{
  "ts": 1750000000000,          // epoch ms (LWW)
  "taskId": "epic42-task03",     // claimKey artık taskId
  "worker": "desktop-ert7724",   // "mac" | "desktop-ert7724"
  "tab": "orchestrator",         // atayan
  "status": "claimed",           // queued | claimed | running | done | failed
  "ttlMs": 1200000,              // heartbeat'siz bu süre sonra stale → takeover
  "fence": 3,                    // diriltilen stale worker clobber edemez
  "taskSpec": { "kind": "codegen", "root": "/abs/write-root", "prompt": "…" },
  "report": { "steps": [], "files": [], "errors": [], "demoSuspected": false, "verdict": "DONE" }
}
```

**Akış:**
- **Split:** orkestratör epic'i bağımsız alt-agent görevlerine böler. Bağımsızlık = paylaşılan yazma-kökü YOK (her görev kendi `--root`'u, `agent-dispatch.mjs` deseni). Paralel-agent disiplini.
- **Assign:** `assignWorker(task, fleet)` saf fonksiyon (bkz. §4) — `claimed` event'i ledger'a yazar.
- **Track:** dispatch'te `claim`; SSE stream boyunca `--renew` heartbeat; bitişte `done` + birleşik rapor. Worker çökerse stale-takeover diğer makineye re-queue (failover kanıtlı).
- **Merge:** her worker'ın yapılı raporu toplanır; `epicOk = her task done && hiç demoSuspected yok`; `files`/`errors`/`verdict` tek epic-raporunda toplanır.

## 4. `assignWorker` yönlendirme kuralları (saf, `fleet.ts:decideTransition` deseni)

Referans implementasyon: `orchestration/bin/lib/dispatchbench.ts:assignWorker` (test'li). Sıralı, deterministik:
1. **host-tool** (macos_terminal/iTerm) → **yalnız mac** kontrol düzlemi. mac down → atanamaz (host-tool remote'ta koşamaz).
2. **codegen/analysis** (GPU-ağır) → sağlıklı **remote** worker, en yüksek tok/s (ad tie-break).
3. Sağlıklı remote yok → **mac substrate failover** (Hybrid fallback). mac da down → atanamaz.
4. **thrash-guard:** `current` worker hâlâ sağlıklı & uygunsa → koru (yeniden-atama churn'ünü önle).

## 5. Hybrid failover sözleşmesi

- Remote agent-worker `/api/health` düşerse → o worker'a `claimed` görevler `ttlMs` sonra stale → ledger takeover → mac inference-substrate'e re-route (`decideTransition` mevcut mantığı, `cli/lib/fleet.ts`).
- Failback: worker geri gelince proaktif probe (mevcut `cli/commands/remote.ts` supervisor deseni) tekrar remote'a yönlendirir. Thrash-guard `minDwellMs` flapping'i engeller.
- **Evidence law:** bir görev ancak yapılı raporla "done": `steps>0 && !demoSuspected && non-demo provider && verdict===DONE`. Mock YOK.

## 6. Sahiplik (hangi lane neyi yazar)

| Bileşen | Lane | Dosya (hedef) |
|---|---|---|
| Bu spec + ledger şema + assignWorker referans + dispatchbench | **orchestration** | `orchestration/**` (vO17-19, BU SEKME) |
| `RemoteAgentClient` (fetch `/api/agent/chat` remote) | cli | `cli/lib/remote-agent.ts` |
| Ledger lib `(taskId)` + `assignWorker` + testler | cli | `cli/lib/dispatch.ts` |
| `ollamas remote dispatch` subcommand | cli | `cli/commands/remote.ts` |
| Failover re-route (worker down → substrate) | cli | `cli/lib/fleet.ts` |
| desktop-ert7724 server bring-up + ready parity | scripts/server | `scripts/fleet-join.ps1`, `scripts/ready.mjs` |
| `agent-dispatch.mjs --remote <host>` + merge aggregator | scripts | `scripts/agent-dispatch.mjs` |
| E2E conformance (gerçek Tailscale + GPU) | scripts(e2e) | `tests/dispatch.e2e.test.ts` |

> Bu sekme lane koduna **yazmaz** — her satır için yapıştır-hazır optimal prompt üretir (`plan-next.ts` / `backlog.ts` deseni), sahibi lane uygular.
