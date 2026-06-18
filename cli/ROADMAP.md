# ollamas CLI — ROADMAP (v1 → v10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla (CLI_AGENTS §7).
> Her versiyonun "done" tanımı, sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Durum |
|-----|------|----------|-------|
| **v1** | İskelet + chat | `node:util` parseArgs router, `chat` (one-shot+REPL+SSE), `doctor`, `config`, TTY/`--json`/NO_COLOR, `bin`, POSIX köprü iskelet, governance docs | ✅ DONE |
| **v2** | Agent sürücü | `ollamas agent "<task>"` ReAct loop (`/api/agent/chat` SSE); terminal tool-onayı (autoApply tier saygı); oturum persist (`/api/agent/sessions`); `--yolo`/`--safe`; thought→step→result render | ▶ NEXT |
| **v3** | SaaS/admin | `ollamas saas tenant\|key\|plan\|usage\|billing` → `/api/saas/*` + admin token; tablo çıktı; idempotency | |
| **v4** | Bench/calibration | Dual-target (Mac-native + remote/iOS-proxy) benchmark; `~/.llm-mission-control/cli-bench.json`; en verimli model/ctx/Metal flag auto-pick; `benchmark.mjs` yükselt; host-platform etiket (N-002) | |
| **v5** | MCP client | `ollamas mcp add\|list\|call\|tools` — upstream register/consume `/api/mcp/upstreams` + `/mcp`; choke-point üzerinden çağrı | |
| **v6** | iOS Shortcuts pack | `ollamas shortcuts build` → `.shortcut` (chat/bench/status); POSIX köprü tamamla (agent/saas); remote-exposure doc (tailscale/LAN + key) | |
| **v7** | Profiller + secrets | Çoklu-gateway profil; AES-GCM şifreli key store (`server/db.ts` SecureDB reuse) — v1 plaintext'i değiştir; `config use <profile>`; env override zinciri | |
| **v8** | Observability/TUI | `ollamas top` canlı usage/metrics (`/metrics` prom parse + `/api/saas/usage/timeseries`); seyir-defteri.jsonl tail; terminal sparkline; `--watch` | |
| **v9** | Packaging | `npm link` global; opsiyonel Go tek-binary (v4 bench TTFB kazancı gösterirse); Homebrew tap; shell completion (bash/zsh) | |
| **v10** | Self-update + plugin | `ollamas update`; manifest-tabanlı 3rd-party alt-komut sistemi; release-please; CLI CI (`.github/workflows`) | |
| **v11+** | Ufuk (önceden-hesap) | Native Swift Shortcuts derinleştirme; WASM build; otonom agent loop; multi-gateway mesh kontrolü | |

## v1 — DONE (kanıt)
- `cli/` : `index.ts` (router+config), `lib/{client,output,config}.ts`, `commands/{chat,doctor}.ts`, `bin/ollamas.sh`
- Testler: `tests/cli-{parser,output,chat}.test.ts` — 18 pass (saf-fonksiyon + mock-fetch)
- Full suite regression: 86 pass / 1 skip
- `package.json`: `bin.ollamas` → `dist/cli/index.cjs`; `cli` + `build:cli` script
- Canlı: `doctor --json` healthy=true (gateway/ollama/bridge); POSIX köprü curl health OK
- Choke-point: `grep -r ToolRegistry cli/` = yalnız yorum (gerçek import yok)

## v2 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. `cli/commands/agent.ts` — `/api/agent/chat` SSE tüket; event tipleri: `thought|step|tool|result|halt`.
2. `cli/lib/client.ts` → `agentStream(messages, {autoApply, maxSteps, sessionId}, onEvent)`.
3. Terminal tool-onayı: `host`/`privileged` tier'da `--safe` ise prompt, `--yolo` ise autoApply.
4. Oturum: `/api/agent/sessions` list/create/resume; `--session <id>`.
5. Testler: agent SSE event-router saf-fonksiyon; mock-fetch multi-event stream.
6. doctor'a `agent` reachability ekle.
