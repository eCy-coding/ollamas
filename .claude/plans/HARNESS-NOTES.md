# HARNESS ENGINEERING — inşa durumu + onay-bekleyen + cross-lane not (2026-06-25)

## ✅ Bu sekmede TAMAMLANAN (onay gerektirmeyen dosyalar)
- `.claude/hooks/redact-tokens.mjs` — PreToolUse, literal secret VALUE block (env-ref geçer). 2/2 test ✓
- `.claude/hooks/block-destructive.mjs` — rm -rf /~, force-push, fork-bomb, mkfs, dd-to-disk, --no-verify block. 4/4 test ✓
- `.claude/hooks/gate-before-commit.mjs` — fast commit-policy: no `-A/.`, no `-a`, no `--no-verify`, staged-boş block. 4/4 test ✓
- `.claude/agents/cli-coder.md` · `cli-verifier.md` · `harness-reviewer.md` — implementer≠verifier doktrini (sonraki oturumda yüklenir)
- `.claude/statusline.mjs` — model · branch · DOCTOR readiness. render ✓

## ⏳ OPERATÖR ONAYI bekleyen (startup-config self-modification → auto-deny)
`.claude/settings.json` aşağıdaki ekler — operatör manuel onaylamalı (CLAUDE.md: executable hook kaydı = onay):

