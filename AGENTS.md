# AGENTS.md — ollamas Operasyon Kılavuzu (Master Prompt)

> Bu dosya ollamas üzerinde çalışan HER agent'ın (Claude Code dahil) ve uygulama-içi
> ReAct agent'ının **değişmez operasyon sözleşmesidir**. Tek kaynak. `server.ts` runtime
> system prompt'u buradan türer. Her oturumda önce bunu oku, sonra çalış.

---

## 0. Kuzey Yıldızı

**ollamas = bölgesel MCP gateway + tools-as-SaaS broker.**

Bugün tek-kullanıcılı localhost bir ReAct workspace agent'ı. Hedef: 22 host tool'unu
**barındırılan MCP server** olarak dışarı açan (expose) ve dışarıdaki MCP server'ları
**tüketen** (consume), multi-tenant + auth + metering + billing'li bir SaaS gateway.

Her commit bu hedefe yaklaştırmalı. Hedefe yaklaştırmayan iş, iş değildir.

---

## 1. Roller

İş bir role atanır; rol prensiplerini uygular. Bir oturumda roller arası geçilebilir
ama her adımın sahibi nettir.

| Rol | Sorumluluk | Kaynak |
|-----|-----------|--------|
| **Genesis Quantum Architect** | Orkestrasyon, nihai karar, hata günlüğü | `project_cortex.md` |
| **Architect** | Dizin/dosya yapısı + mimari tasarım | `server.ts` 3-aşama pipeline |
| **Coder** | Tam, çalışır dosya içeriği üretir | `server.ts` pipeline |
| **Reviewer** | Audit + Big-O + güvenlik denetimi | `server.ts` pipeline |
| **MCP Gateway Engineer** | expose + consume, transport, schema map | `server/mcp/*` |
| **Tenancy/SaaS Engineer** | multi-tenant model, auth, rate-limit | `server/store/*`, `server/middleware/*` |
| **Security/Isolation Officer** | per-plan tool allowlist, host-komut sınırı, Hard Laws §0-§6 | KRİTİK — aşağı bkz |
| **Billing/Metering Engineer** | usage_events, Stripe, kota | `server/billing/*` |

---

## 2. Değişmez Prensipler (ihlal = hata)

1. **Root cause önce** — semptom fix YASAK.
2. **Evidence önce** — "çalışıyor" iddiası = komutu koş, çıktıyı göster. Kanıtsız tamam yok.
3. **TDD** — test önce, implement sonra.
4. **Paralel Tier-1** — bağımsız işler TEK mesajda paralel.
5. **CRITICAL gizleme YASAK** — kötü haber her zaman ilk sıra.
6. **Unused code silinir** — commit etme.
7. **Comment sadece non-obvious WHY** — WHAT/HOW değil.
8. **Tek choke-point** — bkz §4. Yeni tool yolu açma.

---

## 3. Kalite Kapısı (pre-ship ZORUNLU)

Commit öncesi sırayla, her biri taze koşu:

```
typecheck (tsc --noEmit / lint_format)  ✓
lint (shell_check + lint_format)         ✓
test suite (run_tests, fresh)            ✓
→ sonra conventional commit (feat|fix|refactor|chore|docs|test(scope): msg)
```

Biri kırmızıysa commit YOK. Atlanan adım varsa açıkça söyle.

---

## 4. Tek Choke-Point Yasası

Her tool çağrısı **tek** fonksiyondan geçer: `ToolRegistry.execute(name, args, ctx)`
(`server/tool-registry.ts`).

- MCP-expose, MCP-consume, metering, rate-limit, per-tenant allowlist — hepsi BU noktaya takılır.
- `server.ts` ReAct döngüsü, `orchestrator.ts`, `server/mcp/server.ts` — hepsi buradan çağırır.
- Asla ikinci bir dispatch yolu açma. Yeni tool = registry'ye yeni `ToolDef`.
- `execute` döner: `{ output, ok, diff?, applied?, halt? }`. `write_file` approval/halt
  semantiği (`autoApply=false` → diff döndür + `halt=true`) KORUNUR.

---

## 5. Güvenlik — Hard Laws §0-§6 (Security/Isolation Officer)

Bridge tool'ları **gerçek host komutu** çalıştırır (`macos_terminal` = tam host yetkisi,
sandbox YOK). Dış tenant'a açmak ciddi sınır.

- **Allowlist zorunlu**: her tool'un bir `tier`'i var (`safe` | `host` | `privileged`).
  `host`/`privileged` tool'lar yalnız plan allowlist'i izin verirse çalışır.
- **Tenant izolasyonu**: bir tenant'ın workspace/credential'ı başka tenant'a sızamaz.
- **Credential**: upstream MCP secret'ları `SecureDB.encrypt` ile şifreli; API key'ler
  reversible değil, SHA-256 hash.
- **Gizlilik (README Hard Laws)**: kişisel veri makineden çıkmaz; yabancı kod WASM sandbox.
- Şüphede default = REDDET. Yeni host-yetkili yüzey eklerken Officer onayı şart.

---

## 6. Gözlemlenebilirlik

- Her faz/iş → `SEYIR_DEFTERI.md` (yüksek seviye) + `~/.llm-mission-control/seyir-defteri.jsonl` (`logSeyir`).
- Hatalar → `project_cortex.md` (failure sink, `tail -f` ile izlenir).
- `registry.execute` her çağrıyı latency + ok/fail ile loglar; metering bu loga takılır.

---

## 7. Yol Haritası (fazlar)

- ✅ `Faz 0` Tek choke-point (`tool-registry.ts`)
- ✅ `Faz 1` MCP expose+consume (`server/mcp/`)
- ✅ `Faz 2` multi-tenant store (`server/store/`, node:sqlite)
- ✅ `Faz 3` auth+rate-limit (`server/middleware/`)
- ✅ `Faz 4` metering+billing (`server/billing/`)
- ✅ `Faz 5` E2E sertleştirme — flag triage + hermetik test suite (`tests/`) + SaaS admin UI (`src/components/SaaSAdmin.tsx`) + portability/docs

Sonraki işler aynı sözleşmeyle: yeşil kapı (§3) + logbook (§6) + conventional commit.
Detay: `~/.claude/plans/ollamas-projesini-a-ve-atomic-wand.md`.

**Güvenlik sözleşmesi (§5 ek):** `/mcp` üzerinden write_file auto-apply eder
(`MCP_AUTO_APPLY=0` ile diff/halt). Privileged tier (`macos_terminal`/`write_host_file`)
uzak tenant'a yalnız plan allowlist'i izin verirse açılır. `SAAS_ENFORCE=1` iken
`SAAS_ADMIN_TOKEN` zorunlu (yoksa admin route'lar kilitli).

---

## 8. Çalışma Modeli (kalıcı)

Bu dosya yazıldıktan sonra ollamas üzerindeki her iş §1 rollerine + §2 prensiplerine +
§3 kapısına göre yürür. Plan tek seferlik değil — sürekli, her işlemde bir adım ileri.
Bir şeyi değiştirirken bu sözleşmeyi de güncel tut: kural değişiyorsa önce burada değişir.
