# ODYSSEY 00 — MASTER (Üst-Bakış + Premise + Faz Haritası O0–O8 + Convergence + Birleşik Kör-Nokta Ledger + Dört-Şef)

> **Belge amacı:** `docs/odyssey/` altındaki **tüm 11 modül planının tek üst-bakış sentezi**. ODYSSEY
> programının kuzey yıldızı: mevcut **ollamas**'ı (Vite+React frontend `src/components`, Node `server.ts`,
> `server/mcp` host'u, `orchestration/` fleet, $0-local qwen3:8b + cloud katalog) **odysseus-kalitesinde**
> bir self-hosted AI-workspace'e evrimleştirmek.
> **Doğrulama disiplini:** her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek koduna karşı
> Read/Grep/`wc`/`ls` ile doğrulandı (tarih **2026-07-10**, §11 doğrulama günlüğü). Dil: TR · kod/komut/dosya-yolu: EN.
> **Bu belge modül dosyalarını yeniden yazmaz** — özetler, birleştirir, çelişkileri işaretler, program-düzeyi
> convergence + tek birleşik ledger üretir. Ayrıntı için her modülün kendi dosyasına git.

---

## 0. TL;DR (tek nefes)

ollamas bugün **güçlü bir agent/chat + operasyon-kokpiti**: `server.ts` (**3191 satır** / ~163 KB tek dosya,
`wc -l` doğrulandı), **22 React tab** (`src/App.tsx`), olgun bir `server/mcp/*` host'u (choke-point + upstream
federation + supervisor + interceptors), `orchestration/` fleet (conductor + council 14 model), $0-local
qwen3:8b + cloud katalog, **`server/rag.ts` sqlite-vec vektör-store (VAR)** ve `vite-plugin-pwa` (VAR).
**Fazlası** var (orchestra fleet, SaaS-billing, tier'lı tool-registry, drift-guard'lı host-tool manifesti) —
bunlar odysseus'ta yok. **Eksiği**, odysseus'un "kişisel AI-ofis" modülleri: **research (deep_research+SearXNG),
documents (PDF/office/markdown editör), email (IMAP/SMTP), notes/tasks (memory+cron), calendar (CalDAV/ICS),
local-models cookbook (donanım-farkında öneri)** + cross-cutting **2FA/RBAC/PWA-parity**. ODYSSEY = bu boşluğu
odysseus'un üç extensibility deseniyle (**MCP-as-extension + modular-services + config-driven .env**) kapatmak.
**Claude Design** bu programda yalnızca **UI-prototip üreticisi**dir (HTML+screenshot+README handoff); backend/DB/host
üretmez, localhost/MCP'ye bağlanamaz. **Convergence** = her YOK-modül ollamas'ta çalışır (route + servis + UI tab +
persistence) + `.env` toggle ile açılır-kapanır + odysseus-parity kabul kriteri + kalite kapısı (typecheck+lint+test+e2e)
geçer → tek-sayı `convergence_score → 1.0`.

**Kritik gerçek (koda karşı):** altyapı beklenenden olgun — RAG uçurumu **kısmen kapalı** (`server/rag.ts`+`sqlite-vec`
VAR), MCP host **%70 hazır**, PWA plugin VAR. O0 çoğunlukla **yeni-inşa değil entegrasyon+formalizasyon** → program
eforu ilk sezgiye göre aşağı çekildi (paralel ~30–38 ajan-oturumu, seri ~58–74; ±%30).

---

## 1. ODYSSEY nedir — Premise (KRİTİK sınır)

### 1.1 Ne inşa ediyoruz
odysseus'un **kavram-paritesi** (birebir port değil): aynı *modül yetenekleri* + aynı *extensibility desenleri*,
ollamas'ın kendi stack'inde (Node/TS + React/Vite, FastAPI/VanillaJS değil; ChromaDB yerine sqlite-vec). odysseus'un
fazlası (orchestra fleet, SaaS-billing, host-tool drift-guard) **korunur**.

### 1.2 Claude Design'ın rol sınırı (değişmez kural)
| Claude Design YAPAR | Claude Design YAPMAZ |
|---|---|
| UI prototip (HTML/JSX + inline CSS), mock veriyle ekran | Backend/API/DB/host **üretmez** |
| Handoff bundle: `HTML + screenshot + README` (tasarım niyeti/spec) | `localhost` / ollamas server / MCP'ye **bağlanamaz** |
| Component varyant + tasarım token iskeleti | Canlı veri **çekemez** (CSP + no-localhost); app-runtime **değil** |

**Sonuç:** Claude Design çıktısı asla "çalışan modül" sayılmaz — yalnızca **spec + UI iskelet**. Runtime, veri,
güvenlik, MCP her zaman **Claude Code** tarafında ollamas koduna yazılır.

### 1.3 Üç-aşamalı handoff workflow (her modül için aynı)
```
[1] Claude Design  → UI prototip (mock) → handoff bundle (HTML + screenshot + README)
[2] Claude Code    → bundle'ı MEVCUT ollamas'a implemente (TDD):
                     frontend src/components/<Modül>.tsx · backend server/modules/<ad>/ + route
                     · MCP server/mcp/* extension · persistence O0 store (SQLite + sqlite-vec)
[3] Deploy         → mevcut boot/launch pipeline (start.sh/Docker) → /api/health yeşil
```

---

## 2. Mevcut ollamas — VAR/YOK Envanteri (koda karşı doğrulandı, 2026-07-10)

