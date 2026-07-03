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
| **vK12** | Pool-kaynaklı çok-makine shard — shard up --from-pool (F1), serve-rpc (F3), modelSize gate (F2), listShardProcesses wire | ✅ DONE |
| **vK13** | Governance — resume/unsuspend, lane-owned audit-log (secret-free), member-key rotation | ✅ DONE |
| **vK14** | Kalıcı cross-host üye — node-config, mesh-host keşfi (tailscale), serve-rpc launchd daemon, launch preflight, tek-komut offer | ✅ DONE |
| **vK15** | 0-manuel e2e eksiksizlik — server daemon (G1), operator node-config (G6), applicant notify (G2), audit rotation (G4), doctor env-health (G5), cockpit action-cue (G7), errors_registry+README (G3) | ✅ DONE |
| **vK16** | Observability+Resilience+Gate — /api/pool/status+health+boot-log, breaker/backoff+watch, cross-host doctor, verify.sh+contract-CI, RECIPES+errors, key-reload test | ✅ DONE |
| **vK17** | Turnkey 2-cihaz onboarding — invite (imzalı ön-onay) + apply-with-invite (auto-approve, single-use/TTL/epoch-killswitch) + bootstrap (tek-komut mesh+build+approve+offer) + docs | ✅ DONE |
| **vK18** | Kalibrasyon + ToS v2 + verim-fix — syncFleetFile dirty-check, contract calibrate (microbench+10 invariant), contractdoc v2 (10-bölüm solo+tüm-yetenek), PROBE_TIMEOUT_MS/TTL-10dk | ✅ DONE |

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

¹² vK12 CANLI KANIT (loopback): 2× serve-rpc (member-rpc-50052/53) + 2 üye heartbeat rpcPort →
`shard up --from-pool qwen3:4b` head'i POOL endpoint'lerinden başlattı (head.json source:pool,
endpoints=[50052,53], memberIds=2) → /api/pool/generate source:shard:head → HER İKİ member-rpc
log büyüdü (1932B+1631B=layer-split canlı) → `shard down` 3 pid (head+2 rpc) listShardProcesses ile temizledi.
Hardcoded değil, canlı pool-verisinden. F4 (resume/audit/rotation) vK13'e ertelendi.

¹⁴ vK14 CANLI KANIT (loopback + CANLI tailscale): detectMeshHost → gerçek tailnet IP 100.108.67.76 (fallback DEĞİL); serve-rpc install → launchd com.ollamas.contract.rpc loaded (status host=mesh-IP) → uninstall temiz; node-config persist 0600; `offer` → node-config(meshHost+model) + 2 daemon(rpc+agent) "advertising 100.108.67.76:50052 over the mesh" → offer stop temiz; shard up --from-pool PREFLIGHT "2 reachable pool node" → source:shard:head → çift-log split (925B+624B). Kod+daemon+config+preflight cross-host-hazır. EXTENSIBLE: yeni transport CONTRACT_RPC_HOST env ile.

¹⁵ vK15 CANLI KANIT (loopback): server install→launchd com.ollamas.server→pool :3000 GERÇEKTEN başladı (status healthy:true)→uninstall temiz; doctor env-health: ollama up + mesh 100.108.67.76 + daemons + "⚠ 1 pending T0-onay" exit0; apply→bildirim(crash yok); audit rotation ring (unit); operator node-config serverUrl; cockpit amber pending-cue. errors_registry ERR-003..010; README QUICKSTART. lane 84, contract-lane 13, orchestration 861.

## vK16 — NEXT (gerçek 2-cihaz cross-host e2e — donanım; kod+daemon+config+preflight+doctor TAM hazır)
