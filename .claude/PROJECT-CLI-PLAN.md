# ollamas projesi — ihtiyaç CLI planı (roadmap-driven, sıralı)

Projenin gerçek ihtiyaçlarına göre (zero-dep TS CLI + /api+/mcp server + Node-SEA binary + brew + npm + Apple Shortcuts + agent fleet + audit/supply-chain). Genel harness CLI'ları → CLI-REGISTRY.md. Bu dosya: PROJE-SPESİFİK ihtiyaçlar.

## A) KURULU + proje-aktif → ENTEGRE EDİLDİ (add-cli, 2026-06-27)
| CLI | tier | proje-bağ |
|---|---|---|
| `shortcuts` | ask | v6 Apple Shortcuts pack (workflow run/list) — AKTİF kullanımdaydı, permissionsuzdu |
| `mandoc` | allow | v13 `man ollamas` `-Tlint` temizlik |
| `hf` | allow | adoption-research / HF model keşif |
| `depcheck` | allow | zero-dep unused-dep audit (CLAUDE.md "unused = sil") |

## B) ✅ KURULDU + ENTEGRE (brew + add-cli, 2026-06-27)
`brew install minisign syft grype git-cliff` ✓ → add-cli ile: minisign(ask) syft(allow) grype(allow) git-cliff(ask). Smoke: minisign 0.12, syft 1.46 (cli/ SBOM=0 comp = zero-dep ✓), grype 0.115, git-cliff 2.13.
| CLI | öncelik | proje-bağ | tier (eklenince) |
|---|---|---|---|
| `minisign` | HIGH | **v18 imza** — SEA binary + npm tarball + brew (Ed25519, $0, tek-dev; cosign overkill) | ask |
| `syft` | HIGH | SBOM (CycloneDX/SPDX) — audit-service satılabilir deliverable | allow |
| `grype` | HIGH | SBOM vuln tarama — Trivy ile çapraz-doğrulama | allow |
| `git-cliff` | HIGH | conventional changelog → `gh release` (proje conventional commit kullanıyor) | ask |

## C) ✅ npx-tabanlı OPERASYONEL (allow + slash, 2026-06-27)
Smoke ✓: spectral 6.16, knip 6.21, license-checker 25, mcp-inspector (local devDep). Permission allow + slash komutları kuruldu.
| araç | slash | proje-bağ |
|---|---|---|
| `@stoplight/spectral-cli` | `/openapi-lint` | OpenAPI lint `/api/openapi.json` |
| `mcp-inspector` (local devDep, `--cli`) | `/mcp-conform` | `/mcp` conformance (UI değil --cli!) |
| `knip` | `/deadcode` | ölü-kod/export (zero-dep enforcer) |
| `license-checker` | `/license-report` | audit-service lisans raporu |

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
