# SCRIPTS_AGENTS.md — ollamas "Scripts" Domain Master Prompt

> **Bu, `scripts` domain'inin operasyon sözleşmesidir.** Canonical `AGENTS.md` (repo kökü, §0-§8) ve `SEYIR_DEFTERI.md`'nin **alt-sözleşmesi**dir. Çelişki olursa canonical kazanır; bu dosya yalnızca *daraltabilir* (daha katı), asla gevşetemez.
>
> Bu sözleşmeyi yürüten her ajan (Claude Code dahil) bir göreve başlamadan **önce** şu sırayı uygular: `errors_registry.json` oku → `ROADMAP_SCRIPTS.md` ilgili versiyon + "next precomputed" bloğunu oku → bu dosyanın §3/§4/§6'sını doğrula → işe başla.

---

## §0 — North Star

`scripts` = ollamas'ın **host-execution & cross-device delivery katmanı**. Her değişiklik şu üçünden en az birini yapmalı:
1. bir host işlemini **hızlandırmalı**,
2. bir host işlemini **güvenlileştirmeli**,
3. yeteneği **yeni bir cihaza** (iOS) ulaştırmalı.

Bu üçünden hiçbirini yapmıyorsa, iş değildir — yapma.

## §1 — Subordination (Tabiiyet)

- `AGENTS.md` §0-§8 **aynen** miras alınır. Bu dosya onları tekrar yazmaz; bağlar.
- Yeniden bağlanan (re-bind) maddeler, bu domain için **zorunlu**:
  - **Choke-Point Law (canonical §4)** → bkz. §4 aşağıda.
  - **Quality Gate (canonical §3)**: `tsc --noEmit` → lint → `vitest run` (fresh) → conventional commit. Fail = commit yok.
  - **Security Hard Laws (canonical §5)**: tier `safe | host | privileged`. Host-tier gerçek shell çalıştırır; export öncesi allowlist + audit.
  - **Logbook (canonical §6)**: domain logbook = `SEYIR_DEFTERI_SCRIPTS.md` + `errors_registry.json`.
- Çelişki çözümü: canonical > bu dosya > varsayılan davranış. Kullanıcının açık talimatı (CLAUDE.md / direkt istek) her şeyin üstünde.

## §2 — Roller (scripts-özel)

| Rol | Sorumluluk alanı | Dosyalar |
|-----|------------------|----------|
| **Bridge Engineer** | host-bridge protokolü, HMAC parity | `bin/host-bridge/*.mjs`, `bin/host-bridge/tools/*.mjs` |
| **Shell Hardening Officer** | POSIX/BSD portability, `set -euo pipefail`, shellcheck | root `*.sh` |
| **iOS Delivery Engineer** | Shortcuts + Swift CLI köprüsü, HTTP/MCP-only | `bin/ios-bridge/**` (v3+) |
| **Bench/Calibration Analyst** | en verimli yöntem ölçümü, donanım profili | `bin/host-bridge/benchmark.mjs`, `bin/scripts/calibrate_hardware.py` |
| **Registration Engineer** | script-tool → ToolRegistry seam | `server/tool-registry.ts` + `server.ts` (sadece register çağrı-yeri) |
| **Observability Engineer** | seyir event, error-rate SLO | `bin/host-bridge/tools/logbook.mjs`, `SEYIR_DEFTERI_SCRIPTS.md` |

Tek ajan birden çok rol taşıyabilir; ama her diff **tek rolün** kapsamında gerekçelendirilir.

## §3 — Scope Law (İhlal = Dur)

**MAY touch (dokunabilir):**
- root `*.sh` (start/stop/setup/install/setup-keys/join-cluster/uninstall)
- `bin/host-bridge/**` (bridge + benchmark + test-bridge + `tools/` 16 mjs)
- `bin/scripts/**` (`system_health.py`, `calibrate_hardware.py`, `tool_generator.py`)
- `scripts/*.ts` (`master_e2e_workflow.ts`, `e2e_verify.ts`) + yeni `scripts/tests/**`
- `Makefile`
- `bin/ios-bridge/**` (v3+ yeni)
- **SADECE** register-seam: `ToolRegistry.register()` / `unregisterByPrefix()` çağrı-yeri + `ToolDeps` wiring.

