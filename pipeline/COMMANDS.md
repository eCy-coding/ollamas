# Terminal Commands — eCym · ollamas · obsidian

> Source-derived (regenerate: `npx tsx pipeline/bin/commands.ts`). Every row is a real file on disk.

## ollamas — `pipeline` subcommands (12)

| Command | What it does | Source |
| --- | --- | --- |
| ollamas pipeline bench | Benchmark driver — repeat the workflow, aggregate, judge. | pipeline/bin/bench.ts |
| ollamas pipeline board | The board — every lane in its own visible Terminal.app tab, plus a conductor tab. | pipeline/bin/board.ts |
| ollamas pipeline commands | generate a source-derived terminal-command reference (8.7). Reads the REAL command | pipeline/bin/commands.ts |
| ollamas pipeline help-build | assemble a help SITE for one system from its REAL sources, write it to the vault. | pipeline/bin/help-build.ts |
| ollamas pipeline help-export | the reference sites' `.doc` deliverable, via pandoc. | pipeline/bin/help-export.ts |
| ollamas pipeline help-site | build the four help sites and render them into ONE coded static website. | pipeline/bin/help-site.ts |
| ollamas pipeline job | `ollamas pipeline job <name> [--visible]` — run MY OWN background jobs in a watchable tab. | pipeline/bin/job.ts |
| ollamas pipeline plan | the headless spine of the autonomous loop (H8.5): one command that builds BOTH targets | pipeline/bin/plan.ts |
| ollamas pipeline promptlint | promptlint (bin) — run the fiction check on the project's prompts. A prompt that names a repo or | pipeline/bin/promptlint.ts |
| ollamas pipeline run | The orchestrator — executes the 18-step DAG, measured. | pipeline/bin/run.ts |
| ollamas pipeline supervise | thin alias for `watch --raw`. | pipeline/bin/supervise.ts |
| ollamas pipeline watch | The readable watch tab — 45 jobs, one aligned stream. | pipeline/bin/watch.ts |

## eCym — local commands (24)

Run visibly in Terminal.app; `$0` local. Env: `ECY_YES` (approve risky), `ECY_MAX` (loop cap), `ECYM_NO_TRACKER`, `ECY_DATASET`.