### 2.1 VAR (brownfield — üstüne inşa edilecek)
| Yetenek | Kanıt | Not |
|---|---|---|
| Agent chat + tool-exec loop | `server.ts` `POST /api/agent/chat`, `plan.runAgentLoop` (`server.ts:2994`) | odysseus `agent_loop` muadili |
| MCP host (choke-point + federation) | `server/mcp/{server,client,catalog,supervisor,upstream-guard,discovery,prompts}.ts` + `server/tool-registry.ts` + `server/tool-interceptors.ts` | "MCP-as-extension" temeli **olgun (%70)** |
| Tek choke-point `execute()` | `server/tool-registry.ts:882-961` (ownership→allowedTiers→scope→pre→invoke→outputSchema→post) | tüm tool çağrıları buradan; **asla throw etmez** |
| Tier'lı tool modeli + ajv | `ToolTier = safe\|host\|privileged\|host_upstream` (`:43`) + `outputSchema` ajv doğrulama | odysseus `tool_policy` yapısal karşılığı |
| Interceptor chain (gwv2 embriyosu) | `tool-interceptors.ts` `registerInterceptor`/`runPre`/`runPost` + `redactionInterceptor`+`cacheInterceptor` | cross-cutting extension seam **VAR** |
| Host-tool manifest + drift-guard | `scripts/inventory.json` + `bin/host-bridge/{schema.mjs,register-host-scripts.mjs,drift-check.mjs}` | **odysseus-üstü** (compile-time garantili) |
| Orchestration / fleet / council | `orchestration/*` (conductor + `COUNCIL_ROSTER.json` 14 model) | odysseus'ta **yok** — ollamas fazlası |
| Frontend tab-shell (**22 tab**) | `src/App.tsx` (`activeTab === "…"`; `grep -c "id:"` → 22) | modüler tab iskeleti hazır |
| SQLite store + `sqlite-vec` + RAG | `server/store/{index,migrations,db-adapter}.ts` (migration **v1→v6**); `server/rag.ts` ayrı `DatabaseSync{allowExtension}` + sqlite-vec; dep `sqlite-vec@0.1.9` | vektör-store **VAR** (persistence uçurumu kısmen kapalı) |
| Files/workspace altyapısı | `server/files.ts` (path-guard `resolveSafePath`, binary-safe R/W, unified diff), `/api/workspace/*` | editör/upload-validation YOK |
| Config-vault (şifreli) | `server/db.ts:312-344` `encrypt/decrypt` (AES-256-GCM, `iv:tag:ciphertext`, authTagLength=16, keychain master-key) | TOTP secret için hazır primitiv |
| Auth katmanı (olgun) | `localOwnerGuard` (`server.ts:276-294`), `authMiddleware` (3 kimlik yolu `auth.ts:99-124`), `adminGuard` (timingSafeEqual + brute-force throttle `:2566`), `requireScope`, rate-limit | tenant+plan+scopes → `req.tenant` |
| Scheduler primitifleri (kullanıcı-yüzeyli DEĞİL) | `webhooks/outbound.ts` claim/retry drain, `mcp/supervisor.ts` tick, `oauth-gc.ts`, `orchestration/reconcile.ts --watch` | ortak scheduler için **desen VAR** |
| PWA + theme + i18n | `vite-plugin-pwa` (VAR), `src/lib/theme.tsx`, `src/locales/{en,tr}.ts` (Lingui), Tailwind v4 token'ları | dark/light var; manifest gerçek-durum bkz KN-M8 |
| MCP SDK + JWT | `@modelcontextprotocol/sdk@1.29`, `jose@6`, `zod@3.25` | TOTP kütüphanesi yok (aşağı) |

### 2.2 YOK (odysseus-parity boşluğu — ODYSSEY'in inşa hedefi; grep-teyitli)
| Odysseus modülü | Durum | Kanıt |
|---|---|---|
| Research (deep_research + SearXNG) | ❌ YOK | `searxng`/deep-research eşleşmesi yok; `ECySearcherPanel` kod/threat arama (deep-research değil) |
| Documents (PDF/office/markdown editör + upload-validation) | ❌ YOK | `unpdf/mammoth/xlsx/marked/dompurify` deps **yok** (teyit); editör = ham `<textarea>` (`WorkspaceTree.tsx:255`) |
| Email (IMAP/SMTP + triage) | ❌ YOK | `imapflow/nodemailer/mailparser` deps **yok**; sadece Firebase Gmail-readonly metadata-only (`GmailBrowser.tsx`) |
| Notes/Tasks (memory + cron scheduler) | ❌ YOK | kalıcı kullanıcı not/task tablosu + reminder scheduler yok; `task-progress.ts`/`note.ts` = dev-orchestration (isim çakışması) |
| Calendar (CalDAV/ICS) | ❌ YOK | `tsdav/node-ical/ical-generator/rrule` deps **yok**; sadece Google-read browser (`GoogleCalendarBrowser.tsx`) |
| Local-models Cookbook (donanım-farkında öneri) | ❌ YOK | katalog var (`cockpit-models.ts`/`embed-catalog.ts`), fit-score/hw-detect motoru yok |
| **Cross-cutting** MCP-ext hooks/manager | ❌ YOK | `server/mcp/hooks.ts` + `manager.ts` yok (teyit); interceptors.ts embriyo |
| **Cross-cutting** module-registry + config-toggle | ❌ YOK | `server/module-registry.ts` + `server/modules/` yok (teyit); `MODULE_*` toggle ailesi yok |
| **Cross-cutting** 2FA/TOTP + gerçek RBAC | ❌ YOK | `otplib/otpauth/qrcode` deps **yok**; `tenants` tablosunda `role` yok; `server/security/` dizini yok (teyit) |

### 2.3 Yanıltıcı benzerlikler (plan-tuzağı)
1. **Google tab'ları ≠ odysseus modülleri.** `gmail`/`calendar`/`drive`/`sheets` tab'ları **Google SaaS OAuth
   browser** panelleri (`GmailBrowser.tsx` metadata-only "privacy hard law", `GoogleCalendarBrowser.tsx` read-only) —
   self-hosted IMAP/SMTP ya da CalDAV/ICS **değil**. UI iskeleti yeniden kullanılabilir; backend sıfırdan.
2. **Harici claude.ai connector'ları ≠ ollamas backend'i.** Deferred tool listesindeki `020ccfa7__*` (Gmail),
   `c7f423f1__*` (Calendar), `0dafc7f3__*` (Drive) **claude.ai harness connector'ları** — ollamas'ın `/mcp`
   choke-point'ine (`http://127.0.0.1:8090/mcp`, `.mcp.json`'da yalnız `ollamas`/`context7`/`deepwiki`) **bağlı değil**.
3. **Üç ayrı persistence dünyası** (02-arch §0): (a) `server/db.ts` JSON-file şifreli vault, (b) `server/store/*`
   SQLite/pg tenant+billing, (c) `server/rag.ts` **ayrı** `DatabaseSync` sqlite-vec. Yeni modüller hangi dünyaya
   yazacak? **Karar (02-arch):** modül-verisi → `store`, vektör → `VectorStore`, vault yalnız secret. **O0 blocker.**
4. **"task"/"note" isim çakışması** (notes-tasks §1.1): `orchestration/bin/lib/task-progress.ts`+`note.ts` dev-loop
   ledger'ı; kullanıcı-yüzeyli değil. Yeni modüller `server/modules/` altında izole; import-guard ile çapraz-import yasak.