**MUST NOT touch (dokunamaz):**
- `src/**` (UI / React)
- `server/{mcp,store,billing,middleware}` iş-mantığı
- `server.ts` içindeki ReAct loop iç mantığı
- `server/tool-registry.ts`'in `execute()` dispatch mantığı (sadece register seam'i, dispatch'i değil)

Register-seam dışında server'a derin değişiklik gerekiyorsa: **dur, escalate et** (kullanıcıya sor). Kendi başına yapma.

## §4 — Choke-Point Yeniden-Onay

- Hiçbir script, `ToolRegistry.register(name, { tier, schema, invoke })` dışında agent-callable **olamaz**. İkinci dispatch yolu yok.
- Yeni host tool = `bin/host-bridge/tools/` altında bir `.mjs`; `execOnHost("node ${HOST_TOOLS_DIR}/x.mjs ...")` thunk'ı ile çağrılır (mevcut `run_tests.mjs` / `lint_format.mjs` desenini aynala).
- Her host-tier tool plan-allowlist + security audit geçmeden export edilmez.

## §5 — "En Verimli Prompt" Prensibi

- Her versiyon, işi sıfırdan üreten **minimal tek-paragraf canonical prompt**'u `ROADMAP_SCRIPTS.md`'e yazar. ("Bu versiyonu üretmek için ajan'a verilecek en küçük talimat.")
- Çalışma kuralı: **en küçük diff, en az token**. Dosyanın zaten kodladığı context'i tekrar anlatma. Yorumlar yalnız **WHY** (non-obvious); WHAT/HOW değil.
- "Verimli yöntem" iddiası **ölçümle** desteklenir (§7 evidence). Tahminle değil.

### §5.1 — Adoption Map (vibe-coding yasak: çalışan kod adopte et)

Her versiyon, sıfırdan kod yazmadan önce en-yıldızlı **MIT/Apache/BSD/ISC** repodan çalışan kod/desen adopte eder. GPL (örn. shellcheck) yalnız **araç** olarak çağrılır, kod kopyalanmaz. Her adoptede kaynak + lisans attribution (yorum satırı).

| Faz | Repo (lisans) | Adopte |
|-----|---------------|--------|
| v5 | `modelcontextprotocol/typescript-sdk` (MIT/Apache) · `colinhacks/zod`+`zod-to-json-schema` (MIT/ISC) | registerTool sözleşmesi · manifest→schema doğrulama |
| v6 | `bats-core` (MIT) · `mvdan/sh` shfmt (BSD-3) · `koalaman/shellcheck` (GPL=araç) · `dylanaraps/pure-bash-bible`+`pure-sh-bible` (MIT) | .sh unit test · format · lint · BSD/GNU portable snippet |
| v7 | `tjluoma/launchd-keepalive` (MIT) | KeepAlive/SuccessfulExit self-heal plist |
| v8 | `pinojs/pino`+`pino-pretty` (MIT) | JSONL seyir event + CLI dashboard |
| v9 | `ralfebert/PersistentURLRequestQueue` (MIT) | iOS offline queue + flush (Swift) |
| v9/v10 | `apple/swift-crypto` (Apache) | CryptoKit HMAC Wycheproof parity |
| v10 | `rhysd/actionlint` · `bewuethr/shellcheck-action` | macOS CI matrix + workflow/drift gate |

## §6 — Trigger Protokolü: "sıradaki versiyonu planla"

Emre **"sıradaki versiyonun todo + phase list'ini planla"** (veya "sıradaki versiyonu planla") dediğinde, **kesintisiz** şu zincir koşar — ara soru yok:

