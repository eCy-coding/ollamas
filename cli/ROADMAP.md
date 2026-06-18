# ollamas CLI — ROADMAP (v1 → v10+)

> "Sıradaki versiyonu planla" → buradan sonraki versiyonu aç, phase+todo üret, kodla (CLI_AGENTS §7).
> Her versiyonun "done" tanımı, sonraki versiyonun ilk todo'sunu doğurur (precompute).

| Ver | Tema | Çekirdek | Durum |
|-----|------|----------|-------|
| **v1** | İskelet + chat | `node:util` parseArgs router, `chat` (one-shot+REPL+SSE), `doctor`, `config`, TTY/`--json`/NO_COLOR, `bin`, POSIX köprü iskelet, governance docs | ✅ DONE |
| **v2** | Agent sürücü + sweep | `ollamas agent` ReAct loop (`/api/agent/chat` SSE); write-onay akışı (`/api/agent/approve-write`); oturum (`/api/agent/sessions`); `--yolo`/`--safe`; + 10 v1-gap (G1-G10) | ✅ DONE |
| **v3** | SaaS/admin | `ollamas saas tenant\|key\|plan\|usage\|billing` → `/api/saas/*` + admin token; tablo çıktı; idempotency | ▶ NEXT |
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

## v2 — DONE (kanıt)
- `cli/commands/agent.ts` + `cli/lib/io.ts` (stdin/confirm) yeni; `agent` (task/sessions/rm), write-onay akışı, `--yolo`/`--safe`
- `client.ts`: `agentStream`/`approveWrite`/`{list,get,create,delete}Session`/`ready`; baseUrl normalize (G3); stream timeout (G4)
- `output.ts`: `formatStep`/`formatDiff`; doctor 5 satır (+ready+agent, G6)
- sweep: G1 per-cmd help · G2 stdin-pipe · G5 `--version` route · G7 POSIX agent · G8 cli/README · G9 main-dispatch test · G10 `--gateway`
- Testler: `tests/cli-{parser,output,chat,agent}.test.ts` — **35 pass** (saf-fn + mock-fetch); full suite **102 pass/1 skip**
- Canlı: `doctor` 5 satır healthy (sessions=46); `agent --json` gerçek SSE thought→message→done; `agent sessions` tablo; POSIX köprü agent
- Choke-point korunur; VERSION 2.0.0

## v3 — NEXT (önceden-hesaplanmış ilk todo'lar)
1. `cli/commands/saas.ts` — alt-eylemler `tenant|key|plan|usage|billing` (list/create/revoke).
2. `cli/lib/client.ts` → SaaS metodları: `listTenants/createTenant`, `listKeys/createKey/revokeKey`, `listPlans`, `usage`, `billingPreview` → `/api/saas/*` + `/api/billing/preview` (adminGuard: `SAAS_ADMIN_TOKEN`).
3. Admin token: `config saasAdminToken` veya `OLLAMAS_SAAS_ADMIN` env → `X-Admin-Token` / bearer header.
4. `cli/lib/output.ts` → `formatTable(rows, cols)` (TTY hizalı, `--json` ham).
5. Idempotency: key/tenant create'te idempotency-key başlığı (store idempotency).
6. Testler: saas client mock-fetch + `formatTable` saf-fn; doctor'a `saas` reachability (opsiyonel).
