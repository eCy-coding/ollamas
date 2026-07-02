# AUTOMATOR_BEST.md — best install-ready daily automation (auto-generated)

> Auto: `tsx orchestration/bin/automator-best.ts` · 2026-07-02T13:06:58Z. Ranks the daily-loop's recurring automations,
> validates the top candidates (plutil -lint + bash -n — syntax only, never executed) and packages the
> best VALID one into `~/Desktop/ollamas-daily/BEST/` with a one-command install. Nothing is installed
> or run — `launchctl load` stays the operator's explicit choice.

## Winner: `ollamas-reviewer:latest` (score 25, ✅ validated)

- Files: `.gitignore` [other], `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell]
- Mechanism: launchd · validation: plist OK · script OK

### Install (one command)
```bash
cp ~/Desktop/ollamas-daily/BEST/com.ollamas.daily-health.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.ollamas.daily-health.plist
```

## Ranking — who produced what (10 recurring)

| # | Model | Score | Mechanism | Files | Kinds |
|---|-------|-------|-----------|-------|-------|
| 1 | `ollamas-reviewer:latest` | 25 | launchd | 4 | other, plist, readme, shell |
| 2 | `qwen2.5vl:32b` | 25 | launchd | 4 | other, plist, readme, shell |
| 3 | `qwen3:8b-16k` | 24 | launchd | 3 | plist, readme, shell |
| 4 | `qwen2.5vl:7b` | 24 | launchd | 3 | plist, readme, shell |
| 5 | `qwen3:8b` | 24 | launchd | 3 | plist, readme, shell |
| 6 | `qwen3:30b-a3b` | 24 | launchd | 3 | plist, readme, shell |
| 7 | `phi4:latest` | 24 | launchd | 3 | plist, readme, shell |
| 8 | `gpt-oss:20b-cloud` | 24 | launchd | 3 | plist, readme, shell |
| 9 | `qwen3-coder:480b-cloud` | 24 | launchd | 3 | plist, readme, shell |
| 10 | `gpt-oss:120b-cloud` | 21 | launchd | 2 | plist, shell |
