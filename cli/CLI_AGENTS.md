# CLI_AGENTS.md — ollamas CLI Forge Master Contract

> Bu doküman, **yalnız CLI geliştiren** çalışma sekmesinin değişmez sözleşmesidir.
> `AGENTS.md`'in (proje ana kontratı) CLI-scoped uzantısıdır; onunla çelişmez, onu daraltır.
> Kurallar yalnız bu dosyada değişir.

## §0 — North Star
ollamas için **tek, birleşik `ollamas` CLI** inşa etmek: gateway'i (LLM Mission Control)
terminalden + iPhone'dan (Shortcuts/HTTP) sürebilen, Mac+iOS'ta en verimli çalışma
prensiplerini benchmark'la bulan, sürdürülebilir, kesintisiz büyüyen istemci.

CLI = **üç yüzey, tek gateway**: (1) TS repo-içi ana CLI (`cli/`), (2) POSIX-curl köprü
(`cli/bin/ollamas.sh`, SSH/iSH), (3) Apple Shortcuts pack (v6).

## §1 — Scope Law (mutlak)
Bu sekme **yalnız CLI** üretir. CLI-dışı istek (server, frontend, SaaS iç mantığı, deploy)
→ **reddet**, ollamas ana sekmesine yönlendir. İstisna: CLI'ın tükettiği bir endpoint eksikse,
onu küçük ve choke-point-uyumlu ekleyip CLI'a dön.

## §2 — Roller
- **CLI Architect** — alt-komut mimarisi, flag sözleşmesi, versiyon sınırları
- **CLI Coder** — zero-dep TS, `node:util`/`node:readline`, saf-fonksiyon çekirdek
- **CLI Validator** — vitest; saf-fonksiyon testi + mock-fetch; regression guard (full suite)
- **Bench/Calibration Engineer** — Mac+remote dual-target; en verimli model/ctx/flag
- **iOS-Surface Engineer** — POSIX köprü + Shortcuts pack + remote-exposure
- **Logbook Keeper** — her hata `CLI_SEYIR_DEFTERI.md`'ye; aynı hata tekrar etmez

## §3 — Değişmez Yasalar (ihlal = hata)
1. **Choke-point**: CLI `server/tool-registry`'yi **import etmez**. Tüm tool yan-etkileri
   gateway'in `/mcp` veya `/api/*` üzerinden geçer → orada `ToolRegistry.execute`'a iner.
   CLI = ince istemci, ikinci dispatch yolu YOK. Gate (N-012): yorum mention'ları değil
   **gerçek import** hedefle → `grep -rn --include="*.ts" "from.*tool-registry\|require.*tool-registry" cli/` = boş (yalnız .ts; .md mention'ları hariç).
9. **Apple-signing gerçeği** (v6): compiled `.shortcut` = signed (AEA); unsigned dosya iOS'ta
   import EDİLEMEZ. CLI çift-tık iPhone binary üretmez → XML WFWorkflow plist scaffold + macOS
   `shortcuts import` re-sign + saf-iOS reçete kartı. iOS reçete daima `stream:false` (SSE yok).
2. **Zero-dep tercih**: repo ethos'u. Built-in (`node:util`, `node:readline`, `fetch`,
   `TextDecoder`) önce. Yeni runtime-dep eklemeden önce gerekçelendir + Architect onayı.
3. **Saf çekirdek**: parse/format/SSE-split saf fonksiyon → socket'siz test edilir.
   I/O (fetch/stdout/readline) ince kabukta. Test boot gerektirmez.
4. **TTY-aware**: renk yalnız gerçek TTY'de; `NO_COLOR` + `--json` rengi keser. SSH/iOS dostu.
5. **Evidence-before-claims**: "çalışıyor" = komutu çalıştır, çıktıyı göster. Canlı test
   gateway gerektiriyorsa **boot+test+kill TEK Bash çağrısında** (harness reap gotcha).
6. **Quality gate (pre-commit)**: `tsc --noEmit` ✓ → full `vitest run` (regression) ✓ →
   `npm run build:cli` ✓ → conventional commit (`feat(cli): …`).
10. **Secrets-at-rest** (v7): `apiKey`/`saasAdminToken` diske **sealed** yazılır
   (AES-256-GCM, `authTagLength:16` iki tarafta — `lib/secrets`+`lib/keystore`),
   asla plaintext. `open()` THROW eder (boş Bearer key yollama); I/O sınırı
   (`config load`) decrypt-hatasını **yakalayıp degrade** eder (uyar+düşür, crash
   etme — N-013). Env-secret (`OLLAMAS_API_KEY`) asla persist edilmez (N-014).
   Profil secret'leri izole; `--include="*.ts"` ile choke-point grep (N-012).

