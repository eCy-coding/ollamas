# 12-TEST-PLANI — yazılacak test dosyaları + iskeletleri

> Her mikro-görevin (10-MIKRO) test dosyası: hangi vitest project · dosya yolu · `describe/it`
> iskeleti · fixture ihtiyacı · kabul komutu. Mevcut test envanteri referansla (tekrar yazma).
> Damga: 2026-07-10 · c5ac42d.

## §0 Vitest project haritası (vitest.config.ts)

| Project | env | glob | mikro-görev test'leri buraya |
|---|---|---|---|
| **node** | node | `tests/**/*.test.ts`, `server/**/*.test.ts` | M-001..012, M-017, M-020, M-021 |
| **jsdom** | jsdom | `tests/ui/**/*.test.{ts,tsx}` (setup `tests/ui/setup.ts`) | M-019 (i18n) |
| **scripts** | node | `scripts/tests/**/*.test.ts` | — |
| **orchestra** | node | `orchestration/tests/{allowlist}.test.ts` | — |

Playwright (ayrı): `tests/e2e/*.spec.ts` (PORT 3170) · `tests/e2e-web/*.spec.ts` (PORT 3101). M-013 koşar.

## §1 Yeni test dosyaları (M-görev eşlemeli)

### `tests/localowner-guard.test.ts` — M-001, M-002 (node)
```ts
import { describe, it, expect } from "vitest";
// Fixture: express app'i test-mode boot et VEYA route-tablosunu import et.
// DANGEROUS = ["/api/terminal","/api/macos-terminal","/api/pipeline","/api/workspace",
//   "/api/agent","/api/keys","/api/cluster","/api/backup","/api/security","/api/generate","/api/ai"]
describe("localOwnerGuard", () => {
  it("SAAS_ENFORCE=1 → korunan prefix 403", async () => { /* her prefix fetch → 403 */ });
  it("SAAS_ENFORCE unset → next() (local owner)", async () => { /* → 403 DEĞİL */ });
  it("invariant: DANGEROUS ⊆ guard prefix listesi (M-002)", () => {
    // server.ts:285-292 listesini kaynak-al veya export et; DANGEROUS her elemanı içermeli
  });
});
```
- **fixture:** test-app boot helper (mevcut `tests/routes-hardening.test.ts` pattern'ini incele).
- **kabul:** `vitest run tests/localowner-guard`

### `tests/commander-exec.test.ts` — M-003 (node)
```ts
import { DesktopCommander } from "../server/commander";
describe("DesktopCommander.execute", () => {
  it("allowlist-dışı komut → throw", async () => {
    await expect(DesktopCommander.execute("curl", [])).rejects.toThrow(/not permitted/);
  });
  it("args metachar shell'e sızmaz (execFile argv)", async () => {
    const out = await DesktopCommander.execute("echo" /* allowlist'te değilse ls */, ["; whoami"]);
    // execFile argv → ";whoami" literal arg, shell çalıştırmaz
  });
  it("python3 ../ traversal → blocked", async () => {
    await expect(DesktopCommander.execute("python3", ["../evil.py"])).rejects.toThrow(/traversal/i);
  });
});
```
- **kabul:** `vitest run tests/commander-exec` · **not:** ⊘ kod-FP, regresyon kalkanı.

### `tests/pipeline-validate.test.ts` — M-004 (node)
- **iskelet:** empty prompt POST `/api/pipeline` → `expect(res.status).toBe(400)` + `content-type !== text/event-stream`.
- **kabul:** `vitest run tests/pipeline-validate`

### `tests/store-record-swallow.test.ts` — M-005 (node)
- **iskelet:** mock store db reject → `recordUsage(...)` / `recordAudit(...)` `.resolves` (throw yok); unhandled-rejection listener 0.
- **fixture:** store db-adapter mock.

### `tests/admin-guard.test.ts` — M-006 (node)
- **iskelet:** 5× yanlış admin token → 6. → 429 + `Retry-After`; timing-safe compare doğrula.

### `tests/providers-safeparse.test.ts` (veya mevcut `tests/providers-guard.test.ts`'e ekle) — M-007
- **iskelet:** bozuk tool-call JSON → `safeParse` undefined → provider fallback (throw yok).

### `tests/threatfeed-redos.test.ts` — M-009 (node)
- **iskelet:** patolojik input (uzun tekrar) → `<10ms` içinde döner (ReDoS yok); `name` user-controlled değilse belge.

### `tests/migration-uniqueness.test.ts` (veya `tests/migration-drift.test.ts`'e ekle) — M-012
- **iskelet:** dup-version migration array → module-load `throw /Duplicate migration version/`.

### `tests/billing-e2e-chain.test.ts` — M-017 (node)
```ts
describe("billing e2e chain (test-mode)", () => {
  it("checkout → webhook → meter → rollup", async () => {
    // 1. createAuditCheckout (STRIPE_API_KEY test veya mock)
    // 2. webhook event simüle (constructEvent test-signature)
    // 3. sendMeterEventAsync → usage_events kaydı
    // 4. tenant rollup → BillingRun/BillingLine doğrula
  });
});
```
- **fixture:** stripe test-mode key VEYA lazy-mock (stripe.ts no-op path); mevcut `server/__tests__/stripe-meter.test.ts` + `tests/server-stripe-webhook.test.ts` birleştir.

### `tests/ui/i18n.test.tsx` (MEVCUT dosyaya `it` ekle) — M-019 (jsdom)
```ts
import en from "../../src/locales/en"; import tr from "../../src/locales/tr";
it("en/tr key-set parite (fark=0)", () => {
  const ek = new Set(Object.keys(en)), tk = new Set(Object.keys(tr));
  const missing = [...ek].filter(k => !tk.has(k));
  const extra = [...tk].filter(k => !ek.has(k));
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
});
```

### `tests/cloud-masterkey.test.ts` — M-020 (node)
- **iskelet:** `isCloud=true` + key-yok → boot fail-closed (non-zero/throw); darwin path etkilenmez.

### `tests/version-consistency.test.ts` — M-021 (node)
- **iskelet:** `require('package.json').version` === `fs.readFileSync('VERSION').trim()`.

## §2 skip-map (M-014 kaynağı — 22 skipped call-site)

| Dosya:satır | Gate env | Gerçek-infra sebebi |
|---|---|---|
| `tests/cli-keychain-live.test.ts:16` | `live` | macOS keychain gerçek erişim |
| `tests/mac-power.e2e.test.ts:58` | `RUN_LIVE_E2E`+darwin | pmset/power gerçek |
| `tests/rag.e2e.test.ts:63` | `RUN_LIVE_E2E` | gerçek ollama+chroma |
| `tests/bench-tool.e2e.test.ts:63` | `RUN_LIVE_E2E` | gerçek model bench |
| `tests/litellm-provider.e2e.test.ts:34,38` | `RUN_LIVE`+proxy | litellm proxy up |
| `tests/providers-live.test.ts:15,19` | `LIVE_PROVIDERS` | gerçek cloud API key |
| `tests/truth-oracle.test.ts:204,258` | `PERF` | perf-gated |
| `tests/ukp-upstream.e2e.test.ts` (6×) | `HAVE_UKP` | UKP upstream erişim |
| `tests/{fs-upstream,reference-upstreams,dispatch}.e2e.test.ts` | env | upstream/dispatch |
| `tests/ClusterE2ELive.test.ts:14` | env | canlı cluster |

→ M-014: her satıra `// gated: <env> — <sebep>` + `docs/TESTING.md` tablosu (nasıl-koşulur dahil).

## §3 Kabul: tüm yeni testler + FRESH suite (M-013)

```bash
vitest run tests/localowner-guard tests/commander-exec tests/pipeline-validate \
  tests/store-record-swallow tests/admin-guard tests/threatfeed-redos \
  tests/migration-uniqueness tests/billing-e2e-chain tests/version-consistency
vitest run tests/ui/i18n
vitest run                    # tüm suite 0 fail (M-013)
npm run test:e2e              # playwright 0 fail (M-013)
```

## §4 Test yazım disiplini (00-ANAYASA)

- **TDD:** ⊘ regresyon testleri kodu ONAYLAR (kod FP/DONE) — kırmızı-önce gerekmez; ama testin GERÇEKTEN
  ilgili invariant'ı yakaladığını doğrula (mutasyon: guard'ı geçici kaldır → test kırılmalı).
- Yeni davranış (M-009,010,017,019,020,021) → test-önce (kırmızı → yeşil).
- Fixture'lar mevcut pattern'i taklit etsin (`tests/routes-hardening.test.ts`, `tests/providers-guard.test.ts`).