1. **PreToolUse kaydı** (yukarıdaki 3 hook'u aktive eder):
```json
"PreToolUse": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "node $HOME/Desktop/ollamas/.claude/hooks/redact-tokens.mjs" } ] },
  { "matcher": "Bash", "hooks": [
    { "type": "command", "command": "node $HOME/Desktop/ollamas/.claude/hooks/block-destructive.mjs" },
    { "type": "command", "command": "node $HOME/Desktop/ollamas/.claude/hooks/gate-before-commit.mjs" } ] }
]
```
2. **permissions** (her-tool-prompt UX'i düzeltir):
```json
"permissions": {
  "defaultMode": "default",
  "allow": [
    "Bash(git status)","Bash(git diff:*)","Bash(git log:*)","Bash(git rev-parse:*)",
    "Bash(npm run test:*)","Bash(npm run lint:*)","Bash(npx tsc --noEmit)",
    "Bash(node scripts/:*)","Bash(npx tsx orchestration/bin/:*)",
    "Bash(grep:*)","Bash(rg:*)","Bash(ls:*)","Bash(find:*)"
  ],
  "deny": [ "Read(./.env)","Bash(rm -rf:*)","Bash(git push --force:*)" ]
}
```
3. **statusLine**:
```json
"statusLine": { "type": "command", "command": "node $HOME/Desktop/ollamas/.claude/statusline.mjs" }
```

## ⏳ OPERATÖR ONAYI — system-op
- **C1 launchd autopilot yükle** (DOCTOR uyarısını kapatır):
  `bash orchestration/bin/autopilot-install.sh load` → doğrula: `launchctl list | grep ollamas`

## 📋 CROSS-LANE not (orchestration/scripts sekmesi uygular — burada EDIT YOK)
- **C2 vO16 done-no-evidence**: ROADMAP_ORCHESTRATION.md:28 `✅ DONE`→`▶ NEXT` VEYA `orchestration/bin/run-diagnose-repair-publish.ts` yaz + CRITIC.json flag temizle. (verdict: kanıtsız, geri-al)
- **M4a role-hook i18n**: `orchestration/bin/role-hook.ts` regex TR-only → EN tetikleyiciler ekle ("what do you do","your role","what is this tab").
- **M4b /ops command**: `.claude/commands/ops.md` → `tsx orchestration/bin/ops.ts` allowed-tools doğrula.
- **model default**: scripts/NOTE-model-efficiency-2026-06-25.md (gemini-2.5-pro winner; OLLAMAS_PROVIDER+OLLAMAS_MODEL patch).
- **portable path**: `grep ollamas-orchestration-wt orchestration/**` → hardcode kaldı mı doğrula (AUTOPILOT_SETUP.md:27,32 şüpheli).
- **orchestration hook portability (CRIT)**: settings.json'daki ÖNCEDEN-VAR hooklar `$HOME/Desktop/ollamas/...` hardcode (role-hook/model-hook/autopilot). Başka path/worktree'de FAIL-OPEN. Fix: `${CLAUDE_PROJECT_DIR}`'e çevir (orchestration lane uygular). Benim eklediğim hooklar zaten portable.

## 🧠 Thinking / effort politikası (2026, Opus 4.8 adaptive)
- Opus 4.8 = ADAPTIVE reasoning → `budget_tokens`/`MAX_THINKING_TOKENS` ETKİSİZ (set etme; 400 riski). Kontrol = SADECE `effortLevel`.
- Session default: `effortLevel:"high"` (settings, pin) — adaptive gereksiz derinliği atlar = verimli.
- Sub-agent override: cli-verifier + harness-reviewer `effort:xhigh` (adversarial derin akıl), cli-coder `effort:medium`.
- `alwaysThinkingEnabled:true` + `showThinkingSummaries:true` (evidence-first görünürlük).
- Keyword: `ultrathink` hâlâ geçerli (tur-içi derin); `think/think hard` ARTIK keyword DEĞİL.
- Interleaved thinking: Opus 4.8'de OTOMATİK (beta header gereksiz).
- Cache uyarısı: effort/thinking DEĞİŞİMİ message-cache breakpoint'lerini invalidate eder → benzer işlerde effort'u SABİT tut → cache hit (%90 read indirimi).
- Session-içi: derin iş için `/effort xhigh` veya `ultracode`; mekanik için `/effort low` + `/fast`.

## 🔬 Derin katman (D1-D5, eklendi)
- **`.lsp.json`** TypeScript LSP → inline tip-tanı (binary: `npm i -g typescript-language-server typescript`).
- **Stop** hook (`on-stop.mjs`) → tur-sonu durum snapshot (`.claude/last-turn.md`).
- **PostToolUseFailure** hook (`on-tool-failure.mjs`) → hata bağlamını `additionalContext` ile enjekte (otonom recovery).
- **Hook test-suite** (`test-hooks.sh`) → 13 golden test (exit-2 blok / exit-0 pass + stdout-JSON safety). apply-harness verify'a bağlı.
- **Plugin packaging** → `.claude-plugin/{plugin.json,marketplace.json}` + `build-plugin.sh` (`.claude/`'tan `dist-plugin/ollamas-harness/` üretir, tek-kaynak). Kur: `/plugin marketplace add ./.claude-plugin` → `/plugin install ollamas-harness@ollamas-marketplace`.
- Tüm hooklar: exit 2 = blok, diğer = non-blocking warn (exit 1 ≠ koruma! — kritik tuzak, lifecycle hookları exit 0 fail-safe).

## 🔧 Cross-lane (server) — degraded-live kök-neden + durable fix (2026-06-27)
**Belirti:** `/api/health` mode=degraded-live, ollama=unavailable — OYSA ollama UP (18 model, /api/version ~30ms).
**Kök-neden:** `server.ts:155 detectMode()` boot'ta BİR KEZ çalışıp `CURRENT_MODE`'u cache'liyor; ollama probe **1s timeout** (satır 176) — boot anında RAM %98 baskısında ollama >1s → degraded-live cache'lendi, asla tazelenmiyor.
**Operasyonel fix (uygulandı):** server restart `PORT=8090 npm run dev` → re-detect → **live** (ollama 30ms). NOT: plain `npm run dev` PORT=3000'e gider, Docker (llm-mission-control :3000) ile EADDRINUSE çakışır → her zaman `PORT=8090`.
**Durable fix (server lane uygula):** detectMode'u periyodik/health-miss'te yeniden çalıştır (CURRENT_MODE refresh) VEYA boot probe timeout'u 1s→3s. Tek-boot-cache anti-pattern'i.

## Kanıt
Tüm bu-sekme hook/statusline testleri yeşil (10/10 payload-test + statusline render). settings.json edit auto-deny ile engellendi (beklenen güvenlik davranışı).