```
1. READ   errors_registry.json (tekrarlanacak hata var mı?) + ROADMAP "next precomputed" bloğu + §5.1 Adoption Map (o faz hangi repo/desen)
2. PLAN   o versiyonun phase/todo listesini netleştir (TodoWrite)
3. TDD    önce test (vitest / dry-run harness), sonra implementasyon
4. CODE   en küçük diff, §3 scope içinde
5. GATE   tsc --noEmit → lint/shellcheck → vitest run (fresh) → yeşil
6. LOG    SEYIR_DEFTERI_SCRIPTS.md + errors_registry.json güncelle; bir sonraki versiyonu precompute et
7. COMMIT conventional commit (feat|fix|refactor|chore|docs|test(scripts): ...)
```

**Tek durma koşulu:** §3 Scope ihlali veya §5 security ihlali zorlanırsa dur ve sor. Başka hiçbir şey için durma.

## §7 — Min-Token / Max-Perf Çalışma Kuralları

- **Paralel Tier-1 okuma**: bağımsız Explore/read tek mesajda.
- **Evidence-before-claim**: "çalışıyor" demeden önce komutu koş, çıktıyı gör (shellcheck, vitest, benchmark). Çıktı yoksa iddia yok.
- **CRITICAL gizleme yasak** — her zaman ilk sıra.
- **Unused script sil** — commit etme.
- Sub-agent prompt'ları kısa tutulur ("max N words / bullets"); sadece summary ana thread'e döner.

## §8 — Brain / Memory / Skills / "/" Sistemleri Kullanımı

- **Kod öncesi**: `errors_registry.json` + (varsa) skill_store oku — a1-coder deseni.
- **Read-only Tier-1 skill'ler** (analiz için, kod yazmadan): `tob-shellcheck` benzeri shell lint, `tob-semgrep`, `tob-c-review` (Makefile C hedefleri), `superpowers-test-driven-development`.
- **Kod sonrası**: yeni hata sınıfını `errors_registry.json`'a yaz — a2-validator deseni.
- **Memory**: bu sekmenin Scope Law'ı `project_ollamas_scripts.md`'de pinli. Stale memory'ye güvenme; dosyaları/test'i oku.
- **"/" sistemleri**: `/commit` (caveman-commit), `/review` (ag-code-reviewer) commit öncesi opsiyonel; `/verify` ship öncesi.

## §9 — Error-Logbook Disiplini

- `errors_registry.json`'daki bir hatayı **asla tekrarlama**. Tekrarlarsan `recurrence_count++` ve bu bir **proses hatası**dır — prevention_rule yetersiz demektir, güçlendir.
- Her fix bir **prevention_rule** ekler (gelecekte aynı sınıfı engelleyen tek cümle).
- Her phase ve her hata `SEYIR_DEFTERI_SCRIPTS.md`'e işlenir (kanıt/komut çıktısı ile).

---

## Komşu Sekme İzolasyonu (kritik)

`ollamas CLI` sekmesi izole worktree `~/Desktop/ollamas-cli-wt` (branch `feat/cli-v2-clean`) içinde `cli/`'yi geliştirir. Bu (scripts) sekme farklı dizinlere dokunur ama **aynı repo**dur. Kural: scripts işi kendi branch'inde (`feat/scripts-v1`) yürür; **her commit öncesi `git status` ile cross-tab kirlilik kontrolü zorunlu**. `cli/` altında değişiklik görürsen — dur, senin işin değil.

## Baseline (değişmez referans)
- Test: `npm test` = `vitest run` → **68 pass / 1 skip**. Build: `npm run build`. Dev: `tsx server.ts` :3000.
- Choke-point: `server/tool-registry.ts` → `ToolRegistry.execute(name, args, ctx)`.
- HMAC canonical msg: `METHOD\nPATH\nBODY\nTIMESTAMP\nNONCE` (`server/bridge-hmac.ts` ↔ bridge mirror, byte-identical).
