# CONTRACT LANE ROADMAP

| Ver | Tema | Durum |
|---|---|---|
| **vK1** | Kontrat çekirdeği — doc hash, registry state machine, ed25519 identity, atomic state | ✅ DONE |
| **vK2** | Key köprüsü + server wiring (/api/contract/*) + contract_admin tool + CLI | ✅ DONE |
| **vK3** | Pool ledger + heartbeat + canlı doctor → kontrat bölümü TAMAM | ✅ DONE |
| **vK4** | Scheduler federasyon — skor-sıralı fleet priority, /api/pool/generate gateway, kota | ✅ DONE |
| **vK5** | Partition hesabı — exo memory-weighted layer dilimi (PURE, largest-remainder) | ✅ DONE |
| **vK6** | RPC sharding — private-only arg/plan (partition tabanlı), capability-gate + cli shard | ✅ DONE¹ |
| **vK7** | CANLI shard kanıtı — GGML_RPC build, spawn/pid/probe/blob-resolve, cli shard up/down/status/proof | ✅ DONE |
| **vK8** | Member agent 0-manuel — join tek-komut, launchd heartbeat daemon, quota görünürlük | ✅ DONE |
| **vK9** | Shard sanal-backend — gateway shard-first dalı + fleet fallback + cockpit pool paneli | ✅ DONE |
| **vK10** | Hardening — rpcPort heartbeat wire (F1), kota-başarıda (F2), SSRF guard (F3), state lock (F4), fitsModel gate, head.json 0600 | ✅ DONE |
| **vK11** | Tamamlama — doctor generate+quota kapsamı (F5), suspend wire (contract_admin+route+cli, dead-code) | ✅ DONE |

¹ vK6 canlı çok-makine token-üretim kanıtı CAPABILITY-GATED: brew llama.cpp
GGML_RPC'siz derlenmiş (rpc-server binary + --rpc flag YOK). `contract shard`
dürüst gate + build hint verir; binary'ler hazır olduğunda plan/args üretimi
test-edilmiş halde bekliyor. Canlı kanıt → vK7 (RPC-enabled build + 2. makine).

¹-çözüldü (vK7): `contract shard proof qwen3:4b` → ok:true splitProven:true exit0 —
tek model İKİ rpc-server prosesinde (tensor-split 1,1, iki Metal instance), her iki
rpc logu completion sırasında büyüdü (1932B+1631B) = katmanlar gerçekten iki proseste.
GOTCHA'lar: cmake target `ggml-rpc-server` (rpc-server değil); default device BLAS'a
düşerse RMS_NORM abort → `--device` açık ver; `-ngl 99` şart (yoksa RPC boş durur);
CPU-rpc memory raporlamaz → tensor-split açık ver; grep -q SIGPIPE exit141.

## vK12 — NEXT (aday: 2. fiziksel makine e2e — tunnel/mesh üstünden gerçek çok-makine shard; member rpc-port heartbeat vK10'da hazır)
