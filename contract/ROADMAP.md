# CONTRACT LANE ROADMAP

| Ver | Tema | Durum |
|---|---|---|
| **vK1** | Kontrat çekirdeği — doc hash, registry state machine, ed25519 identity, atomic state | ✅ DONE |
| **vK2** | Key köprüsü + server wiring (/api/contract/*) + contract_admin tool + CLI | ✅ DONE |
| **vK3** | Pool ledger + heartbeat + canlı doctor → kontrat bölümü TAMAM | ✅ DONE |
| **vK4** | Scheduler federasyon — skor-sıralı fleet priority, /api/pool/generate gateway, kota | ✅ DONE |
| **vK5** | Partition hesabı — exo memory-weighted layer dilimi (PURE, largest-remainder) | ✅ DONE |
| **vK6** | RPC sharding — private-only arg/plan (partition tabanlı), capability-gate + cli shard | ✅ DONE¹ |

¹ vK6 canlı çok-makine token-üretim kanıtı CAPABILITY-GATED: brew llama.cpp
GGML_RPC'siz derlenmiş (rpc-server binary + --rpc flag YOK). `contract shard`
dürüst gate + build hint verir; binary'ler hazır olduğunda plan/args üretimi
test-edilmiş halde bekliyor. Canlı kanıt → vK7 (RPC-enabled build + 2. makine).

## vK7 — NEXT (canlı shard kanıtı: GGML_RPC build + iOS/2. makine üstünde e2e)
