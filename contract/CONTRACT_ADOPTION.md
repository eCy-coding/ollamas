# CONTRACT LANE — OSS ADOPTION MATRIX

SPDX ids EXACT (kategori kelimesi 'permissive/free' GEÇERSİZ — RISK-ORCH-017).

| Proje | Repo | SPDX | Ne | Karar |
|---|---|---|---|---|
| exo | github.com/exo-explore/exo | Apache-2.0 | P2P keşif + memory-weighted ring layer-partition ilkesi | idea-only |
| llama.cpp rpc-server | github.com/ggml-org/llama.cpp | MIT | TCP ggml layer-offload (pipeline split) | binary-adopt (vK6 gerçek motor) |
| LiteLLM | github.com/BerriAI/litellm | MIT | virtual key + kota/TTL/rotate lifecycle ilkesi | principle-adopt |
| one-api | github.com/songquanpeng/one-api | MIT | token pool ⇄ channel pool indirection ilkesi | principle-adopt |
| new-api | github.com/QuantumNous/new-api | AGPL-3.0-only | billing-zengin fork | idea-only — kod ASLA vendor edilmez |
| headscale | github.com/juanfont/headscale | BSD-3-Clause | preauth-key = join kontratı deseni (tunnel lane'de zaten binary-adopt) | reuse |
| ollama | github.com/ollama/ollama | MIT | resmi multi-node YOK (#9147, #4643) — boşluk bu lane'in varlık sebebi | upstream |

Not: `backend/` altındaki p2p_network.go / hardware_orchestrator.rs / MultiLevelReward.sol
stub'ları bu lane tarafından KULLANILMAZ (unwired, YAGNI).
