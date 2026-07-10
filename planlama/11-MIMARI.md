# 11-MIMARI — tam modül/mimari haritası

> Odysseus `specs/architecture-runtime-inventory.md` derinliğinde modül envanteri: her modül →
> sorumluluk · choke-point · invariant · risk · anchor. Mikro-görevlerin (10-MIKRO) anchor kaynağı.
> Mimari kör-nokta kapaması: bir modül burada haritasız kalırsa 06-KOR-NOKTA boyutu eksik demektir.
> Damga: 2026-07-10 · c5ac42d. Sayılar canlı (recompute: 01-ENVANTER).

## §0 Üst düzey topoloji

```
                    ┌─────────────────────────────────────────────┐
  Terminal/iOS  ──▶ │ cli/  (zero-dep TS + POSIX bridge)           │
                    └───────────────┬─────────────────────────────┘
                                    │ HTTP /api/* + /mcp (TEK choke-point)
                    ┌───────────────▼─────────────────────────────┐
  Browser (SPA) ──▶ │ server.ts (119 route, Express)              │
                    │  ├─ localOwnerGuard (SaaS gate)             │
                    │  ├─ authMiddleware (/mcp, /api/saas/*)      │
                    │  ├─ adminGuard (rate-limited)               │
                    │  └─ tool-registry.execute (35 tier)  ◀── choke │
                    └───┬────────┬────────┬─────────┬────────┬────┘
                        │        │        │         │        │
                  server/store  providers backend/  billing  bin/host-bridge
                  (sqlite+pg)   (fallback  {mesh,   (stripe)  (host exec seam)
                                 chain)    daemon,
                                           sandbox)
```

## §1 server.ts — HTTP katmanı (RİSK: YÜKSEK)

- **Sorumluluk:** 119 route, Express app. Route grupları (canlı sayım):
  `/api/saas`(22) · `/api/github`(11) · `/api/workspace`(7) · `/api/revenue`(7) · `/api/keys`(7) ·
  `/api/agent`(7) · `/api/cluster`(6) · `/api/billing`(5) · `/api/backup`(5) · `/api/terminal`(1) ·
  `/api/macos-terminal` · `/api/pipeline`(1).
- **Choke-point / auth katmanları:**
  - `localOwnerGuard` (**276-294**): `SAAS_ENFORCE=1` → tehlikeli prefix'ler 403. Prefix listesi 285-292.
  - `authMiddleware` (import **61**): `/mcp`(**2539**), `/api/saas/*`(**2632-2708** `authMiddleware(true)`), billing(**2765/2771**).
  - `adminGuard` (**2566-2593**): rate-limit `ADMIN_MAX_FAILS=5`(**2564**), lock 15dk(**2565**), timing-safe(**2580**).
- **Invariant:** her yeni route → auth kararı (localOwnerGuard prefix VEYA authMiddleware VEYA public-by-design).
  Public route bilinçli allowlist'te olmalı (05-TEHDIT T-01).