| Command | What it does | Source |
| --- | --- | --- |
| `ecy` | — | ~/.local/bin/ecy |
| `ecy-brain` | eCy semantic memory ($0-yerel: nomic-embed-text :11434 + numpy cosine). | ~/.local/bin/ecy-brain |
| `ecy-build` | emergent.sh-benzeri agentic full-stack app-builder ($0-yerel). | ~/.local/bin/ecy-build |
| `ecy-cc` | — | ~/.local/bin/ecy-cc |
| `ecy-cmd` | eCy komut-hafizasi matcher v2 ($0, MODEL-SIZ, pure-local). | ~/.local/bin/ecy-cmd |
| `ecy-codekb` | eCy Kod-Bilgi-Tabanı matcher (ecy-build coder-prompt'una enjekte). | ~/.local/bin/ecy-codekb |
| `ecy-io` | dogrulanmis eCym<->ollamas I/O koprusu (odysseus-referansli, $0). | ~/.local/bin/ecy-io |
| `ecy-learn` | sürdürülebilir büyüme: misses.log'u okur, her benzersiz kaçan-istek icin | ~/.local/bin/ecy-learn |
| `ecy-log` | ecy-log "etiket" "mesaj" — merkezî log'a yazar (arka plan işleri görünür olur). | ~/.local/bin/ecy-log |
| `ecy-loop` | eCy tool-use döngüsü: tek-komut → çalıştır → sonucu gör → sonraki. Tekrar-önleme + güvenlik-gate. | ~/.local/bin/ecy-loop |
| `ecy-orchestra` | eCy=şef. tek-komut→çalıştır→DONE-check/delege→sonraki. Güvenlik-gate+tekrar-guard. | ~/.local/bin/ecy-orchestra |
| `ecy-provider` | eCy $0 provider havuzu yöneticisi (sonsuz-döngü yakıtı, 7/24 rotation). | ~/.local/bin/ecy-provider |
| `ecy-repair` | ecy-repair <id> — SELF-REPAIR.json maddesini deterministik uygular (cloud-snippet + anchor-apply + verify + revert). | ~/.local/bin/ecy-repair |
| `ecy-resolve` | — | ~/.local/bin/ecy-resolve |
| `ecy-run` | PATH launcher for the eCy Workflow v3 runner (delegates to vault _bin/ecy-run.sh). | ~/.local/bin/ecy-run |
| `ecy-selftest` | eCy Brain sürdürülebilir %100 harness (re-runnable regression-guard). | ~/.local/bin/ecy-selftest |
| `ecy-studio` | BİRLEŞİK launcher (eCy Studio + Ollama Orchestra, $0). Üretildi: kur-ecy.command | ~/.local/bin/ecy-studio |
| `ecy-tab` | ecy-tab "başlık" "komut" — komutu YENİ etiketli terminal.app sekmesinde çalıştırır. | ~/.local/bin/ecy-tab |
| `ecy-web` | eCy Studio: emergent.sh-benzeri web app-builder (zero-dep Node, :4600). | ~/.local/bin/ecy-web |
| `ecy2` | ince alias: ecym artik evrensel guvenilir giris (classify+execute+verify+escalate). | ~/.local/bin/ecy2 |
| `ecycode` | — | ~/.local/bin/ecycode |
| `ecycode-python` | — | ~/.local/bin/ecycode-python |
| `ecym` | ecym v2 — evrensel guvenilir eCy executor. classify -> attempt-local($0) -> VERIFY -> escalate. | ~/.local/bin/ecym |
| `ecyr` | eCy + kişisel-veri RAG (memory grep, Türkçe-normalize + kök-eşleşme). Yerel, private, $0. | ~/.local/bin/ecyr |

## obsidian — knowledge-base tools (20)

| Command | What it does | Source |
| --- | --- | --- |
| `cc-capsules.py` | — | _bin/cc-capsules.py |
| `cc-drift-apply.py` | — | _bin/cc-drift-apply.py |
| `cc-fix-anchors.py` | — | _bin/cc-fix-anchors.py |
| `cc-footer-fix.py` | — | _bin/cc-footer-fix.py |
| `cc-graph-layers.py` | — | _bin/cc-graph-layers.py |
| `cc-graph.py` | — | _bin/cc-graph.py |
| `cc-health.py` | — | _bin/cc-health.py |
| `cc-health.sh` | 0-manuel günlük kör-nokta kapısı (HAFİF: curl+grep+recall, ollama-inference YOK). | _bin/cc-health.sh |
| `cc-index-sync.py` | — | _bin/cc-index-sync.py |
| `cc-ops-prune.py` | — | _bin/cc-ops-prune.py |
| `cc-orphans.py` | — | _bin/cc-orphans.py |
| `cc-pages-sync.py` | — | _bin/cc-pages-sync.py |
| `cc-quality.py` | — | _bin/cc-quality.py |
| `cc-refresh-now.command` | — | _bin/cc-refresh-now.command |
| `cc-refresh.py` | — | _bin/cc-refresh.py |
| `cc-sync-all.sh` | Claude Code bilgi sistemi — tam zincir, 0 manuel işlem. | _bin/cc-sync-all.sh |
| `cc-token-meter.py` | — | _bin/cc-token-meter.py |
| `cc-verify.sh` | Claude Code KB sağlık kapısı. "kör nokta yok" iddiasını tek komutta doğrula. | _bin/cc-verify.sh |
| `cc-workspace.py` | — | _bin/cc-workspace.py |
| `cckb` | — | _bin/cckb |
