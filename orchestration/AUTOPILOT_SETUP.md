# AUTOPILOT_SETUP — vO-AUTO 0-manuel aktivasyon (bir kerelik)

> Mekanizma KODLU + test'li (autopilot.ts / model-hook.ts / autopilot.plist). Ajan kendi
> başlangıç-config'ini (`.claude/settings.json`) otomatik düzenleyemez (harness guardrail:
> self-modification açık-izin ister). Aşağıdaki **iki bir-kerelik adım** 0-manuel'i açar.

## ⚡ TEK KOMUT (önerilen — vO-FND.2)

```bash
bash orchestration/bin/activate.sh            # settings.json hook patch + launchd + doctor doğrula
bash orchestration/bin/activate.sh --dry-run  # önce ne yapacağını gör (dosya YAZMAZ)
```

Idempotent: hook'lar varsa ekleme yapmaz; mevcut `role-hook` korunur. Bu komut `settings.json`'ı
yazar (senin yetkin) → SessionStart→autopilot + UserPromptSubmit→model-hook + launchd agent + doctor GO.
Manuel istersen aşağıdaki 2 adımı kendin yap:

## 1. Claude Code hook'ları (sekme açılışı + model-sorusu auto-inject)

`.claude/settings.json`'a şu `hooks` bloğunu yapıştır (mevcut role-hook KORUNUR):

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/node_modules/.bin/tsx ${CLAUDE_PROJECT_DIR}/orchestration/bin/autopilot.ts --quiet" }
      ]}
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/node_modules/.bin/tsx ${CLAUDE_PROJECT_DIR}/orchestration/bin/role-hook.ts" },
        { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/node_modules/.bin/tsx ${CLAUDE_PROJECT_DIR}/orchestration/bin/model-hook.ts" }
      ]}
    ]
  }
}
```

- **SessionStart → autopilot.ts**: sekme açılır açılmaz MODEL_PROMPT+CONDUCTOR+STATUS tazelenir, özet context'e enjekte (0-manuel-işlem).
- **UserPromptSubmit → model-hook.ts**: "hangi model / en verimli model" sorusu → MODEL_PROMPT.md (benchmark-kanıtlı) otomatik enjekte (0-manuel-seçim).

## 2. launchd agent (bench değişimi + periyodik, arka plan)

```bash
bash orchestration/bin/autopilot-install.sh load     # plutil-lint + launchctl load
# durdur:  bash orchestration/bin/autopilot-install.sh unload
# durum:   bash orchestration/bin/autopilot-install.sh status
```

- **WatchPaths `~/.llm-mission-control`**: bench JSON değişince autopilot auto-koşar.
- **StartInterval 1800s + RunAtLoad**: 30dk'da bir + yüklenince. `heartbeat.plist`'ten ayrı (o periyodik conduct).

## 3. (vO27 opsiyonel) sürekli fleet reconcile daemon

Autopilot zaten her SessionStart `dispatch` adımıyla 0-manuel reconcile koşar (`bin/reconcile.ts` → `RECONCILE.md`). SÜREKLİ (saniye-saniye değil, watch-loop) daemon isteniyorsa `reconcile.plist` (K8s-operator level-based, `--watch`):

```bash
plutil -lint orchestration/reconcile.plist
launchctl load  -w ~/Library/LaunchAgents/com.ollamas.orchestration.reconcile.plist   # kopyala+load (operatör onayı)
launchctl unload   ~/Library/LaunchAgents/com.ollamas.orchestration.reconcile.plist   # durdur
```

- **`--watch` + KeepAlive**: "runs forever without manual ticks" — her tick dispatchdoctor probe → reconcile → `RECONCILE.md`; delta-notify yalnız aksiyon değişince (alert-fatigue guard).
- Privileged (launchctl) → auto-install YOK; operatör yükler (activate.sh guardrail). Autopilot `dispatch` adımı çoğu durumda yeterli — daemon yalnız oturum-dışı sürekli izlem için.

## Sonuç
İki adım sonrası: **0 manuel seçim** (model sorusu auto-cevap) + **0 manuel işlem** (sekme açılışı + bench değişimi + periyodik auto-tazeleme). Mekanizma `autopilot.ts` → benchprompt+conduct+status; hepsi read-only (§3), never-throw (bir parça patlasa diğerleri devam).