- **Risk:** allowlist tamlık — yeni tehlikeli prefix eklenirse localOwnerGuard listesine EKLENMELİ
  (aksi halde SaaS'ta sızar). **Test boşluğu:** localOwnerGuard SAAS davranışı için doğrudan test yok.

## §2 tool-registry — araç choke-point (RİSK: ORTA)

- **Anchor:** `server/tool-registry.ts`. `ToolTier` (**43**): `safe|host|privileged|host_upstream`. 35 `tier:` girdisi.
- **Sorumluluk:** TÜM tool çağrıları `ToolRegistry.execute`'tan geçer (consume Faz-1 invariant). İkinci yol yok.
- **Invariant (N-012):** `cli/` `tool-registry` import ETMEZ — yalnız HTTP `/api/*`+`/mcp`.
  Doğrula: `grep -rn "tool-registry" cli/` = boş.
- **`ToolDeps`** (**46**): host-bridge state circular-import'u kırmak için injection.
- **Risk:** yeni tool tier ataması yanlışsa (privileged→safe) yetki sızıntısı. Tier gerekçesi PR'da zorunlu.

## §3 server/store — kalıcılık (RİSK: ORTA)

- **Anchor:** `server/store/{index.ts, migrations.ts, db-adapter.ts}`.
- **migrations.ts:** `interface {version:number}`(**14**), v1-v6 (**38,47,66,104,144,160**).
  Uniqueness assert MEVCUT: `seenVersions` Set + `throw Duplicate migration version`(**170-181**).
  `runMigrations(db)`(**183**), withLock advisory(**8**), duplicate-column swallow(**30,100**).
- **index.ts:** `recordUsage`(**229**, best-effort swallow **237**), `recordAudit`(**266**, swallow **271**).
- **Invariant:** migration version'ları globalde tekil (load-time throw korur). Divergent-lane'de aynı
  vN farklı şema = MERGE sorunu (mevcut branch'te yok) → 03-GAP GAP-011 downgrade.
- **Risk:** SQLite (tek-proses) vs Postgres (SaaS multi-replica). `keys/notify/securityLog` full-file JSON
  (ROADMAP T3.2) → multi-replica değil. Darwin'de tetiklenmez.

## §4 server/providers.ts — model fallback chain (RİSK: ORTA)

- **Anchor:** `safeParse`(**204**, kullanım 209/213/219), `getFallbackChain`(~397), `buildSignal`(~227),
  `latencyCache`(~299), keyCooldown(~418).
- **Sorumluluk:** local(ollama) + N cloud provider fallback; 429 cooldown; tool-call JSON repair.
- **Invariant:** tool-call metni `safeParse` ile sarılı (throw yok). `MAX_LOADED_MODELS=1` → tek local model.
- **Risk (ROADMAP-vNext):** T1.1 gemini-cli in-chain stall (30s SIGKILL), T2.1 429 cooldown sabit 6h
  (Gemini RPD midnight-Pacific reset), T2.2 latencyCache write-only (reorder yok). → P4 perf backlog.

## §5 server/billing/stripe.ts — para (RİSK: ORTA)

- **Anchor:** `server/billing/stripe.ts` (lazy `STRIPE_API_KEY` yoksa no-op). Fonksiyonlar:
  `sendMeterEventAsync`, `ensureBillingConfig`, `ensureCustomer`, `createAuditCheckout`, `dollarsToCents`, `isLive`.
  İlgili: `server/revenue.ts`, `server/key-usage.ts`, `server/tokens.ts`.
- **Choke-point:** `usage_events` → tenant rollup (`BillingRun`/`BillingLine`). Webhook `constructEvent`.
- **Testler (MEVCUT):** `server/__tests__/stripe-meter.test.ts`, `tests/server-stripe-{webhook,audit}.test.ts`,
  `tests/{server-revenue,revenue-provider,server-usage-sweep}.test.ts`.
- **Invariant:** key yoksa no-op (dev/CI güvenli). `recordUsage/recordAudit` fire-and-forget ama iç-swallow.
- **Risk:** e2e zincir (checkout→webhook→meter→rollup) tek testte kanıtlanmamış (03-GAP GAP-016 gerçek).

## §6 backend/ — mesh/daemon/orchestrator/sandbox (RİSK: ORTA)

- **Anchor:** `backend/{contracts, daemon, mesh, orchestrator, sandbox}`.
- **Sorumluluk:** dağıtık inference mesh, WASM-sandbox, job orchestration, contract federation (olm_ key).
- **Invariant:** sandbox host'tan izole (WASM). JOB_STORE in-memory (orchestrator.ts:16) → multi-replica değil.
- **Risk:** mesh auth yüzeyi (05-TEHDIT T-01 mesh); sandbox kaçış → threat model P2.

## §7 tunnel/ — MacBook↔iPhone (RİSK: ORTA)

- **Anchor:** `tunnel/{src, scripts, recipes, keys, prompts}`, `tunnel/TUNNEL_AGENTS.md`, `errors_registry.json`.
- **Sorumluluk:** sovereign zero-account tünel/switch (izole worktree ollamas-tunnel-wt).
- **Invariant:** zero-account (harici hesap yok). Scope `tunnel/**`.
- **Risk:** tünel auth + trafik gizliliği (05-TEHDIT); yalın-worktree izolasyonu.

## §8 cli/ — birleşik ollamas CLI (RİSK: DÜŞÜK)

- **Anchor:** `cli/{index.ts, bin, lib, commands}`, `cli/CLI_AGENTS.md`, `cli/ROADMAP.md`.
- **Sorumluluk:** zero-dep TS + POSIX bridge + Apple Shortcuts. Yalnız `cli/**` scope.
- **Choke-point:** yalnız HTTP `/api/*`+`/mcp` (N-012 tool-registry import YOK).
- **Invariant:** zero-dep (node built-ins), pure-core+thin-IO, TTY-aware. Kalite kapısı tsc→vitest→lint.
- **Sonraki (NEXT_cli):** v8 Observability/TUI `ollamas top` (`/metrics`).

## §9 src/ — React SPA (RİSK: DÜŞÜK)

- **Anchor:** `src/{App.tsx, main.tsx, components, hooks, lib, locales, styles, types.ts}`.
- **Sorumluluk:** cockpit UI, panel loop'ları (KeyVault/Pipeline/ReAct), i18n (en/tr 159 key flat).
- **Choke-point:** `src/lib/apiClient.ts` (backend'e tek giriş).
- **Invariant:** frontend backend-yasak (yalnız HTTP). i18n flat `Record<string,string>`, id-fallback.
- **Risk:** i18n key-count parite assert YOK (10-MIKRO); Lighthouse RUN edilmemiş (config var).

## §10 orchestration/ — $0 conductor (RİSK: DÜŞÜK)

- **Anchor:** `orchestration/{bin (50+ script), plans, oracle, seyir, tests(123)}`.
- **Sorumluluk:** Claude-Code-free FSM loop (BOOTSTRAP→COUNCIL→BENCHMARK→{DEPLOY|REPAIR}→MONITORING),
  joker failover, count-agnostic katalog (`ollamas do`/calibrate), gated apply (revert-on-red).
- **Invariant:** apply gated (red→revert, repo korunur). Coverage floor pure-core (bin/lib) lines/fn 70.
- **Risk:** benchmark correctness (memory gotcha: out:""/ran:false hep-false) → HIERARCHY_POLICY bloke.

## §11 .github/workflows — CI (RİSK: DÜŞÜK-ORTA)

- **Anchor:** `.github/workflows/release-binary.yml` (`REF:` env-var **86**, tag-gate **72,92**).
- **Invariant:** untrusted `github.ref_name` env ara-değişkenden geçer (interpolation-injection yok).
- **Risk:** workflow yeşilliği damgalanmamış (06-KOR-NOKTA #6); diğer workflow'lar taranmadı.

## §12 Modül → 06-KOR-NOKTA boyut eşlemesi (kör-nokta tamlık kontrolü)

| Modül | Kapsayan boyut(lar) |
|---|---|
| server.ts, tool-registry, backend, tunnel | 1 güvenlik, 11 observability, 12 key |
| store, migrations | 2 test, 8 billing (usage) |
| providers | 7 performans |
| billing/stripe | 8 billing/para |
| src (SPA) | 3 docs, 7 perf(Lighthouse), 9 UX, 10 i18n |
| cli | 2 test, 3 docs |
| orchestration | 2 test, 11 observability |
| .github | 6 CI, 4 release |
| (repo geneli) | 5 lisans/audit, 13 worktree/branch hijyeni |

Boş kalan boyut = haritalanmamış modül = kör nokta. Şu an 13 boyutun hepsi ≥1 modülle eşleşiyor.
