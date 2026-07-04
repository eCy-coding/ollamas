# COUNCIL_PROMPT.md — ollamas Hibrit Model-Council (kalıcı master prompt)

> Kalıcı, paste-anywhere prompt. Roster verisi `COUNCIL_ROSTER.json`'dan canlı türetilir
> (bayatlamaz — `tsx orchestration/bin/council.ts` her koşuda `ollama list`'ten tazeler).
> İngilizce kaynak istek: `docs/REQUEST_EN.md`. Uçtan-uca bulgu: `docs/E2E_ANALYSIS.md`.

## 0. Misyon

18 yerel ollama modelini **yeteneklerine göre sorumluluk alanlarına** dağıtarak ollamas
projesini uçtan-uca (7 lane) analiz et; "hangi dil / hangi kod gerekli" sorusunu yanıtla; her
model iddiasını **deterministik `oracle` ile denetle** (prose ≠ kanıt); en verimli/doğru çalışma
prensibine (bulgu-0 + suite-green) kadar sürdürülebilir koş.

## 1. Değişmez prensipler (AGENTS.md §2 türevi)

1. **Root-cause önce** — semptom fix yasak.
2. **Evidence önce** — model "çalışıyor" demesi kanıt değil; `oracle` yer-gerçeğini hesaplar/çalıştırır.
3. **Tek-GPU disiplini** — aynı anda 1 yerel model + N cloud paralel (contention/timeout önler).
4. **CRITICAL gizleme yasak** — sessiz lane / RED bulgu / absent seat her zaman ilk sıra, saklanmaz.
5. **Yeni skorlayıcı yazma** — `server/council.ts:scoreCouncil` (single/best-of-N/majority) reuse.
6. **Kalıcı + oto-tazelenen** — roster hardcode değil; `ollama list` canlı + benchprompt wire.

## 2. Motor (hibrit)

```
Claude Code (kondüktör + denetçi)
  └─ 18 yerel model (analist)  ── yeteneğe göre seat  ──┐
       ├─ dispatch: POST /api/ai/generate {prompt,model}
       ├─ parse:    lib/council.ts parseFindings (LANG/TASK/RISK strict-format)
       └─ audit:    oracle/index.ts verify → TRUE/FALSE/UNDECIDABLE + KANIT
  └─ fallback: seat boş/hata → sıradaki capable seat (supervision)
```

## 3. Yetenek → sorumluluk (seat spec — canlı ROSTER özeti)

<!-- ROSTER:AUTO — council.ts her koşuda canlı roster'dan yeniden yazar; elle düzenleme -->
| Seat (yetenek) | Rol | Tercih modeli | Lane |
|----------------|-----|---------------|------|
| deep-code | architect | qwen3-coder:480b-cloud | backend, integrations |
| long-ctx-code | analyst | qwen3-coder-64k:latest | backend, orchestration |
| local-code | coder | qwen3-coder:30b | cli, scripts |
| reasoning | verifier | deepseek-r1:32b | backend, frontend, cli, scripts, integrations, bench, orchestration |
| vision | analyst | qwen2.5vl:32b | frontend |
| moe-mid | analyst | qwen3:30b-a3b | orchestration |
| fast-verify | reviewer | qwen3:8b | backend, frontend, cli, scripts, integrations, bench, orchestration |
| cheap-triage | triage | qwen3:4b | backend, frontend, cli, scripts, integrations, bench, orchestration |
| adversarial | adversary | gpt-oss:120b-cloud | backend, frontend, cli, scripts, integrations, bench, orchestration |
| big-reasoning | adversary | llama3.3:70b | backend, frontend, cli, scripts, integrations, bench, orchestration |
| cloud-alt | analyst | kimi-k2.5:cloud | bench |
| small-logic | analyst | phi4:latest | scripts |
| embedding | search | nomic-embed-text:latest | backend, frontend, cli, scripts, integrations, bench, orchestration |
| custom-review | reviewer | ollamas-reviewer:latest | backend, frontend, cli, scripts, integrations, bench, orchestration |
<!-- /ROSTER:AUTO -->

> Bir tercih modeli yüklü değilse seat sıradaki modele düşer; hiçbiri yoksa **absent** olarak
> raporlanır (gizlenmez). Canlı doğru tablo: `COUNCIL_ROSTER.json`.

## 4. Lane analist görevi (dispatch prompt sözleşmesi)

Her analist STRICT satır formatında yanıtlar (fuzzy NLP yok, deterministik parse):
```
LANG: <lane'in çalışma gerektiren dilleri/stack>
TASK: <ilerletmek için somut kod işi>   (tekrarlı, max 6)
RISK: <bug/risk/borç — yoksa satırı atla>
```

## 5. Çalıştırma

```bash
tsx orchestration/bin/council.ts                 # light: roster tazele + cached özet (autopilot-safe <60s)
tsx orchestration/bin/council.ts --lane backend  # tek lane derin analiz
tsx orchestration/bin/council.ts --all           # 7 lane uçtan-uca → docs/E2E_ANALYSIS.md
tsx orchestration/bin/council.ts --all --json    # makine çıktısı
```

## 6. Convergence ("en doğru prensibe kadar")

autopilot 30-dk loop council-light adımını içerir. Kriter: `conduct.ts` priority-engine
bulgu-0 verir + orchestration vitest suite green → idempotent (yeni-delta-yok) = dur.
Ağır `--all` pass bayatladığında (bench-lane deseni) uyarı + opt-in refresh.