5. **Config-driven yarı-parity:** `.env.example` = **21 anahtar** (`grep -c` teyit; modül .md'lerin "38/40+/46" iddiaları
   kod-içi runtime-toggle'ları da sayıyor — çelişki KN-M9). `MODULE_*` toggle ailesi **yok**, YAGNI ile eklenecek.
6. **`server.ts` monolit riski:** 3191 satır, 100+ inline route. Yeni modüller `server/modules/<ad>/` ayrıştırması
   yapılmazsa borç patlar + 22-tab sidebar taşar (KN-M5).

---

## 3. Faz Haritası O0–O8 (kanonik) — Dosya Eşlemesi

> **Numaralandırma notu (KN-M1):** dosya adları (`01/02/03/06/07/09/10`) ile dosya-içi başlıklar (`O0/O1/O2/O5/O6/O8`)
> **çelişiyor** ve O-serisi seyrek (`04/05-tekil/08` yok). Aşağıdaki **O0–O8 kanonik faz haritası** program-omurgasıdır;
> "Kaynak dosya" sütunu her fazın sahip belgesini gösterir. Yeniden-adlandırma (`NN-oN-<ad>.md`) T0 kararı.

| Faz | Ad | Bağımlılık | Kaynak dosya(lar) | Plan durumu |
|---|---|---|---|---|
| **O0** | **Temel Katman** (VectorStore soyutlama + `module-registry` config-toggle + migration v7 + ortak scheduler) | **BLOCKER** — diğer her şey buna bağlı | `02-architecture.md` (Faz A0–A4) + `10-roadmap.md §2 O0` | **plan tam** (`02` mimari sahibi); `02-o0-foundation` tam-TDD detayı hâlâ önerilir |
| **O1** | **Modüler Servis + MCP-as-Extension** (`server/modules/*` iskelet + hook framework `hooks.ts` + `manager.ts` manifest + lifecycle FSM + audit) | O0 (store audit) | `02-architecture.md` (P2) + `06-extensibility.md` + `05-features/mcp-extensions.md` | **plan tam** |
| **O2** | **Research** (deep_research + SearXNG adapter + cited synthesis) | O0 (VectorStore) | `01 §5 Faz1` + `03-claude-design-ui.md §3.2` | **plan-tohum + UI-brief** (feature .md YOK → KN-M2) |
| **O3** | **Documents** (processor PDF/DOCX/XLSX/MD + writing-first editör + upload-validation) | O0 (store/RAG) | `05-features/documents.md` + `03 §3.3` | **plan tam** |
| **O4** | **Email** (sağlayıcı-agnostik IMAP/SMTP + triage/summary/draft, ToolRegistry-native tools) | O1 (choke-point), vault | `05-features/email-mcp.md` + `03 §3.4` | **plan tam** |
| **O5** | **Notes/Tasks** (memory + cron scheduler + agent-assign + reminder) | O0 (store + ortak scheduler) | `05-features/notes-tasks.md` + `03 §3.5` | **plan tam** |
| **O6** | **Calendar** (CalDAV/ICS + recurrence + reminders, provider-agnostic) | O0 (store), O5 (ortak scheduler `cron.ts`) | `05-features/calendar-caldav.md` + `03 §3.6` | **plan tam** |
| **O7** | **Local-models Cookbook** (hw-detect + fit-score + pull-progress) | mevcut `cockpit-models`/`embed-catalog` | `01 §5 Faz6` + `03 §3.7` | **plan-tohum + UI-brief** (feature .md YOK → KN-M2) |
| **O8** | **Cross-cutting Security/Parity** (2FA/TOTP + RBAC role + role-aware tool-policy + poison-guard + threat-model + PWA) | O1 (tool-policy), O0 (store `role`/`totp`) | `07-security.md` + `03 §3.8` | **plan tam** |

**Yatay katmanlar:** `03-claude-design-ui.md` = 8 panel için Claude Design brief'i + handoff-bundle şablonu (her O-fazının
UI'ını besler, implementasyon değil). `09-testing-convergence.md` = tüm fazların parity/gate/ledger'ını **tek convergence
matrisine** toplar (canlı dashboard). `10-roadmap.md` = O0–O8'i **tek yürütme sırasına + bağımlılık grafiğine + efor
tahminine** bağlar. `06-extensibility.md` = sistem-geneli extensibility formalizasyonu (config.ts + route-split + DEVELOPER.md).

> **Sahiplik çakışma notu (06 KN-3):** `06-extensibility.md` (sistem-katmanı: config-merkez + route-split + dev-guide) ile
> `05-features/mcp-extensions.md` (feature-katmanı: plugin-protokol + hooks + FSM) O1'de kesişir. **Sınır:** hooks/manager/
> manifest/FSM → `mcp-extensions.md`; `config.ts`/route-modülerleştirme/`DEVELOPER.md` → `06-extensibility.md`. Çift-implement yasak.

### 3.1 Paralellik yasası (CLAUDE.md Tier-1)
```
O0 (BLOCKER) ──┬─→ O1 (modüler-servis + MCP-ext) ──┬─→ O4 (email)  ─────┐
               │                                    ├─→ O6 (calendar)   │
               │                                    └─→ O8 tool-policy   │
               ├─→ O2 (research)                                        ├─ paralel (O0 GREEN sonrası)
               ├─→ O3 (documents)                                       │
               ├─→ O5 (notes → ortak cron.ts, O6 reminders'ı bunu paylaşır)
               └─→ O7 (cookbook)                                        ┘
O8 (security cross-cutting): O8.1 TOTP ∥ O8.5 poison-guard bağımsız; O8.3 role-policy O8.2 role'e bağlı; O8.4 threat-model EN SON
```
**Kural:** O0 GREEN olmadan hiçbir modül fazı spawn edilmez. Faz-içi TDD: **RED → GREEN → REFACTOR**, gate
(typecheck+lint+fresh vitest+e2e) geçmeden commit yok, **implementer ≠ verifier**.

### 3.2 Uygulama sırası (10-roadmap §4 dalgaları, iş-büyüklüğü + bağımlılık ile hizalı)
```
W0: O0 (rag-service ∥ module-registry ∥ scheduler ∥ migration-v7)      [BLOCKER, efor M]
W1: O1 (modüler-servis + role kolonu v7) ∥ O2-design başlar           [S–M]
W2: O1-mcp-ext(hooks/manager) ∥ chat-UX(S) ∥ O7 cookbook(M)           [M]
W3: O3 documents(M) ∥ O2 research(M)  (rag-bağlı)                     [M–L]
W4: O5 notes(L) ∥ O6 calendar(L) ∥ O4 email(L)  (scheduler+MCP-ext'e bağlı; en ağır dalga) [L]
W5: O8 security(XL) (TOTP ∥ poison-guard → RBAC→policy→step-up → threat-model SON) [XL]
W6: deploy/PWA(M) → W7: O8-test parity-gate + e2e(M)
```
Her durakta T0 kapısı: Emre onayı → handoff bundle → TDD kırmızı→yeşil → gate → commit. **CRITICAL gizleme YASAK.**
**Critical path:** `O0 → O1 → O4/O6(email/calendar) → O8 → deploy → test`.

---

## 4. Convergence Tanımı (odysseus-parity kabul)

### 4.1 Formal (09-testing §1)
```
converged(M)  ⇔  parity(M)=1.0 (tüm kabul kriteri GREEN)
             ∧  gate(M)=GREEN  (typecheck ∧ lint ∧ vitest-fresh ∧ e2e)
             ∧  ledger(M)=CLOSED (her kör-nokta test/karar/kapsam-dışı ile kapandı)

CONVERGED(Odyssey) ⇔ ∀ M ∈ {O0..O8, Design/PWA} : converged(M)
convergence_score = (Σ geçen_kapı) / (Σ toplam_kapı) → hedef 1.0
```
**Ledger-CLOSED kuralı:** madde kapanır ⇔ (a) doğrulama testi/komutu yeşil, VEYA (b) Emre kararı (T0) kayda geçer,
VEYA (c) kapsam-dışı işaretlenip gerekçesi yazılır. "Bilinmeyen" bırakmak = ledger AÇIK = modül **converged değil**.
**CRITICAL kapılar** (güvenlik/izolasyon/regresyon) `convergence_score` 1.0'a ulaşsa bile **her biri ayrıca GREEN** olmalı.

### 4.2 Modül-başı parity (6 kriter — hepsi GREEN olmalı; 01 §7 + 09 §1)
1. **Fonksiyon:** modülün ana yeteneği ollamas'ta çalışır (o modülün RED testi artık GREEN).
2. **Extensibility:** MCP-as-extension ya da modular-service olarak takılı; `server.ts` monolitine gömülü değil (`server/modules/<ad>/`).
3. **Config-driven:** `.env` toggle (`MODULE_<AD>` / `ENABLE_*` / `<AD>_MCP_ENABLED`) modülü açar-kapar; kapalıyken route 404/gizli, araç `/mcp`'de görünmez.
4. **Persistence:** veri O0 store'a yazılır, restart-kalıcı (JSON-only regresyon yasak; RAG gerekiyorsa VectorStore).
5. **UI:** Claude Design prototipinden türetilmiş tab `App.tsx`'e entegre; tema + i18n (EN+TR) uyumlu.
6. **Kalite kapısı:** `typecheck ✓ lint ✓ vitest (fresh) ✓ e2e (ilgili) ✓`.

### 4.3 8-Gate tanımı (09-testing §3 — her modülün ön-koşulu)
`G1` typecheck (`tsc --noEmit`) · `G2` lint (`eslint`) · `G3` unit/integration fresh (`vitest run`) · `G4` e2e (`playwright`) ·
`G5` build (vite+esbuild+mcp-stdio) · `G6` SEA/native-binding guard (documents/email/calendar deps) · `G7` migration idempotent
(DB dokunan modüller) · `G8` supply-chain (`npm audit` + lisans MIT/ISC pin).

### 4.4 Convergence Skor Tablosu (09-testing §5 — canlı payda, taslak-modüller eklenince revize)
| Faz/Modül | Toplam kapı | CRITICAL | Bugün GREEN | Kaynak |
|---|---|---|---|---|
| O0 Temel | 4 | 2 | 0 | `09 §4.1` |
| O1 MCP-Ext | 10 (P1–P10) | 5 | 0 | `mcp-extensions.md §5` |
| O3 Documents | 10 (P1–P10) | 6 | 0 | `documents.md §4` |
| O4 Email | 9 | 4 | 0 | `email-mcp.md §5` |
| O6 Calendar | 8 | 5 | 0 | `calendar-caldav.md §5` |
| O8 Security | 8 | 6 | 0 | `07-security.md §6` |
| Design/PWA | 4 | 1 | 0 (DES-3 kısmi) | `03` + `01 §7` |
| O2 Research (taslak) | 2 | 0 | 0 | `01 §5` türetme |
| O5 Notes (taslak→tam) | 2→9 | — | 0 | `notes-tasks.md §5` (9 kriter) |
| O7 Cookbook (taslak) | 2 | 0 | 0 | `01 §5` türetme |
| **TOPLAM (09-testing kaba)** | **~59 (payda vN)** | **29** | **0/59** | `09 §5` |

> **Not (KN-M4):** `09-testing` bu tabloyu **59 kapı** ile dondurmuş ama Notes ledger'ı **9 kabul kriteri** verir
> (taslak "2"nin yerine); Research/Cookbook feature .md yazılınca (§KN-M2) her biri ~8–10'a çıkar → payda **~75'e**
> yaklaşır. `convergence_score` paydası feature .md'ler tamamlanınca **dondurulmalı** (09 KN-C4).

### 4.5 Nihai test (program CONVERGED ilanı)
6+ modül canlı, `.env` toggle ile açılır-kapanır, dört durumu (boş/yükleniyor/hata/başarı) render eder, dark/light çalışır,
klavye-öncelikli, backend'e gerçek bağlı, 2FA/RBAC enforce, poison-guard aktif, e2e-1..8 (09 §6) yeşil, migration v1–v6
zinciri kırılmadı → **ollamas = odysseus-kalitesinde AI-workspace**.

---

## 5. Dört-Şef İlişkisi (ODYSSEY yürütme modeli)

ODYSSEY, ollamas'ın mevcut **çok-şef orkestrasyon** modeliyle yürütülür (memory: `ollamas-completion-plan`). Bu, CLAUDE.md
komuta zincirinin (T0 Emre → T1 Planlamacı → T2 Subagents → T3 Skills) ollamas'a özgü somutlaşması.

| Rol | Kimlik (son bilinen) | Worktree / branch | Sorumluluk | ODYSSEY karşılığı |
|---|---|---|---|---|
| **Planlamacı** (bu sekme) | Fable-5 / Opus | `~/Desktop/ollamas` (read-only izler) | Plan üretir, T0'a rapor, plan dosyalarını append; **repo'ya yazmaz** (tek-yazar yasası) | ODYSSEY plan dokümanları (bu dizin) |
| **Şef-1** | default/Sonnet | `~/Desktop/ollamas`, `feat/key-autonomy` | Ana trunk kapanış (vC0–vC8); merge otoritesi | **O0 temel katman** (blocker) + trunk merge kapısı |
| **Şef-2** | Opus | `~/Desktop/ollamas-revenue-wt`, `feat/revenue-first-payment` | Gelir hattı (revenue/billing/storefront) — dosya-yüzeyi izole | ODYSSEY-dışı paralel (SaaS fazlası); O8 RBAC ile kesişir |
| **Şef-3** | Sonnet | `~/Desktop/ollamas-gwv2-wt`, `feat/gwv2-cherrypick` | gwv2 cherry-pick: **hooks/poison-guard/result-cache/input-validate** + OAuth ADR | **O1 MCP-ext (hooks.ts)** + **O8.5 poison-guard** doğrudan sahibi |
| **Şef-4** | Haiku | `~/Desktop/ollamas-cockpit-wt`, `feat/cockpit-v1` | Cockpit (cluster/capabilities/federation-status UI + apiClient temizliği) | **O7 cookbook** UI zemini (cockpit-models paneli) + federation UI |

### 5.1 Şef-koordinasyon değişmezleri (memory'den, ODYSSEY'e taşınan)
- **Tek-yazar izolasyonu:** her şef ayrı branch + dizin + `*_PROGRESS.md` + **dosya-yüzeyi**; çakışma yok.
- **Kaynak koordinasyonu:** 3+ ayrı `PORT_BASE`; **eşzamanlı full `npm test` YASAK** (port + GPU çakışması); GPU'da
  ollama-ağır şef (Şef-2) önceliği.
- **Merge sırası bağımlılığı:** Şef-3 (gwv2/O1) dosya yüzeyi `server/mcp/*` + `tool-registry` → **Şef-1'in ilgili merge'i
  trunk'a inene kadar ERTELER** (T0). Bu, ODYSSEY'de **O0 → O1** bağımlılığının somut hali.
- **Aktivasyon sınırı (KRİTİK operasyonel):** yeni `claude` Terminal oturumları "manual mode on" açılır; `osascript`
  keystroke Terminal.app TUI'sine **ulaşmıyor** → Planlamacı şef başlatabilir ama **Emre her pencereyi bir kez elle
  aktive etmeli**. Şef brief'i "SENİN ANA GÖREVİN, açılış diyaloglarından bağımsız" ile başlamalı (Şef-2'nin takılma dersi).
