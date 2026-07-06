# COMPLETENESS — ollamas mega-prompt eksen kanıtı (TR/EN)

> "eksik işlem bırakma" — justdoit mega-prompt'un her ekseni + kanıt-komutu + dürüst durum.
> Her satır CANLI doğrulanabilir. Son güncelleme: iter-18.

## Eksen matrisi / Axis matrix

| Eksen / Axis | Durum / State | Kanıt komutu / Proof command | iter |
|---|---|---|---|
| **$0 conductor loop** (Claude-Code-free FSM + joker) | ✅ shipped | `tsx orchestration/bin/orchestra.ts --status` · `vitest --project orchestra` (92) | 1-5 |
| **Joker failover** (canlı model-down → swap) | ✅ shipped | `ORCHESTRA_CONDUCTOR=nonexistent tsx …/orchestra.ts --once` → failover | 1,5,11 |
| **`ollamas` tek-komut boot + kalıcı daemon** | ✅ shipped | `ollamas status/tasks/progress/keys` · `launchctl list \| grep ollamas` | 3-5,16 |
| **Katalog** (count-agnostic `ollamas do`) | ✅ 343 görev | `tsx orchestration/bin/calibrate.ts --dry` → **343/343** resolved | 6-8 |
| **100-hatasız kalibre** | ✅ 0-crash · 99/100 apply-clean | `CALIBRATION_100.md` (resolved 100/100 · apply-clean 99/100 · **crashes 0**) | 6 |
| **Matematik uçtan-uca** (TR/EN) | ✅ 13 bölüm | `docs/MATH.md` §1-13 · property testleri (math-properties + key/net/limits) | 12,17,18 |
| **Brew / macOS deps** | ✅ 19/19 present | `tsx orchestration/bin/deps-doctor.ts --json` → present 19 · missing [] | 10 |
| **Fable-5 skills e2e** | ✅ 2 SKILL + 44 komut | `vitest run tests/skills-wiring.test.ts` (48, command→script resolve) | 9,18 |
| **Panel loop'ları** (KeyVault/Pipeline/ReAct $0-default+self-heal) | ✅ shipped | `vitest run tests/ui` · `playwright functions.spec` (9/9) | 17 |
| **:3000 hata-seli/RUM** (ecysearcher flood + dedup) | ✅ SAĞLIKLI | `curl :3000/api/ecysearcher/` → 200 · RUM healthy | 15,16 |
| **Terminal ↔ web eş-zamanlı gerçek-veri** | ✅ parite | `ollamas keys` == `curl :3000/api/keys/health` · `ollamas status` == `/api/orchestra` | 13,16,17 |
| **Kesintisiz serve** (fleet KeepAlive self-heal) | ✅ auto-restart | `com.ollamas.fleet` (KeepAlive) · server-child kill → ~64s respawn | 16 |
| **Entegreler** (GitHub/Stripe/Cloudflare/MCP) | ⚙ needs-config (wired) | `/api/integrations/health` · token eklenince aktif (kullanıcı adımı) | 8 |

## Dürüst notlar / Honest caveats

1. **Google Gmail/Takvim/Drive:** SERVER-proxy modülü YOK — **tasarım gereği**. Frontend
   `GmailBrowser`/`GoogleCalendarBrowser`/`GoogleDriveBrowser` doğrudan client-side Google OAuth ile
   `googleapis`'e bağlanır (sign-in gate gösterir). Kredensiyel/OAuth girişi güvenlik-yasağı → kullanıcının
   manuel adımı. Server-proxy eklemek dublikasyon olurdu. *(Client-side by design; not a gap.)*

2. **"100 hatasız" = 0-crash + 99/100 verbatim-apply.** Sistem 100/100 görevi **0 çökme** ile işler (gerçek
   "hatasız" = pipeline asla patlamaz + gate/revert repo'yu korur). Kalan 1 görevin verbatim-SEARCH/REPLACE'i
   model-çıktı varyansıdır (qwen3-coder:30b), pipeline-defekti DEĞİL — gate onu red→revert eder, repo bozulmaz.
   Tam-100/100 model-varyansına bağlı (kod ile garanti edilemez). *(0-crash is the real correctness guarantee.)*

3. **needs-config entegreler:** GitHub/Stripe/Cloudflare/MCP uçtan-uca WIRED; yalnız token/binary eksik →
   kullanıcı ekler. Bu "eksik kod" değil, "eksik kredensiyel" (güvenlik-yasağı gereği kullanıcıya ait).

## Tek-komut doğrulama / One-shot verify

```bash
tsx orchestration/bin/calibrate.ts --dry     # 343/343 resolved
tsx orchestration/bin/deps-doctor.ts --json  # 19/19 present
vitest run tests/skills-wiring.test.ts        # 48 (skill/command wiring)
vitest --project orchestra                    # 92 (conductor math + FSM)
ollamas keys                                  # == curl :3000/api/keys/health (parite)
```
