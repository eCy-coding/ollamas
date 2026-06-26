# ollamas projesi — ihtiyaç CLI planı (roadmap-driven, sıralı)

Projenin gerçek ihtiyaçlarına göre (zero-dep TS CLI + /api+/mcp server + Node-SEA binary + brew + npm + Apple Shortcuts + agent fleet + audit/supply-chain). Genel harness CLI'ları → CLI-REGISTRY.md. Bu dosya: PROJE-SPESİFİK ihtiyaçlar.

## A) KURULU + proje-aktif → ENTEGRE EDİLDİ (add-cli, 2026-06-27)
| CLI | tier | proje-bağ |
|---|---|---|
| `shortcuts` | ask | v6 Apple Shortcuts pack (workflow run/list) — AKTİF kullanımdaydı, permissionsuzdu |
| `mandoc` | allow | v13 `man ollamas` `-Tlint` temizlik |
| `hf` | allow | adoption-research / HF model keşif |
| `depcheck` | allow | zero-dep unused-dep audit (CLAUDE.md "unused = sil") |

## B) KURULMAMIŞ + roadmap-imminent → operatör kurar, sonra /add-cli
Tek komut: `brew install minisign syft grype git-cliff`
| CLI | öncelik | proje-bağ | tier (eklenince) |
|---|---|---|---|
| `minisign` | HIGH | **v18 imza** — SEA binary + npm tarball + brew (Ed25519, $0, tek-dev; cosign overkill) | ask |
| `syft` | HIGH | SBOM (CycloneDX/SPDX) — audit-service satılabilir deliverable | allow |
| `grype` | HIGH | SBOM vuln tarama — Trivy ile çapraz-doğrulama | allow |
| `git-cliff` | HIGH | conventional changelog → `gh release` (proje conventional commit kullanıyor) | ask |

## C) npx-tabanlı (KURULUM YOK — gerekince çağır)
| araç | öncelik | proje-bağ |
|---|---|---|
| `@stoplight/spectral-cli` | HIGH | OpenAPI lint — `/api/openapi.json` kalite |
| `@modelcontextprotocol/inspector` | HIGH | `/mcp` conformance (zaten `conformance:stdio` script'inde) |
| `knip` | MED | ölü-kod/export avı — zero-dep enforcer |
| `license-checker` | MED | audit-service müşteri lisans raporu |

## D) $0 DEĞİL / sistem (Emre kararı)
- macOS **notarize** → Apple Developer **$99/yıl** gerektirir. `codesign`/`xcrun`/`notarytool` sistem-ücretsiz ama notarize hesap ister.
- `create-dmg` / `size-limit` → opsiyonel [LOW].

## Roadmap-faz eşleme
- **v17 (NEXT)** agent --watch → server SSE (cross-lane, CLI değil) — yeni CLI gerekmez.
- **v18 imza** → `minisign` (B-grubu, ŞİMDİ kur).
- **audit/supply-chain (gelir)** → `syft`+`grype`+`license-checker` (SBOM+lisans satılabilir).
- **her release** → `git-cliff` + `gh release` + `spectral` (OpenAPI gate) + `mcp-inspector` (MCP gate).

## Sıradaki operatör aksiyonu
```bash
cd ~/Desktop/ollamas && bash .claude/apply-harness.sh      # A-grubu + biriken izinler canlı
brew install minisign syft grype git-cliff                  # B-grubu kur
# sonra: /add-cli minisign ask · /add-cli syft allow · /add-cli grype allow · /add-cli git-cliff ask
```
npx-grubu (C) kurulum gerektirmez — gerekince `/security-scan`-benzeri komutlardan çağrılır.