- **gwv2 dalı kararı:** full-revive **HAYIR**; 4-haftalık **cherry-pick** (hooks/poison-guard/result-cache/input-validate;
  OAuth OPAQUE kalır). Bu ODYSSEY O1+O8.5'in kaynağı — dal **merge edilmez, seçmeli alınır**.

### 5.2 ODYSSEY şef-atama önerisi (faz → şef eşlemesi)
```
O0 (temel katman)      → Şef-1 (trunk, blocker; diğer şefler bekler)
O1 (mcp-ext hooks/mgr) → Şef-3 (gwv2 cherry-pick zaten bu yüzey)  ·  O1 (modüler-servis iskelet) → Şef-1
O8.5 (poison-guard)    → Şef-3 (gwv2 paketinde)
O7 (cookbook UI)       → Şef-4 (cockpit-models zemini)
O2/O3/O5/O6 (modüller) → O0 GREEN sonrası yeni izole worktree'lere paralel spawn
O8.1-O8.3 (2FA/RBAC)   → EN SON (Şef-2 revenue/RBAC kesişimi koordine)
```

---

## 6. Handoff Sözleşmesi (Claude Design ↔ Claude Code, her faz)

| Adım | Sahibi | Çıktı | Kabul |
|---|---|---|---|
| UI prototip | Claude Design | `HTML + screenshot + README` (mock) | Emre görsel onay |
| Implement | Claude Code | `src/components/*.tsx` + `server/modules/*` + test | typecheck+lint+test GREEN |
| Persist/MCP | Claude Code | O0 store / `server/mcp/*` extension | ilgili test GREEN |
| Deploy | Claude Code | mevcut boot pipeline | `/api/health` yeşil |

