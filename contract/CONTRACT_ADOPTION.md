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

## vK17 invite-onboarding riskleri (auto-approve-on-signed-invite)
- **RISK-K17** çalınmış-pre-redeem invite → süresi dolana kadar sahte node auto-active olabilir.
  Azaltma: TTL ≤15dk (default) + single-use jti + quota-cap + revoke.
- **RISK-K18** operatör-key compromise = tam admin (keyfi invite mint). Azaltma: 0600 dosya
  (member-identity ile aynı seviye; passphrase/Keychain "0-manuel"i kırar — dürüst-limit);
  `contract invite rotate` = kill-switch (epoch++, tüm invite'lar geçersiz).
- **RISK-K19** usedInvites sınırsız büyüme → `pruneExpiredInvites` her redeem'de süresi-geçenleri düşer.
- **RISK-K20** eski-epoch invite (sızmış key-backup'tan) → payload'da epoch gömülü, verify stale-epoch reddeder.
Manuel-kalan (tasarım): invite-siz üyelik (async adminGuard yolu korunur), operatör-key rotation,
suspend/rotate/revoke (adminGuard). Auto-approve YALNIZ geçerli-imzalı-invite ile.

## vK19 tek-tık kurulum riski
- **RISK-K21** cihaz operatör-served kodu çalıştırır (install.sh + CLI bundle). Sovereign
  tek-kişi (operatör==cihaz-sahibi) kurulumda güvenli. ÇOK-TARAFLI havuzda bu tasarım-gereği
  RCE'dir (kötücül operatör her katılan cihazı ele geçirir). Azaltma: bundle operatör-imzalı
  + cihaz opPubHex (invite'ta) ile exec-ÖNCESİ doğrular (sahte/spoofed installer reddedilir);
  transit mesh-WireGuard-şifreli (operatör private-IP'den fetch). Kalan güven-sınırı: cihaz
  operatör'ün NİYETİNE güvenir — yalnız güvenilen operatörün invite'ını kabul et.
- Operatör tek-key disiplini: build-cli.sh (imzala) + server (install.sh verify) + invite
  (opPubHex) AYNI operatör-key (~/.ollamas/contract-operator-key.json) — otomatik hizalanır;
  key rotate → bundle YENİDEN imzalanmalı + invite yeniden mint (ERR-CONTRACT-020).
