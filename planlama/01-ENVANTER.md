# 01-ENVANTER — P0 baseline (commit-damgalı, yeniden hesaplanabilir)

> Odysseus `specs/architecture-runtime-inventory.md` pattern'i: her sayı damgalı + recompute
> komutu verili. Sayılar ESKİMİŞ olabilir — karar vermeden önce komutu yeniden koş (08-PROTOKOL
> drift kuralı: haftalık recompute).

## Damga

```text
commit : c5ac42d (feat/key-autonomy, main checkout)
tarih  : 2026-07-10T09:22:22Z
ölçen  : fable-5 planlama oturumu (read-only)
```

## Envanter matrisi (değer + recompute komutu)

| Metrik | Değer (damga anı) | Recompute komutu |
|---|---|---|
| Aktif branch | `feat/key-autonomy` | `git branch --show-current` |
| Worktree sayısı | **19** (13 Desktop lane + 6 iç `.claude/worktrees/`) | `git worktree list \| wc -l` |
| Toplam branch | **137** | `git branch -a \| wc -l` |
| `audit/*` branch | **67** (karar bekliyor: entegre/arşiv/sil) | `git branch --list 'audit/*' \| wc -l` |
| Test dosyası (*.test/spec.ts[x]) | **1534** | `find . -path ./node_modules -prune -o -type f \( -name "*.test.ts*" -o -name "*.spec.ts*" \) -print \| grep -v node_modules \| wc -l` |
| Son bilinen full-suite | 832 passed / 13 skipped / 0 failed (NEXT_TODO 2026-06-21) + 116 dosya/803 test (MCP lane, SEYIR) | `vitest run` (FRESH — uzun sürer) |
| API route (server.ts) | **119** | `grep -cE 'app\.(get\|post\|put\|delete\|patch)\(' server.ts` |
| Tool tier kaydı (tool-registry) | **35** `tier:` girdisi | `grep -cE 'tier:\s*"' server/tool-registry.ts` |
| DB migration versiyonu | **6** | `grep -cE 'version:\s*[0-9]' server/store/migrations.ts` |
| TS/TSX LOC (src+server+cli+backend+orchestration) | **61 372** | `find src server cli backend orchestration -type f \( -name "*.ts" -o -name "*.tsx" \) \| xargs wc -l \| tail -1` |
| i18n locale | **2** (en, tr) | `ls src/locales/` |
| npm audit | **3 moderate / 0 high / 0 critical** | `npm audit --json \| node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).metadata.vulnerabilities"` |
| package.json version | `0.0.0` (name `react-example` — hijyen borcu, bkz. GAP-020) | `node -p "require('./package.json').version"` |
| npm script sayısı | 40 (build/test/e2e/perf/conformance/ops…) | `node -p "Object.keys(require('./package.json').scripts).length"` |
| semgrep | kurulu (`/opt/homebrew/bin/semgrep`) | `which semgrep` |

## Lane envanteri (Desktop worktree'ler)