## §4 — Çalışma Döngüsü (her görev)
```
oku(CLI_SEYIR_DEFTERI + ROADMAP + memory)   # geçmiş hatalar + aktif versiyon
  → en-verimli-prompt kur (min token, max sinyal)
  → TDD: önce saf-fonksiyon testi, sonra impl
  → quality gate (§3.6)
  → logla (hata varsa CLI_SEYIR_DEFTERI; notable adım gateway logbook)
  → sıradaki adımı önceden-hesapla (bu versiyonun "done"u = sonraki ilk todo)
```

## §5 — Token Disiplini (min token, max performans)
- Progressive disclosure: gerekeni oku, dosyayı baştan sona okuma.
- Subagent yalnız **summary** döndürür ("Reply max 200 words / bullets only").
- Memory'yi tekrar okuma; recall context'te zaten var.
- Bağımsız aramalar TEK mesajda paralel (Tier-1).
- Yeni kod mevcut util'i reuse eder (`server/db.ts` SecureDB, `providers.ts` tok/s,
  `health_probe.mjs` mantığı). Önce ara, sonra yaz.

## §6 — Brain / Memory / Skills / "/" Kullanımı
| Tetik | Yüzey |
|-------|-------|
| impl/kod yaz | `/a1` (a1-coder) |
| doğrula/hata bul | `/a2` (a2-validator) |
| analiz/sıradaki phase üret | `/a3` (a3-swod) |
| tool/skill güncelle | `/a4` (a4-knowledge) |
| TDD | `superpowers-test-driven-development` |
| lint/test/diff/deps audit | `ecydev` |
| debug | `superpowers-systematic-debugging` |
| plan | `superpowers-writing-plans` |
| commit | `/commit` (caveman-commit) |
- Memory: `~/.claude/.../memory/project_ollamas_cli.md` = bu sekmenin kalıcı durumu (aktif versiyon, gotcha).
- Brain: `CLI_SEYIR_DEFTERI.md` her döngü başında okunur.

## §7 — Sıradaki-Versiyon Protokolü
Kullanıcı **"sıradaki versiyonu planla"** dediğinde:
1. `ROADMAP.md`'ten sonraki versiyonu aç.
2. O versiyonun phase + todo listesini **kesintisiz, eksiksiz** üret.
3. §4 döngüsüyle **kodla** (dur-kalk yok).
4. Quality gate + commit + `CLI_SEYIR_DEFTERI`/memory güncelle.
5. Bir sonraki versiyonun ilk todo'sunu önceden-hesapla.

## §8 — Permanence
Her gelecek görev §1 scope + §2 roller + §3 yasalar + §4 döngü ile yürür.
Sözleşme yalnız bu dosyada değişir; kod sonra.

## §9 — Sekme Kimliği Otomasyonu (CLI-ID, 0 manuel)
Kimlik/görev sorusu (*"görevin nedir / ne yaparsın / rolün ne"*) **asla bayat memory'den
veya ezberden** yanıtlanmaz. `cli/lib/role.ts` canlı durumu üretir: mission (§0) +
shipped/next versiyon (`cli/ROADMAP.md` ✅DONE/▶NEXT canlı parse) + VERSION (`cli/index.ts`) +
branch + son commit (git) + aktif gotcha'lar (`cli/CLI_SEYIR_DEFTERI.md` son `### (E|N)-`).
**Hardcode yok** → proje ilerledikçe yanıt otomatik tazelenir.

Otomasyon: proje-local `.claude/settings.json` UserPromptSubmit hook → `cli/bin/role-hook.ts`
soruyu `ROLE_QUESTION_RE` ile yakalar → `role.ts` çıktısını `additionalContext` enjekte eder;
eşleşmezse sessiz exit 0; role.ts patlarsa sessiz degrade (prompt asla bloklanmaz). Hook kaydı
**executable** olduğu için operatör onayı gerektirir (kurulum reçetesi `CLAUDE.md` §⟐); manuel
fallback `npx tsx cli/lib/role.ts`. Saf parser+renderer vitest ile test edilir (CLI-ID).
Adopte: orchestration vO-ID + tunnel whoami (in-repo desen). Veri otomatik / yapı manuel
(role.ts şablonu + CLAUDE.md §1–§3 ile senkron).
