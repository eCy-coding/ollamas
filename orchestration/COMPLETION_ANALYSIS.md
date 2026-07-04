# COMPLETION_ANALYSIS — ollamas tamamlanma durumu + 2-makine yol haritası

> Salt-okunur e2e analiz (2026-06-29, Windows↔Mac fleet). Kaynak: `doctor.ts`, `DOD.json`, `NEXT_TODO.md`,
> `STATUS.md`, git, ollama envanteri. **Kod değiştirmez** — durum + güvenli öncelikli yol haritası.

## 1. Tamamlanma metrikleri
| Ölçü | Değer | Not |
|------|-------|-----|
| Test suite | **832 passed / 13 skip / 0 fail** | yeşil |
| DOD completeness | **34/100** | öz-denetim (`dod.ts`) |
| Autopilot readiness (`doctor`) | **GO** (1 uyarı) | hook'lar + launchd yüklü; uyarı: bench 2 gün bayat |
| Yarım iş (test'siz kod) | **0** | temiz |
| Git | 97 branch · 67 `audit/*` · 12 worktree · 46 dirty · 24 untracked | **eşzamanlı agent'lar aktif** |

## 2. 2-makine + model rol modeli (çalışma prensibi)
| Lane | Makine | Model(ler) | İş |
|------|--------|-----------|----|
| **Fast-warm verifier/quick** | 🪟 Windows RTX 3060 Ti 8GB | `qwen3:8b` (FLASH_ATTN, warm) | doğrulama, hızlı kod, embedding |
| **Orchestrator + ağır-lokal** | 🍎 Mac M4 Max | `qwen3-coder:30b/64k`, `deepseek-r1:32b`, `gpt-oss:20b`, `llama3.3:70b` | gateway:3000, agent/UI, cloud-broker |
| **Ağır implementer** | ☁️ cloud | `qwen3-coder:480b`, `gpt-oss:120b`, `kimi-k2.5` | 480b implementer (MODEL_SELECTION) |

Prensip: rutin doğrulama Windows CUDA'da sürekli-warm; ağır akıl-yürütme cloud'da; kontrol Mac'te → hiçbir makine kasmaz.

## 3. NEXT_TODO triyajı — KANITLA (done / FP / GERÇEK-kalan)
| Madde | Severity | Durum (kanıt) |
|------|----------|----------------|
| CI shell-injection (`release-binary.yml`) | 🔴 P0 | ✅ **DONE** — `env: REF: ${{github.ref_name}}` + `gh release upload "$REF"` (satır 82-85) |
| path-traversal ×4 (`server/files.ts`) | 🔴 P0 | ✅ **GUARD/FP** — `resolveSafePath` root-confinement zaten var (nosemgrep gerekçeli) |
| command-injection (`commander.ts`/`terminal.ts`) | 🔴 P0 | ✅ **GUARD/FP** — execFile/allowlist; shell-string yok |
| Uncommitted WIP (18-46 dosya) | 🔴 P0 | ⏳ **concurrent agent'ın işi** — koordine (bana ait değil) |
| npm audit (7, 1 high `tmp`) | 🟡 P1 | 🔧 **GERÇEK-kalan** — `npm audit fix` (lock değişir → WIP riski) |
| dynamic-regexp ReDoS ×18 | 🟡 P1 | 🔧 **GERÇEK-kalan** (çoğu düşük) — gerçek olanları anchor/escape |
| Vite HMR 24678 reboot çakışması | 🟡 P1 | 🔧 dev-only — shutdown'da `server.close()` |

**Sonuç:** P0 güvenlik fiilen **kapanmış/FP**; gerçek-kalan tamamlanma yükü = (a) git konsolidasyonu, (b) P1 hardening (npm-audit/ReDoS/HMR), (c) concurrent SEYIR-entry'ler — projenin **kendi autopilot'u** bunları sürüyor.

## 4. Git konsolidasyon (öneri — destruktif, OTOMATİK YAPILMAZ)
67 `audit/*`: `git branch --merged` ile merged olanları tespit→onayla→sil; 12 worktree: stale olanları `prune`.
46 dirty: concurrent agent commit'leyecek (DOD "commit'siz yeşil iş" lapse'i). **Ben dokunmam.**

## 5. Faz-3 için seçilen item (gerçek · clean · doğrulanabilir)
**Aday-1 (önerilen):** gerçek bir **ReDoS** (clean dosyada) → anchor/escape + birim test → semgrep gate yeşil.
**Aday-2:** P0-FP'leri resmen kapat: `// nosemgrep: <kural> — <gerekçe>` + guard-testi.
Seçim Faz-2 sonrası (fleet sağlıklıyken) kesinleşir; implementer=Windows GPU, verifier=test+semgrep+**Truth-Oracle**.

## 6. Güvenli öncelikli yol haritası
1. **Fleet sağlığı** (pileup temizle, load↓) → autopilot/agent verimli koşsun.
2. **Bench tazele** (`doctor --fix`) → en-verimli-model seçimi güncel.
3. **Tek gerçek P1** e2e (fleet+oracle) — örnek tamamlanma ilmiği.
4. (kullanıcı onayıyla) git konsolidasyon + concurrent WIP commit.
