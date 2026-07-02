# AUTOMATOR_DAILY.md — "produce DAILY, sustainable, recurring automations" tracking (auto-generated)

> Auto: `tsx orchestration/bin/automator-probe.ts --task daily` · 2026-07-02T08:04:45Z. Each model was handed the SAME
> task one-by-one (sequential; single-GPU truth): author a DAILY, RECURRING automation (launchd
> `StartCalendarInterval` job / Automator Calendar Alarm) that eases daily ollamas dev work — morning
> start+warm+cockpit, daily health-check+doctor+notify, daily benchmark log — into `~/Desktop/ollamas-daily/<model>/`.
> "Produced" = wrote ≥1 file; "Recurring" = the content carries a real schedule (launchd/cron/calendar).

## Result: 11/17 produced · 10/17 actually RECURRING

| # | Model | Provider | Produced | Files | Kinds | Recurring | Mechanism | Verdict |
|---|-------|----------|----------|-------|-------|-----------|-----------|---------|
| 1 | `qwen3-coder-64k:latest` | ollama-local | — | 0 | — | — | none | INCOMPLETE |
| 2 | `qwen3:8b-16k` | ollama-local | ✅ | 3 | plist, readme, shell | ✅ | launchd | INCOMPLETE |
| 3 | `ollamas-reviewer:latest` | ollama-local | ✅ | 4 | other, plist, readme, shell | ✅ | launchd | INCOMPLETE |
| 4 | `qwen2.5vl:32b` | ollama-local | ✅ | 4 | other, plist, readme, shell | ✅ | launchd | INCOMPLETE |
| 5 | `qwen2.5vl:7b` | ollama-local | ✅ | 3 | plist, readme, shell | ✅ | launchd | OK |
| 6 | `qwen3:8b` | ollama-local | ✅ | 3 | plist, readme, shell | ✅ | launchd | INCOMPLETE |
| 7 | `qwen3:30b-a3b` | ollama-local | ✅ | 3 | plist, readme, shell | ✅ | launchd | INCOMPLETE |
| 8 | `deepseek-r1:32b` | ollama-local | — | 0 | — | — | none | DONE |
| 9 | `qwen3-coder:30b` | ollama-local | — | 0 | — | — | none | INCOMPLETE |
| 10 | `qwen3:4b` | ollama-local | — | 0 | — | — | none | DONE |
| 11 | `gpt-oss:20b` | ollama-local | ✅ | 1 | shell | — | none | INCOMPLETE |
| 12 | `phi4:latest` | ollama-local | ✅ | 3 | plist, readme, shell | ✅ | launchd | OK |
| 13 | `kimi-k2.5:cloud` | ollama-cloud | — | 0 | — | — | none | INCOMPLETE |
| 14 | `gpt-oss:20b-cloud` | ollama-cloud | ✅ | 3 | plist, readme, shell | ✅ | launchd | DONE |
| 15 | `gpt-oss:120b-cloud` | ollama-cloud | ✅ | 2 | plist, shell | ✅ | launchd | BLOCKED |
| 16 | `qwen3-coder:480b-cloud` | ollama-cloud | ✅ | 3 | plist, readme, shell | ✅ | launchd | DONE |
| 17 | `llama3.3:70b` | ollama-local | — | 0 | — | — | none | INCOMPLETE |

## What each model produced
- **`qwen3-coder-64k:latest`**: (nothing) — INCOMPLETE
- **`qwen3:8b-16k`** (3, recurring via launchd: Calendar Alarm/StartCalendarInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell]
- **`ollamas-reviewer:latest`** (4, recurring via launchd: StartCalendarInterval/KeepAlive/RunAtLoad): `.gitignore` [other], `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell]
- **`qwen2.5vl:32b`** (4, recurring via launchd: Calendar Alarm/StartCalendarInterval/StartInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell], `health-check.log` [other]
- **`qwen2.5vl:7b`** (3, recurring via launchd: Calendar Alarm/StartCalendarInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `maintenance_script.sh` [shell]
- **`qwen3:8b`** (3, recurring via launchd: Calendar Alarm/StartCalendarInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell]
- **`qwen3:30b-a3b`** (3, recurring via launchd: StartCalendarInterval/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily_health_check.sh` [shell]
- **`deepseek-r1:32b`**: (nothing) — DONE
- **`qwen3-coder:30b`**: (nothing) — INCOMPLETE
- **`qwen3:4b`**: (nothing) — DONE
- **`gpt-oss:20b`** (1, one-off): `scripts/daily_health.sh` [shell]
- **`phi4:latest`** (3, recurring via launchd: StartCalendarInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health-check.sh` [shell]
- **`kimi-k2.5:cloud`**: (nothing) — INCOMPLETE
- **`gpt-oss:20b-cloud`** (3, recurring via launchd: StartCalendarInterval/KeepAlive/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `maintenance.sh` [shell]
- **`gpt-oss:120b-cloud`** (2, recurring via launchd: StartCalendarInterval/RunAtLoad): `com.ollamas.daily-maintenance.plist` [plist], `daily_maintenance.sh` [shell]
- **`qwen3-coder:480b-cloud`** (3, recurring via launchd: StartCalendarInterval/RunAtLoad): `README.md` [readme], `com.ollamas.daily-health.plist` [plist], `daily-health.sh` [shell]
- **`llama3.3:70b`**: (nothing) — INCOMPLETE

## Ethics
> Producing files is on the operator's OWN Mac and explicitly requested (the request IS the gate for the
> privileged write tier). Writes are scoped to `~/Desktop/ollamas-daily/<model>/` (per-model). The daily
> jobs are PRODUCED and tracked — NOT installed (`launchctl load`) or executed. Installing a recurring
> job is the operator's explicit one-click decision. Bounded (per-model timeout, sequential).
