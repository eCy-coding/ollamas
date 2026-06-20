# AUTOPILOT_SETUP — vO-AUTO 0-manuel aktivasyon (bir kerelik)

> Mekanizma KODLU + test'li (autopilot.ts / model-hook.ts / autopilot.plist). Ajan kendi
> başlangıç-config'ini (`.claude/settings.json`) otomatik düzenleyemez (harness guardrail:
> self-modification açık-izin ister). Aşağıdaki **iki bir-kerelik adım** 0-manuel'i açar.

## 1. Claude Code hook'ları (sekme açılışı + model-sorusu auto-inject)

`.claude/settings.json`'a şu `hooks` bloğunu yapıştır (mevcut role-hook KORUNUR):

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "$HOME/Desktop/ollamas/node_modules/.bin/tsx $HOME/Desktop/ollamas-orchestration-wt/orchestration/bin/autopilot.ts --quiet" }
      ]}
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "$HOME/Desktop/ollamas/node_modules/.bin/tsx $HOME/Desktop/ollamas-orchestration-wt/orchestration/bin/role-hook.ts" },
        { "type": "command", "command": "$HOME/Desktop/ollamas/node_modules/.bin/tsx $HOME/Desktop/ollamas-orchestration-wt/orchestration/bin/model-hook.ts" }
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

## Sonuç
İki adım sonrası: **0 manuel seçim** (model sorusu auto-cevap) + **0 manuel işlem** (sekme açılışı + bench değişimi + periyodik auto-tazeleme). Mekanizma `autopilot.ts` → benchprompt+conduct+status; hepsi read-only (§3), never-throw (bir parça patlasa diğerleri devam).