| Worktree | Branch | Lane misyonu (kaynak: lane doküman/memory) |
|---|---|---|
| ollamas (main checkout) | feat/key-autonomy | kondüktör + key-autonomy (hardware-vault, key-health) |
| ollamas-cockpit-wt | feat/cockpit-v1 | cockpit UI |
| ollamas-colab-wt | feat/colab-gpu | Colab façade + Gemini bug-detect |
| ollamas-converge-wt | integration/all-lanes | lane birleştirme entegrasyonu (PR #9 hedefi) |
| ollamas-ecy-wt | fix/audit-security | güvenlik audit fix lane'i |
| ollamas-fable-wt | feat/fable-do-calibration | fable-tier designer + `ollamas do` kalibrasyon |
| ollamas-flow | feat/flow-v1 | flow lane |
| ollamas-gwv2-verify-wt | verify/gwv2-all-lanes | gateway-v2 cherry-pick doğrulama |
| ollamas-gwv2-wt | feat/gwv2-cherrypick | gateway-v2 cherry-pick |
| ollamas-revenue-wt | feat/revenue-first-payment | revenue / ilk ödeme |
| ollamas-shipgate-wt | feat/v2-shipgate | ship-gate / release |
| ollamas-ux-wt | feat/ux-e2e | UX e2e (UX-001..010) |
| ollamas-verify-wt | fix/binary-architecture-calibration | binary kalibrasyon doğrulama |

İç worktree'ler (6): `fix/audit-cont`, `feat/completion-integration`, 4× `claude/*` oturum dalı
— hijyen denetimi 06-KOR-NOKTA #13.

Recompute: `git worktree list`

## Modül haritası

Tam modül/mimari envanteri (sorumluluk · choke-point · invariant · risk · anchor) ayrı dosyada:
**`11-MIMARI.md`** (§1 server.ts, §2 tool-registry, §3 store, §4 providers, §5 billing, §6 backend,
§7 tunnel, §8 cli, §9 src, §10 orchestration, §11 CI). Aşağıdaki tablo yalnız P2+ risk-özeti.

## Modül risk tablosu (P2+ fazlarının odak sırası)

> **⚠️ Bu tablo S-001 reconcile (2026-07-10) ile güncellendi** — ilk sanılan YÜKSEK riskler canlı
> kod okumasıyla mitige/FP çıktı. Ayrıntı: 03-GAP DURUM sütunu + 11-MIMARI.

| Modül | Risk (reconcile) | Gerekçe (canlı anchor) |
|---|---|---|
| `server.ts` (119 route) | ORTA→test-boşluğu | auth-boundary: `localOwnerGuard` (276-294) SaaS'ta tehlikeli prefix'leri 403'lüyor — **RCE mitige**; kalan = guard test-coverage yok (M-001/002). Owner-only, per-tenant auth tasarım-gereği yok. |
| `server/commander.ts` | DÜŞÜK (FP) | `:46` zaten `execFile` argv-array (shell yok); yorum 6-9 eski `exec()` sink'inin kaldırıldığını belgeliyor. Yalnız regresyon testi (M-003). |
| `server/store/migrations.ts` | DÜŞÜK | version-uniqueness assert **MEVCUT** (170-181); divergent-lane collision yalnız MERGE-anı (M-012/015). |
| `server/providers.ts` | ORTA | `safeParse` (204) tool-call JSON'u sarıyor (FP); gerçek risk = 429 cooldown sabit 6h + latencyCache reorder yok (ROADMAP T2.1/2.2 → P4 perf). |
| `.github/workflows/release-binary.yml` | DÜŞÜK (FP) | `REF: ${{github.ref_name}}` **env ara-değişken** (86); interpolation-injection yok. Yalnız lint (M-008). |
| `db.ts` (cloud key) | ORTA (darwin-dışı) | Cloud'da boot-başı `randomBytes(32)` → ciphertext kaybı (ROADMAP T3.1; M-020). Darwin'de tetiklenmez. |
| `server/files.ts`, `server/commander.ts` (path-traversal) | DÜŞÜK (FP) | `resolve`+`startsWith(root+sep)` guard MEVCUT (commander.ts:35-38). **Yeniden P0 yapma.** |
| `server/threatfeed.ts` (ReDoS) | DÜŞÜK | dynamic `new RegExp` (72-73) — `name` kaynağı audit (M-009); repo-geneli yalnız 3 `new RegExp` server/'da. |

## Bilinen borçlar (envanter anı)

- Uncommitted WIP riski: çok-sekme WIP doğal hal; "uncommitted-green STALE" metriği FP gürültülü
  (SEYIR Faz 33 dersi) — yabancı lane'in yarım işini commit'leme.
- `PLAN.md` (kök) eski "Genesis Cluster Mesh 2026 roadmap" — canonical değil (bkz. 08-PROTOKOL §4).
- 13 skipped live-e2e (gerçek-infra gated) — gerekçe belgeleme borcu.
