# HOWTO — harness'e CLI ekle (e2e, tekrarlanabilir)

Yeni bir CLI'ı harness'in güvenli + izinli kullanımına almanın tam akışı. Tek komutla: `/add-cli` veya `node .claude/add-cli.mjs`.

## Mimari (neden böyle)
- **permissions** (`allow`/`ask`/`deny`, `Bash(cmd:*)` pattern) Claude'un bir CLI'ı promptsuz (`allow`) / onaylı (`ask`) / yasak (`deny`) çalıştırmasını belirler. `/permissions` slash YOK → settings.json edit (Chrome+docs teyit, 2026-06-27).
- Base 26 CLI → `merge-settings.mjs` HARNESS. Sonradan eklenenler → `cli-extensions.json` (yapısal). merge bunları permissions'a **union** eder. apply-harness canlıya taşır.
- Bu ayrım = base sabit + eklentiler izole + regex-editing riski yok.

## 7 adım
1. **Install**: `brew install <cli>` veya `npm i -g <cli>`.
2. **Classify**: read-only/analiz → `allow`; deploy/push/delete/outward → `ask`.
3. **Add**: `node .claude/add-cli.mjs <cli> --tier allow|ask --pattern "<sub:*>" --use "<amaç>"`
   - smoke-test (kurulu+çalışır) → cli-extensions.json + CLI-REGISTRY.md (idempotent).
4. **Apply**: `bash .claude/apply-harness.sh` → union → settings.json canlı.
5. **Restart**: Claude sekmesini yeniden başlat (yeni izinler yüklenir; MCP/slash eklediysen şart).
6. **Smoke**: CLI'ı gerçek bir komutla çalıştır (`<cli> --version` + bir iş) → çalıştığını kanıtla.
7. **Commit**: `git add .claude/cli-extensions.json .claude/CLI-REGISTRY.md && git commit` (gate canlı koşar).

## Örnek
```bash
node .claude/add-cli.mjs httpie --tier ask --pattern ":*" --use "HTTP istemci (API test)"
node .claude/add-cli.mjs shellcheck --tier allow --pattern ":*" --use "shell lint"
```

## Kurallar
- Side-effectful CLI **ASLA** allow → her zaman ask (deploy/push/db/delete).
- Pattern olabildiğince dar (`gh pr view:*` ≠ `gh:*`).
- Secret/credential isteyen CLI: auth = operatör (Claude key giremez).
- `deny`'e eklemek istersen cli-extensions.json'a elle (add-cli yalnız allow/ask).
