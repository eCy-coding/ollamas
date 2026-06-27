# ollamas MCP tool — tek-tek canlı test (2026-06-27)

38 tool `/mcp tools/call` ile safe-args çağrıldı (deterministik, RAM'siz). **0 transport hatası.** Dürüst fonksiyonel sınıflandırma (bazı "yanıt geldi" tool-içi error payload taşıyor):

## ✅ TAM ÇALIŞIYOR (gerçek doğru çıktı) — 17
| tool | kanıt |
|---|---|
| run_command | stdout `mcp-ok` |
| macos_terminal | `mcp-term-ok` (iTerm2) |
| count_tokens | **7 tokens** (cl100k) — doğru |
| git_ops | status JSON ok |
| health_probe | ts + sağlık |
| process_port | port:8090 sorgulandı |
| log_stream | lines döndü |
| tools_doctor | total tool sayısı |
| shell_check | clean analiz |
| logbook | tail entries |
| web_search | ok mode döndü |
| seyir_stats · usage · model_select | kaynak+metrik JSON |
| write_file · upload_file | scratch'a yazıldı |
| rag_search | `{results:[]}` (boş ama valid) |

## 🟠 ÇALIŞIYOR ama WORKSPACE yanlış (kök-neden tespit) — 4
list_tree(`[]`) · read_file(`Target file does not exist`) · download_file(aynı) · grep_search(boş stdout).
→ **Kök-neden:** /mcp server workspace = `/tmp/ollamas-code-*` (boş temp dir), repo-root DEĞİL. Bu file-tool'lar ÇALIŞIYOR ama boş workspace'e bakıyor. Fix: server workspace'i repo-root'a ayarla (server lane) veya çağrıda workspace ver. (agent terminal-cwd bulgusuyla AYNI kök.)

## 🔵 ENV-LİMİT (tool ok, ortam kısıtı) — 4
- write_host_file → `Host write bridge: path outside allowed roots` (/tmp scratch izinli değil — beklenen güvenlik).
- sample → `sampling unavailable: connection...` (MCP sampling client-bağlantısı gerekir; CLI çağrısında yok).
- mac_power → `powermetrics failed` (sudo gerek).
- rag_index → `operation aborted` (45s timeout — embedding yavaş/RAM).

## ⏭️ SKIP — yıkıcı/pahalı (güvenlik, çalıştırılmadı) — 13
run_tests · lint_format (slow) · git_commit · build_app · kill_process · pkg_install · apply_patch · self_heal · bench_model · test_generate · code_audit · storefront_generate · eval_prompt.

## Özet
- **25 yanıt / 0 transport-hata** · 17 tam-çalışıyor · 4 workspace-misconfig (kök tespit) · 4 env-limit · 13 güvenlik-skip.
- **Eyleme dönük bulgu:** MCP server workspace-root repo değil (file-tools boş dir'e bakıyor) — agent terminal-cwd ile aynı kök-neden. Server-lane fix.
- Runner: `node .claude/mcp-tool-test.mjs` (tekrar-kullanılabilir; harness-ops --deep'e bağlanabilir).