**Bundle şablonu** (`docs/odyssey/handoff/<panel>/`): `PROMPT.md · design.html · screenshot.png (+screenshot-light.png)
· HANDOFF.md (component adı, prop imzası, i18n anahtar listesi, /api sözleşmesi, mock→real map) · tokens.snippet.css`.
**Değişmez:** bundle localhost/MCP'ye bağlanmaz; canlı veri Claude Code entegrasyonunda gelir. **İlk panelde (chat)
gerçek Design export ile pilot** → §6 şablonunu ampirik düzelt (KN-M3).

---

## 7. Birleşik Kör-Nokta Ledger (11 modül dosyasının ledger'ları toplandı)

> Tip: V=Varsayım · B=Bilinmeyen · R=Risk · G=Doğrulama-açığı · K=Kapsam/Karar. Program-düzeyi olanlar `KN-M*`.
> **CRITICAL gizleme YASAK** — Emre-kararı ve CRITICAL maddeler ilk sıralarda.

### 7.0 Program-düzeyi (en kritik, ilk sıra)
| # | Tip | Madde | Etki | Azaltma |
|---|---|---|---|---|
| **KN-M1** | R | **Faz numaralandırma tutarsızlığı:** dosya adları (`01/02/03/06/07/09/10`) ↔ başlıklar (`O0/O1/O2/O5/O6/O8`) çelişiyor; O-serisi seyrek | Şef yanlış dosyaya bakar | **T0 karar:** bu §3 O0–O8 kanonik; dosyaları `NN-oN-<ad>.md`'ye yeniden adlandır; bir `00-index.md` O-haritası (09 KN-C6/O8-K6) |
| **KN-M2** | R (blocker) | **Research/Notes/Cookbook feature .md eksikliği kapandı-mı?** Notes/Tasks ARTIK var (`notes-tasks.md`); **Research + Cookbook feature .md hâlâ YOK** — yalnız plan-tohum + UI-brief | O2/O7 plansız spawn olur | Kodlama-öncesi `research.md` + `cookbook.md` yaz (documents/email emsali); §4.4 payda güncelle |
| **KN-M3** | V/B | **odysseus repo doğrulanmadı** (github.com/pewdiepie-archdaemon/odysseus, 82k★) — task-brief'ten, koddan/fetch'ten değil. **Tüm** modül ledger'ları aynı bilinmeyeni tekrarlıyor (doc-K9, email-A1, cal-K, mcp-K, sec-VAR, 09-KN-1/C7) | Parity hedefi yanlış kalibre olabilir | **O0 öncesi** odysseus README/mimari WebFetch+doğrula; sapmada tüm belgeler güncellenir. Parity **listelenen alt-yeteneklere** göre tanımlandı, API imzaları ollamas-native |
| **KN-M4** | R (blocker) | **O0 persistence-uçurumu (kısmen kapalı):** `server/rag.ts`+`sqlite-vec` **VAR** ama (a) modül tabloları + RAG-embedding kalıcılığı yok, (b) **üç ayrı DB dünyası** (db.ts/store/rag.ts) birleşmiyor. O0 yapılmazsa research/documents/notes parity **imkânsız** | Program blocker | O0 kesin ilk; **karar (02-arch):** modül→`store`, vektör→`VectorStore` (rag.ts sarar), vault yalnız secret; `sqlite-vec` kalır, ChromaDB opsiyonel-MCP |
| **KN-M5** | R | **`server.ts` 3191-satır monolit + 22-tab sidebar taşması:** her modül route/tab buraya eklenirse borç + nav UX bozulur | Bakım + UX | O0'da `module-registry` + `server/modules/<ad>/` zorunlu (strangler-fig: yeni ayrık, eski aşamalı extract); nav için ⌘K komut-paleti / kategori-gruplama (03 K4) |
| **KN-M6** | K (Emre) | **Google tab'ları korunacak mı / self-hosted ile değişecek mi?** (vision KN-5, cal-K7/K9, email-D1/R5) | Kapsam + çift-bakım | **Emre kararı (T0):** "harici-SaaS + self-hosted yan-yana" mı "yalnız self-hosted" mı. Modül planları "provider olarak koru/absorbe" varsayıyor; GmailBrowser metadata-only privacy-law bozulmaz |
| **KN-M7** | V (Emre) | **"Şef-3 gwv2 / poison-guard" terminolojisi:** `hooks.ts`/`gwv2` kodda YOK (teyit); `tool-interceptors.ts` embriyo kabul edildi. "Poison-guard" da yeni-inşa | O1/O8.5 kapsam belirsizliği | **Emre onayı:** gwv2 = yeni `server/mcp/hooks.ts`; poison-guard = defense-in-depth (asıl savunma verifier-izolasyonu, RISK-4) |
| **KN-M8** | G | **PWA gerçek-durum çelişkisi:** `01/03` "manifest YOK" der ama `vite-plugin-pwa` devDep VAR + `tests/ui/pwa.test.ts` KODDA VAR (09 KN-C2) | "PWA parity" iddiası eksik/yanlış | O8-PWA öncesi `vite.config.ts` VitePWA config + `public/manifest` + `pwa.test.ts` Read → DES-3 gerçek durumu netleş |
| **KN-M9** | V/G | **Config-toggle sayı çelişkisi:** `.env.example`=**21** (`grep -c` teyit) ama email/mcp/06 "40+/46/38" der (kod-içi runtime-toggle'ları sayıyor) | Config-parity iddiası şişirilmiş | `06-Adım1` `config.ts` şeması yazılınca kesin sayı + `.env.example`↔`config.ts` drift-guard testi; "40+" hedef değil doğal-sonuç (YAGNI) |
| **KN-M10** | G | **Baseline test yeşil-mi bilinmiyor** (09 KN-C6): mevcut ~425 test + `conformance/mcp-stdio/rag` e2e bu oturumda **koşulmadı** | Gate G3/G4 kararsız (flaky RED) | O0 öncesi `npx vitest run` + `playwright test` baseline al; live-gated testleri `skipIf(!LIVE)` ile ayır |

### 7.1 O0 — Temel Katman (`02-architecture.md §7`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| KN-A1 | R | strangler-fig: yeni modüller ayrık ama 200+ route in-line kalır (tam de-monolit kapsam-dışı) | Kabul: O0/O1 = büyümeyi durdur; tam extract ayrı temizlik dalgası |
| KN-A3 | R | sqlite-vec `DatabaseSync{allowExtension}` çok-replika: pg-modda vektör pg'ye taşınmaz (pgvector değil) | sqlite-vec tek-node/local-öncelik; pg-vektör O5+ opsiyonel-MCP, işaretlendi |
| KN-A4 | B | `node:sqlite` `DatabaseSync` API kararlılığı (Node 22 experimental) | `VectorStore` arayüzü impl'i soyutlar; kırılırsa better-sqlite3 swap |
| KN-A7 | K | `ModuleDef.migrations` numaralandırması modül-lokal olursa çakışır (iki modül v7) | migration-numarası global-monoton (registry merkezi atar); A1.3 testi korur |
| KN-A9 | R | `mountEnabledModules` sırası: auth/owner-guard'dan önce mount edilirse modül-route guard'sız | Karar: `localOwnerGuard`+`authMiddleware`'den SONRA mount; A4.2 sıra-testi |

### 7.2 O1 — MCP-as-Extension + Extensibility (`mcp-extensions.md §6` + `06 §6`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| mcp-K1 | V (Emre) | gwv2/hooks.ts kodda yok (→ KN-M7) | interceptors.ts üstüne inşa; isim T0 sabitle |
| mcp-K2 | R | `tools/list_changed` advertise conformance kırabilir | `MCP_LIST_CHANGED=1` opt-in, default kapalı |
| mcp-K8 | R (CRITICAL) | boot fan-out `installPlugin`'e taşıma Faz-24 owner-izolasyonu kırabilir | owner-preservation testi zorunlu (P8) |
| mcp-K9 | B | `catalog/supervisor/interceptors` characterization testi yok | refactor öncesi kilitleyici test yaz |
| 06-KN-4 | R | route-split regresyon riski (middleware order, `express.raw` sırası kritik) | saf-taşıma + supertest regresyon suite + order-snapshot; küçük partiler |
| 06-KN-7 | R | interceptor sırası (poison-guard redact'tan önce/sonra?) → leak/kaçak | register-order explicit belgele (DEVELOPER.md Recipe C) + order-sensitive test |

### 7.3 O3 — Documents (`documents.md §5`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| doc-K1 | V | `unpdf`/`pdfjs` saf-JS + SEA-uyumlu | `npm ls` native-binding tara (G6); `unpdf` worker'sız |
| doc-K2 | B | `dompurify`/`jsdom` SEA-bundle taşınır mı | `isomorphic-dompurify` ya da client-only render |
| doc-K3/K6 | R (CRITICAL) | XLSX/PPTX bellek + global `express.raw` 1gb DoS yüzeyi | `MAX_EXTRACT_CHARS`, per-tür limit, magic-byte erken-red |
| doc-K5 | B | `permissions.fileRead/Write` hangi kapıya bağlanmalı | extract=fileRead; upload=fileWrite (mevcut) |

### 7.4 O4 — Email (`email-mcp.md §6`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| email-A1 | V | `imapflow/nodemailer/mailparser` MIT+host-yalın | `npm view license` + G8 (kod-dışı, açık) |
| email-R2 | R | IMAP/SMTP parola (OAuth değil) hassas | vault + app-password/XOAUTH2; düz-parola uyarısı |
| email-R3 | R | SSRF-guard vs self-hosted RFC1918 çelişkisi | `EMAIL_ALLOW_INTERNAL_HOST` opt-in, kapalı-varsayılan |
| email-D1/D2/D3 | K (Emre) | Sağlayıcı-agnostik mi Gmail-API mi; varsayılan model; per-tenant vault | Öneri: IMAP/SMTP baz + opsiyonel XOAUTH2; qwen3:8b; tek-kiracı önce |
| (kapandı) | ✅ | A2/A3/A4 (ai.ts `generateText`, db.encrypt/decrypt, `server.ts:102` bootstrap) koda karşı doğrulandı | email §6, §7 |

### 7.5 O5 — Notes/Tasks (`notes-tasks.md §6`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| notes-K2 | R | isim çakışması: orchestration `task-progress.ts`/`note.ts` ↔ yeni `server/modules/{notes,tasks}` | net ayrım (kullanıcı `server/`, dev `orchestration/`); import-guard lint |
| notes-K3 | B | agent yürütme yüzeyi (`agent-events.ts` mi `backend/orchestrator` mi `server/orchestrator.ts` mi?) | Faz5 öncesi en stabil public agent API teyit |
| notes-K4/K11 | R/V | cron dep `croner` vs zero-dep custom (DST/edge riski + supply-chain) | `croner` (MIT, savaş-testli, tz-aware) tercih; zero-dep alt-küme hazır; `npm ls` pin |
| notes-K7 | R | scheduler `setInterval` tek-replica varsayar; pg multi-replica çift-tetik | `claimDueTasks` atomik claim (webhooks deseni, çok-replica-güvenli); `withLock` |
| notes-K10 | K (O8) | agent-assign RBAC gerektirir (düşük-yetkili güçlü agent'ı tetikler) | CRUD tenant-scoped; agent-assign yetkisi O8-RBAC'a bağlanır; başta yalnız tenant-admin |

### 7.6 O6 — Calendar (`calendar-caldav.md §6`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| cal-K1 | ✅ ÇÖZÜLDÜ | ortak scheduler yok ama `setInterval` tick deseni VAR (webhooks/supervisor/oauth-gc) | reminder scheduler O5 `cron.ts`'i paylaşır (tek zamanlayıcı) |
| cal-K3 | R | `tsdav` iCloud/Google CalDAV quirk'leri kırılgan | unit mock; canlı Radicale (docker); quirks notu |
| cal-K4 | R (CRITICAL) | sonsuz RRULE OOM | zorunlu `{from,to}` pencere + max-occurrence cap (1000) |
| cal-K5/K8 | B | auth katmanı (tenant/apikey vs Firebase) + TZID stratejisi | Faz4 öncesi middleware teyit; `dtstart` UTC + `tzid` + `all_day` |

### 7.7 O8 — Security (`07-security.md §7`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| sec-VAR1 | V (Emre) | "Şef-3 poison-guard" kodda yok (→ KN-M7) | verifier-deseni uzantısı; Emre onayı |
| sec-VAR3/GAP1 | ✅ KAPALI | TOTP secret `db.encrypt` AES-256-GCM ile (`db.ts:312-344` okundu) | mevcut vault primitivi yeterli |
| sec-GAP2 | ✅ KAPALI | `ToolCtx.role/confirmToken` wiring: `mcpCtxFactory` (`server.ts:2385-2394`) + lokal agent-loop (`:1546-1548`) okundu | `role:t?.role`; lokal `role:"admin"` |
| sec-BIL1 | B (Emre) | Lokal mod (SAAS_ENFORCE≠1) owner'a 2FA uygulanmalı mı | varsayım: yalnız SAAS_ENFORCE=1 admin; Emre kararı |
| sec-R1 | R (CRITICAL) | RBAC `role` migration owner'ı yanlışlıkla non-admin yapabilir | tek-tenant → `role='admin'` backfill; idempotent test |
| sec-R2 | R (CRITICAL) | step-up gate yanlış zincir (kilit/bypass) | `authMiddleware→requireRole→requireTotp` sıra e2e sabitle |
| sec-R4 | R | poison-guard güvenlik-teatrosu (regex LLM-saldırı atlar) | **dürüst kabul:** defense-in-depth; asıl savunma verifier-izolasyonu (CLOSED) |
| sec-GAP3 | K (Emre) | O8 `orchestration/TASKS.json` dispatch kuyruğunda yok | Emre onayıyla `SEC.O8.*` görevleri ekle |

### 7.8 UI katmanı (`03-claude-design-ui.md §5`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| ui-K3 | R | notes/research/email/calendar/cookbook için backend YOK — UI-brief tek başına çalışan panel üretmez | UI-brief ≠ implementasyon; backend O-fazlarına refere |
| ui-K4 | V | 22→28+ tab sidebar taşırır | ⌘K komut-paleti / kategori-gruplama (→ KN-M5) |
| ui-K6 | R (CRITICAL) | 2FA/RBAC UI mock kolay, backend enforce olmazsa sahte-güvenlik | backend-önce TDD; test yeşil olmadan UI ship YASAK |
| ui-K7 | V | Gmail metadata-only "privacy hard law" korunmalı | EmailPanel ayrı dosya, GmailBrowser'a dokunmaz |
| ui-K8 | B | SearXNG/ChromaDB kurulu değil (harici bağımlılık) | `ENABLE_RESEARCH` + SearXNG-down honest-empty |

### 7.9 Testing/Convergence-özgü (`09-testing-convergence.md §7.7, §10`)
| # | Tip | Madde | Azaltma |
|---|---|---|---|
| 09-KN-C4 | R | 59-kapı paydası taslak-modüller eklenince değişir → kararsız `convergence_score` | feature .md tamamlanınca payda dondur; "payda vN" işaretle (→ KN-M4 §4.4 notu) |
| 09-O8-K3 | B | CRITICAL etiketi (29 kapı) bu sentezde atandı — modül .md'lerinde explicit yok | Emre CRITICAL listesini gözden geçirsin (sınır: DOC-P5 config tartışmalı) |
| 09-O8-K5 | V | convergence "tek `vitest run` yeşil" varsayıyor; 425+yeni test flaky/live-gated olabilir | live-gated `skipIf(!LIVE)`; convergence yalnız deterministik suite'e bağlanır |

---

## 8. Kalite Kapısı + Değişmez Kurallar (her fazda)

```
RED (test yaz, fail) → GREEN (min implement) → REFACTOR
→ typecheck ✓  lint ✓  vitest (fresh run) ✓  e2e (ilgili) ✓  → sonra commit feat(<modül>): …
```
- **Root cause önce** (semptom-fix yasak) · **evidence önce** ("çalışıyor" = komut çalıştır, çıktı gör).
- **implementer ≠ verifier** · **CRITICAL gizleme yasak** (her zaman ilk sıra).
- **Tek dispatch:** her tool `ToolRegistry.execute` choke-point'inden geçer; ikinci dispatch path açma yasak.
- **owner-preservation:** her MCP lifecycle geçişinde tenant `owner` korunur (Faz-24 izolasyonu).
- **Config-driven default-off:** her yeni modül `.env` toggle ile **kapalı-varsayılan** + mock-adapter ile testler
  altyapısız (SearXNG/IMAP/CalDAV kurulu olmadan) geçer (honest-empty state).
- **WHY-only yorum** (WHAT/HOW değil) · **unused code commit etme** · **append-only migration** (global-monoton numara).

---

## 9. Convergence Yürütme Protokolü (09-testing §8 — nasıl 1.0'a ulaşılır)

```
[Adım 0]  BASELINE      → `npx vitest run` + `playwright test` → mevcut ~425 test yeşil-taban (KN-M10 kapat)
[Adım 1]  KN-M3 kapat   → odysseus README/mimari WebFetch → parity kriterlerini davranışa kalibre
[Adım 2]  KN-M2 kapat   → research.md + cookbook.md yaz → §4.4 payda kesinleş+dondur
[Adım 3]  O0 GREEN      → VectorStore adaptör + module-registry + config-toggle + migration-v7 — BLOCKER
[Adım 4]  PARALEL spawn → O2∥O3∥O5∥O6∥O7 + O1(mcp-ext) + O8(TOTP∥poison-guard)  (her biri RED→GREEN→gate→ledger)
[Adım 5]  SEC zincir    → O8.2(role) → O8.3(tool-policy) → O8.1(step-up) → O8.4(threat-model EN SON)
[Adım 6]  E2E           → E2E-1..8 modüller-arası akış yeşil (09 §6)
[Adım 7]  LEDGER SWEEP  → §7 tüm maddeler CLOSED/KAPSAM-DIŞI (hiç AÇIK yok) — Emre-kararı maddeleri T0'da onaylandı
[Adım 8]  CONVERGE      → convergence_score = 1.0 ∧ 29 CRITICAL GREEN ∧ 8 gate GREEN → İLAN
```

---

## 10. Sonraki Belgeler + T0 Kapısı (yol haritası)

1. **`04-research.md` + `06-cookbook.md`** (YAZILACAK) — O2/O7 tam TDD plan (şu an yalnız plan-tohum + UI-brief; KN-M2 blocker).
   Not: `02-o0-foundation.md` işlevini büyük ölçüde mevcut `02-architecture.md` üstlendi (Faz A0–A4 tam-TDD).
2. **Yeniden-adlandırma** (`NN-oN-<ad>.md`) + `00-index.md` — KN-M1 tutarsızlığını kapat (T0 onayı).
3. **Emre T0 kararları:** KN-M6 (Google-tab kaderi) · KN-M7 (gwv2/poison-guard terminoloji) · KN-M3 (odysseus doğrulama) ·
   email-D1/D2/D3 · sec-BIL1 (lokal-mod 2FA) · sec-GAP3 (tasklist'e O8) · 09-O8-K3 (CRITICAL listesi).
4. **Baseline (KN-M10)** + **payda dondur (KN-M4/09-KN-C4)** — kodlama-öncesi kapı.

> **Değişmez:** O0 GREEN olmadan hiçbir modül fazı spawn edilmez (01 §5). Kodlama TÜM plan bitince başlar (PROGRESS.md kuralı).

---

## 11. Doğrulama Günlüğü (bu master'ın kanıt tabanı, 2026-07-10)

| İddia | Kanıt | Sonuç |
|---|---|---|
| `server.ts` = 3191 satır | `wc -l server.ts` → 3191 | ✅ (163 KB dosya boyutu ≠ satır; KN-C3 çözüldü) |
| App.tsx = **22** tab | `grep -cE "id:" src/App.tsx` → 22 | ⚠️ modül .md'ler "21" der; +1 sapma (revenue/selftest civarı) — küçük, ledger-not |
| `.env.example` = 21 toggle | `grep -cE "^[A-Z_]+=" .env.example` → 21 | ⚠️ modül "38/40+/46" (kod-içi toggle sayıyor) → KN-M9 |
| module-registry / `server/modules/` | `ls` → **YOK** | ✅ O0 inşa hedefi |
| `server/mcp/hooks.ts` + `manager.ts` | `ls` → **YOK** | ✅ O1 inşa hedefi |
| migrations son version | `grep version: migrations.ts` → v6 (son) | ✅ modül tabloları v7+ |
| yeni-modül deps (unpdf/mammoth/xlsx/marked/dompurify/imapflow/nodemailer/mailparser/tsdav/node-ical/rrule/ical-generator/otplib/otpauth/qrcode/croner) | `grep package.json` → **hiçbiri yok** | ✅ tüm modüller yeni-dep |
| `server/rag.ts` + `sqlite-vec` | `ls server/rag.ts` VAR + `grep "sqlite-vec"` package.json VAR | ✅ persistence uçurumu kısmen kapalı |
| `server/security/` dizini | `ls` → **YOK** | ✅ O8 sıfırdan (TOTP/RBAC/poison) |

---

## 12. GÜNCELLEME — Plan-seti TAMAM (2026-07-10, §1-11 sonrası)

> §1-11 sentezi **11 dosyaya** dayanıyordu (ilk üretim turu). Kalan 9 modül ardından yazıldı → **20/20 .md tam (5512 satır)**. Aşağıdaki değişiklikler §1-11'i geçersiz kılan noktaları düzeltir:

- **KN-M2 KAPANDI (blocker çözüldü):** `research-searxng.md` + `cookbook-models.md` ARTIK VAR (yukarıdaki §KN-M2 "hâlâ YOK" ifadesi geçersiz). Tüm 9 feature modülü tam-TDD planlı: chat-agents, research-searxng, documents, email-mcp, notes-tasks, calendar-caldav, cookbook-models, rag-vector, mcp-extensions.
- **Sonradan-yazılan modüllerin kod-doğrulama bulguları (§2 envanterini zenginleştirir):**
  - `chat-agents.md`: mevcut ReAct döngüsü `server.ts:1477` + `plan.runAgentLoop:2994` + ToolRegistry odysseus `agent_loop`'u **zaten karşılıyor**; boşluk = token-delta streaming + ReAct-içi alt-ajan + kural-tabanlı ToolPolicy + budget-guard (6 TDD-adım).
  - `research-searxng.md`: `scripts/ecysearcher-*` = **threat-intel platformu (research DEĞİL)**; gerçek temel `bin/host-bridge/tools/web_search.mjs` (DDG-scrape+deep-fetch+readability, VAR); plan = SearXNG backend + `server/research/*` iteratif orkestrasyon.
  - `rag-vector.md`: RAG **YOK değil VAR** (`server/rag.ts` sqlite-vec + `embed-catalog.ts` 4-bulut+local embed + rag_index/rag_search tool); plan = parity-tamamlama (pluggable VectorStore + ONNX-embed + documents-köprü), sqlite-vec varsayılan.
  - `cookbook-models.md`: donanım-farkında seçim motoru `optimize.ts`'te **VAR ama CLI'ye hapsedilmiş** (server-API+UI köprüsü yok); gelir-bağı `revenue.ts:42` qwen3:8b hardcode → cookbook fallback.
  - `04-handoff-protocol.md`: 8-adımlı tekrarlanabilir protokol (bundle→component-eşle→token→apiClient-bağla→test) + 8-panel checklist + 10-kayıt ledger (H1-H10).
  - `08-deploy-pwa.md`: multi-service compose + native launcher **gerçekten eksik** (KN-D3/4/5), ama PWA (vite-plugin-pwa) + Şef-1 minisign/GHCR release-altyapısı **VAR** (KN-D1/2 kapalı).
  - `02-architecture.md` + `06-extensibility.md` + `notes-tasks.md`: tam TDD planlı (346/374/191 satır).
- **Convergence payda (§4.4) revize:** taslak Research(2)/Cookbook(2) artık tam kriterli (~8-10 kapı her biri) → **payda ~59'dan ~75'e** (KN-M4 notu uyarınca; kodlama-öncesi kesin dondur).
- **Kalan T0 kapıları değişmedi** (§10): KN-M1 (faz-numaralama) · KN-M3 (odysseus WebFetch-doğrula) · KN-M6 (Google-tab kaderi) · KN-M7 (gwv2/poison terminoloji) · email-D1/D2/D3 · sec-BIL1 · sec-GAP3 · KN-M10 (baseline test).
- **Program eforu:** ~30-38 paralel ajan-oturumu (seri ~58-74), ±%30. Kritik yol: `O0 → O1 → O4/O6 → O8 → deploy → test`.

**SONUÇ: ODYSSEY plan-seti tam, kör-nokta-yok (her modülde ledger, 10 program-düzeyi KN + ~50 modül-KN, hepsi azaltma-planlı). Kodlama = TÜM T0 kararları + baseline (KN-M10) + payda-dondur sonrası (PROGRESS.md kuralı).**

---

*Üretici: ODYSSEY planlama üreteci (00-MASTER sentez). Kaynak: `docs/odyssey/` **20 modül dosyası** (§12 güncelleme; §1-11 ilk 11'e dayanıyordu)
(01-vision-premise, 02-architecture, 03-claude-design-ui, 06-extensibility, 07-security, 09-testing-convergence,
10-roadmap, 05-features/{documents,email-mcp,calendar-caldav,notes-tasks,mcp-extensions}) + PROGRESS.md + ollamas kodu
(server.ts:3191, server/tool-registry.ts:882-961, server/store/migrations.ts:v6, server/rag.ts+sqlite-vec, server/db.ts:312-344,
server/mcp/*, package.json, src/App.tsx:22-tab, .env.example:21-toggle) + orchestration/COUNCIL_ROSTER.json +
memory/ollamas-completion-plan.md. Doğrulama tarihi: 2026-07-10.*
