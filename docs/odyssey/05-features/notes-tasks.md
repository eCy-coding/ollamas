# ODYSSEY · 05-Features · Notes & Tasks (Memory + Task Scheduler + Agent-Assign)

> Modül: **Notlar & Görevler** — kalıcı notlar (memory) + görev listesi (tasks/todo) + cron/interval **task scheduler** + **agent-atanabilir** görevler.
> Referans: odysseus `notes/tasks` modülü (self-hosted AI workspace) — memory + `task_scheduler` (cron) + agent-assign.
> Hedef: ollamas'ı odysseus-parity seviyesinde, `$0-local` prensibiyle kendi kendine barındırılan not + görev + zamanlayıcı çekirdeğine kavuşturmak; mevcut orchestration cron/plist desenini **kullanıcı-yüzeyli** task-scheduler'a genişletmek.
> Dil: TR (anlatı) · EN (kod/komut/dosya-yolu). Her adım TDD (test-once).

---

## 1. Mevcut Durum (ollamas'ta gerçekte ne var — koda karşı doğrulandı)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` üzerinde `Read`/`Grep` ile **birebir doğrulandı** (varsayım değil).

### 1.1 VAR olanlar — ama hepsi **dev-orchestration**, kullanıcı-yüzeyli DEĞİL

**A) Orchestration scheduler / cron primitifleri (launchd plist × 3, hepsi DOC-ARTEFAKT, `launchctl load` = T0/Emre kararı):**
- **`orchestration/heartbeat.plist`** — `StartInterval 600` (10dk), `RunAtLoad`, `ProcessType Background`. Koşar: `bin/heartbeat.ts --once --quiet` → periyodik conduct + delta-notify. Bu ollamas'ın **cron benzeri en yakın primitifi**.
- **`orchestration/reconcile.plist`** — `KeepAlive true`, `RunAtLoad`. Koşar: `bin/reconcile.ts --watch --quiet` → K8s-operator level-based reconcile daemon (sürekli döngü).
- **`orchestration/bin/autopilot.plist`** — `StartInterval 1800` (30dk) + `WatchPaths ~/.llm-mission-control` + `RunAtLoad`. Bench-değişim tetikli tazeleme.
- **In-process tick pattern** (plist'ten bağımsız, kod içi zamanlayıcı deseni): `orchestration/bin/reconcile.ts:119` → `setInterval(() => tick()..., interval)` + backoff-attempt sayacı (`attempt = reachable ? 0 : attempt+1`). heartbeat.ts aynı deseni izler. **Bu, yeni task-scheduler'ın kopyalayacağı referans in-process loop.**

**B) "task" ve "note" isimli mevcut kod — ama anlamı FARKLI (isim çakışması, tuzak):**
- **`orchestration/bin/lib/task-progress.ts`** — PURE completion ledger; `Status = "pending"|"proposed"|"done"`, `nextPending(catalog, progress)`, `mark`, `summary`, `laneSummary`. Bu **build-catalog görev tamamlama defteri** (conductor loop için), kullanıcı todo'su DEĞİL. Persist: `~/.ollamas/tasks-progress.json` (IO shell'de).
- **`orchestration/bin/lib/task-catalog.ts`** + `TASKS.json` / `TASKS.gen.txt` — orchestration görev kataloğu (lane'li build task'ları). Yine dev-loop, kullanıcı-görevi değil.
- **`orchestration/bin/lib/note.ts`** — `DiagnosticNote` parse/validate (orchestra panel `plans/notes/<persona>.md` içindeki ` ```note ` JSON blokları). **Teşhis-notu**, kullanıcı-notu DEĞİL. `orchestration/plans/notes/*.md` = persona teşhis notları.
- **`.claude/commands/tasks.md` / `tasklist.md`** — Claude Code slash-komut dokümanları; app değil.
- **`docs/TASKS.md` / `docs/MASTER_TASKLIST.md`** — proje planı markdown'ları; app değil.

**C) Gerçek DB-backed zamanlanmış-iş motoru (kullanıcı-yüzeyli DEĞİL ama en yakın mimari analog):**
- **`server/webhooks/outbound.ts`** — `setInterval` (satır 74/83) tabanlı gerçek scheduler: DB'den `claimDeliveries()` ile due satırları atomik claim eder, teslim eder, başarısızlıkta `scheduleRetry()` ile exponential-backoff requeue, tükenince dead-letter. **`next_retry_at` + `status(pending|claimed|...)` + `attempt` deseni = bir task-scheduler'ın tam ihtiyaç duyduğu şablon.** `store/index.ts`'te `claimDeliveries / markDelivery / reclaimStale / reclaimStranded` bu deseni sağlar (crash-safe catch-up dahil).
- **`server.ts`** — 119 adet `app.(get|post|put|delete)` route; birçok `setInterval` SSE/poll döngüsü (satır 689, 810, 1766, 1786). Route-mount + periyodik-push deseni mevcut.

**D) Store katmanı (yeni tabloların bağlanacağı sözleşme):**
- **`server/store/index.ts`** + **`migrations.ts`** — async `DbClient` adapter (`query / run / exec / withLock`), SQLite default (`node:sqlite`) / Postgres opsiyonel (`DATABASE_URL`). Append-only versiyonlu migration; baseline DDL `initStore()`'da, evrim `MIGRATIONS[]`'te. **Son versiyon v6** (`usage_events`, `oauth_*`, `ukp_stage_events`). Tüm tablolar `tenant_id`-scoped.
- **`server/agent-events.ts`** — agent olay akışı mevcut (SSE). Ancak **task→agent atama** wiring'i YOK (`grep "assign|task.*agent"` → boş).

### 1.2 YOK olanlar (net eksik parçalar)

| Yetenek | Durum | Kanıt |
|---|---|---|
| Kullanıcı **notes** persistence (CRUD, arama, etiket) | ❌ YOK | migrations v6'da bitiyor; `notes` tablosu yok; UI component yok |
| Kullanıcı **tasks/todo** persistence (durum, öncelik, due) | ❌ YOK | `task-progress.ts` dev-ledger; kullanıcı `tasks` tablosu yok |
| **Task scheduler** (cron/interval, due-tetikleme, catch-up) | ⚠️ KISMİ | orchestration plist'leri + `webhooks/outbound` scheduler VAR ama kullanıcı-görevine bağlı DEĞİL |
| **Agent-assign** (görevi bir agent'a ata → otomatik yürüt) | ❌ YOK | `agent-events.ts`'te assign yok; task→agent köprüsü yok |
| **Memory** (agent'ın okuyabildiği kalıcı not/bağlam deposu) | ❌ YOK | `memory-stats.ts` yalnız metrik; not-deposu değil |
| REST API `/api/notes/*`, `/api/tasks/*`, `/api/schedules/*` | ❌ YOK | server.ts 119 route; hiçbiri eşleşmiyor |
| Notes/Tasks UI (`NotesPanel`, `TasksPanel`) | ❌ YOK | `src/components/`'te yok |
| Cron ifade parse (`* * * * *` → next-run) | ❌ YOK | `grep "cron\|croner\|node-cron"` app kodunda 0 |
| MCP-as-extension (agent notes/tasks okur-yazar) | ❌ YOK | `server/mcp/catalog.ts`'te notes/tasks/memory tool girişi yok |

**Özet:** ollamas'ta "task/note/scheduler" = **yalnız dev-orchestration** (build-loop için). Kullanıcı-yüzeyli not defteri, görev listesi, cron zamanlayıcı ve agent-atama tümüyle eksik. Bu plan o çekirdeği kurar; **mevcut `webhooks/outbound.ts` claim/retry desenini** ve **`reconcile.ts --watch` in-process loop'unu** task-scheduler'a yeniden kullanır (sıfırdan icat değil).

---

## 2. Odysseus Referansı (parity hedefi)

odysseus `notes/tasks` modülü (FastAPI + SQLite, self-hosted):
- **Notes / memory** — kalıcı serbest-metin notlar; agent'ın okuyabildiği "memory" deposu; etiket/arama; markdown gövde.
- **Tasks / todo** — durum (`todo|doing|done`), öncelik, son-tarih (due), etiket; liste + filtre.
- **`task_scheduler` (cron)** — cron ifadeli veya interval'li **zamanlanmış görev**; scheduler süreç due görevleri tetikler; sunucu restart'ında kaçanları telafi eder (catch-up).
- **Agent-assign** — bir görev bir **agent**'a atanır → scheduler tetiklediğinde agent'ın `agent_loop`'u görevi otomatik yürütür (tool-exec), sonucu göreve yazar.
- **Config-driven** — `.env` toggle (scheduler açık/kapalı, tarama aralığı, default agent).
- **MCP-as-extension** — notes/tasks/memory bir MCP server olarak expose; agent kendi notlarını/görevlerini okuyup yazabilir.
- **Paylaşılan zamanlayıcı** — reminders (calendar modülü) ile **aynı scheduler altyapısını** paylaşır.

**ollamas'a taşıma stratejisi:** FastAPI değil → mevcut **Node `server.ts` + `server/store` (SQLite/pg)**; VanillaJS değil → mevcut **Vite+React `src/components`**; cron → **`webhooks/outbound.ts` claim/retry + `reconcile.ts --watch` interval** desenini birleştiren yeni `server/scheduler/`; agent-assign → mevcut **`server/agent-events.ts` + `backend/orchestrator`** üzerine köprü; MCP → mevcut **`server/mcp`** choke-point.

---

## 3. Hedef Mimari (ollamas'a özgü)

```
src/components/
  ├─ NotesPanel.tsx      ← not defteri UI (CRUD, arama, etiket, markdown)
  └─ TasksPanel.tsx      ← görev listesi UI (durum/öncelik/due, schedule kur, agent ata)

server/notes/
  ├─ routes.ts           ← /api/notes/* REST (server.ts'e mount)
  └─ store.ts            ← notes CRUD + arama (store/index.ts async API üstüne)

server/tasks/
  ├─ routes.ts           ← /api/tasks/* + /api/schedules/* REST
  ├─ store.ts            ← tasks + task_runs CRUD, dueTasks(now), claim/mark
  ├─ cron.ts             ← SAF cron/interval parse → nextRun(expr, from)  (zero-dep veya croner)
  ├─ scheduler.ts        ← in-process tick loop (reconcile.ts --watch deseni) → dueTasks → dispatch
  └─ agent-runner.ts     ← agent-assign köprüsü: task → agent_loop çağır → sonucu task_run'a yaz

server/store/migrations.ts (v7,v8,v9,v10)  ← notes / tasks / task_schedules / task_runs tabloları
server/mcp/catalog.ts (ops.)                ← notes/tasks/memory MCP tool girişi
.env.example                                ← TASK_SCHEDULER_* + DEFAULT_AGENT_* toggle'ları
```

**Bağımlılıklar (yeni, minimal):** cron parse için `croner` (MIT, zero-dep, `nextRun` verir) VEYA tam zero-dep custom `cron.ts` (yalnız 5-alan cron + `@every Ns` interval). Başka runtime dep gerekmez — persist mevcut store, loop mevcut `setInterval` deseni.

**Choke-point kuralı (mevcut N-012):** task/note server mantığı `server/tasks/` + `server/notes/`'ta izole; MCP tarafı yalnız HTTP `/mcp` + `/api/*` üzerinden erişir, tool-registry'yi doğrudan import ETMEZ. Agent-runner `agent-events.ts` public API'sini çağırır, iç modüllere sızmaz.

**Scheduler tasarım kararı (kanıta dayalı):** Sıfırdan icat yok. `task_runs` tablosu = `webhook_deliveries`'in birebir analogu: `status(pending|claimed|running|done|failed)`, `attempt`, `next_run_at`, `claimed_at`. `store/index.ts`'teki `claimDeliveries/reclaimStale` deseni `claimDueTasks/reclaimStaleTasks` olarak kopyalanır → crash-safe catch-up **bedava** gelir. Loop = `reconcile.ts --watch` interval + backoff.

---

## 4. Hedef Plan — TDD Adımlı (test-once)

Her faz: **önce test yaz (kırmızı) → implementasyon (yeşil) → refactor**. Kalite kapısı: `npm run typecheck && npm run lint && npx vitest run` → sonra commit (`feat(notes|tasks): <faz>`). DB (Faz 0) tüm sunucu fazlarının ön koşuludur; Notes (Faz 1) ile Tasks/Scheduler (Faz 2-5) büyük ölçüde bağımsız → paralelize edilebilir.

### Faz 0 — DB şeması + migrations (temel, v7→v10)
- **Test-once:** `server/store/__tests__/notes-tasks-migrations.test.ts` — v7..v10 uygulandıktan sonra `notes`, `tasks`, `task_schedules`, `task_runs` tabloları + kolonlar var; idempotent (iki kez migrate = tek uygulama); mevcut **v6 zinciri kırılmadı** (`appliedVersions()` → v1..v10).
- **Implement:** `migrations.ts`'e append-only ekle (baseline DDL'i düzenleme — dosyanın kendi sözleşmesi):
  - `notes(id, tenant_id, title, body, tags, pinned, created_at, updated_at)` + `idx_notes_tenant`
  - `tasks(id, tenant_id, title, detail, status /* todo|doing|done|blocked */, priority, due_at, tags, assignee_agent, created_at, updated_at)` + `idx_tasks_tenant_status`
  - `task_schedules(id, tenant_id, task_id, kind /* cron|interval|once */, expr, enabled, timezone, next_run_at, last_run_at, created_at)` + `idx_task_sched_due(enabled, next_run_at)`
  - `task_runs(id, tenant_id, task_id, schedule_id, status /* pending|claimed|running|done|failed */, attempt, next_run_at, claimed_at, started_at, finished_at, result, error)` + `idx_task_runs_due(status, next_run_at)`
- **Store API (`server/store/index.ts` async):** `createNote/getNote/listNotes(q,tags)/updateNote/deleteNote`; `createTask/listTasks(filter)/updateTask`; `upsertSchedule/dueSchedules(now)`; `claimDueTasks(limit)/markRun/reclaimStaleTasks(staleMs)` — **`claimDeliveries/markDelivery/reclaimStale` desenini birebir izle**.
- **DoD:** migration idempotent; `tenant_id` her tabloda; due-index'ler var; range/`next_run_at` sorgusu gerçek adapter üstünde çalışır.

### Faz 1 — Notes CRUD + REST (bağımsız, en hızlı değer)
- **Test-once:** `server/notes/__tests__/routes.test.ts` (supertest) — `POST /api/notes`, `GET /api/notes?q=&tag=`, `GET/PUT/DELETE /api/notes/:id`; tenant izolasyonu (başka tenant notu görünmez); arama başlık+gövde eşleşir; pin sıralaması.
- **Implement:** `server/notes/store.ts` + `server/notes/routes.ts` → `server.ts`'e mount (mevcut korunan-route middleware desenini izle). Arama: SQLite `LIKE`/`instr` (v1), sonra opsiyonel `sqlite-vec` semantik (mevcut dep).
- **DoD:** tenant izolasyon testi geçer; boş-arama tüm notları döndürür; markdown gövde ham saklanır (render UI'da).

### Faz 2 — Tasks CRUD + REST (durum/öncelik/due)
- **Test-once:** `server/tasks/__tests__/tasks-routes.test.ts` — `POST /api/tasks`, `GET /api/tasks?status=&assignee=`, `PUT /api/tasks/:id` (durum geçişi `todo→doing→done`), `DELETE`; öncelik/`due_at` filtresi; tenant izolasyonu.
- **Implement:** `server/tasks/store.ts` (tasks kısmı) + `server/tasks/routes.ts` tasks route'ları.
- **DoD:** geçersiz durum geçişi reddedilir; `due_at` ISO-UTC saklanır; liste `due_at` ASC + `priority` DESC sıralı.

### Faz 3 — Cron/interval engine (SAF, bağımsız — reminders ile paylaşılacak)
- **Test-once:** `server/tasks/__tests__/cron.test.ts` — `nextRun("*/15 * * * *", from)` doğru; `@every 30s` interval; `once` kind bir kez; `UNTIL`/geçmiş `from` catch-up; timezone (Europe/Istanbul) DST kayması yok; **sonsuz kural pencere/max-iter guard**.
- **Implement:** `server/tasks/cron.ts` — `nextRun(schedule, fromIso) → string|null`. `croner` (MIT) veya zero-dep 5-alan parser. SAF fonksiyon, I/O yok. (Calendar modülü reminders'ı da bunu çağırır → **ortak zamanlayıcı**, K1 çözümü.)
- **DoD:** DST sınırı testi geçer; `nextRun` asla `from`'dan geri gitmez; hatalı ifade `null` + validasyon hatası (throw değil, kullanıcıya mesaj).

### Faz 4 — Task scheduler (in-process loop, crash-safe catch-up)
- **Test-once:** `server/tasks/__tests__/scheduler.test.ts` — `vi.useFakeTimers` ile: tick `dueSchedules(now)` → `task_runs` satırı üretir (pending); `claimDueTasks` atomik (iki paralel worker disjoint set); tetiklenen run `done` olur (çift-tetik yok); `nextRun` ile schedule `next_run_at` ilerler; **restart sonrası kaçan run'lar catch-up** (`reclaimStaleTasks`); backoff-attempt sayacı (`reconcile.ts` deseni).
- **Implement:** `server/tasks/scheduler.ts` — `setInterval` tick (default 30s, `TASK_SCHEDULER_INTERVAL_SEC`), `reconcile.ts:119` + `webhooks/outbound.ts` claim/retry desenini birleştirir. `server.ts` boot'ta `startScheduler()` (env-gated). Dispatch: run'ı `agent-runner`'a veya (agent yoksa) no-op/webhook'a verir.
- **DoD:** idempotent tetikleme (aynı schedule iki kez ateşlenmez); worker-crash orphan run requeue (`reclaimStale` analogu); scheduler kapalıyken (env off) sistem hatasız açılır.

### Faz 5 — Agent-assign (task → agent_loop köprüsü)
- **Test-once:** `server/tasks/__tests__/agent-runner.test.ts` — `assignee_agent` set edilmiş task scheduler'ca tetiklenince `agent-runner` çağrılır (agent-events **mock**); run `running→done`, `result` göreve yazılır; agent hata → run `failed` + `error`, task `blocked`; agent yoksa/atanmamışsa graceful skip.
- **Implement:** `server/tasks/agent-runner.ts` — task detay/başlık → agent prompt; `agent-events.ts` public API (veya `backend/orchestrator`) çağrısı; sonuç `task_runs.result`'a; SSE ile UI'ya ilerleme. **Choke-point:** yalnız public agent API, iç modül import yok.
- **DoD:** agent yürütmesi izole (bir task'ın başarısızlığı scheduler loop'unu düşürmez); sonuç + hata denetlenebilir (`task_runs` audit izi); tenant-scoped agent yetkisi.

### Faz 6 — Frontend (NotesPanel + TasksPanel) + App.tsx tab
- **Test-once:** `tests/ui/notes-panel.test.tsx` + `tests/ui/tasks-panel.test.tsx` (vitest + RTL) — NotesPanel `/api/notes` (mock) çeker/oluşturur/arar; TasksPanel task listeler, durum değiştirir, schedule kurar (cron ifade), agent atar; boş + hata durumu.
- **Implement:** `src/components/NotesPanel.tsx` + `TasksPanel.tsx`; `App.tsx`'e `"notes"` / `"tasks"` tab (mevcut tab/lucide-ikon desenini izle); i18n `src/locales/en.ts` + `tr.ts` anahtarları.
- **DoD:** panel'ler mevcut auth/tab akışını bozmadan render; cron ifade UI'da doğrulanır (invalid → uyarı); agent-atama dropdown mevcut agent listesinden.

### Faz 7 — Config + (opsiyonel) MCP-as-extension
- **Test-once:** `.env.example` toggle'ları belgeli; MCP eklenirse `server/mcp/__tests__` catalog/tool testi (notes.list / tasks.create tool'ları expose).
- **Implement:** `.env.example`'a `TASK_SCHEDULER_ENABLED`, `TASK_SCHEDULER_INTERVAL_SEC`, `DEFAULT_TASK_AGENT`, `TASK_RUN_MAX_ATTEMPTS`. Opsiyonel: notes/tasks/memory'yi `/mcp` üzerinden agent'a expose (agent kendi görevini okuyup güncelleyebilir).
- **DoD:** toggle'sız (env yok) sistem hatasız açılır (scheduler kapalı, notes/tasks CRUD yine çalışır); MCP tool'ları tenant-scoped.

---

## 5. Odysseus-Parity Kabul Kriterleri

Modül "parity" sayılır ⇔ **tüm** aşağıdakiler yeşil:

1. **Notes/memory:** Kalıcı not CRUD + arama + etiket; agent MCP üzerinden notları okuyabilir (memory). Tenant-scoped.
2. **Tasks/todo:** Durum (`todo|doing|done|blocked`) + öncelik + due; liste/filtre; geçersiz geçiş reddedilir.
3. **Task scheduler (cron):** cron ifadeli **ve** interval'li zamanlanmış görev tetiklenir; `nextRun` doğru ilerler; DST kayması yok; **sunucu restart sonrası kaçanlar telafi edilir (catch-up)**.
4. **Crash-safe:** Worker-crash sırasında claim'lenen run orphan kalmaz (`reclaimStale` analogu); aynı schedule çift-tetiklenmez.
5. **Agent-assign:** Bir göreve agent atanır → scheduler tetiklediğinde agent otomatik yürütür; sonuç/hata göreve yazılır; hata scheduler loop'unu düşürmez.
6. **Ortak zamanlayıcı:** Calendar modülü reminders'ı **aynı `cron.ts`/scheduler altyapısını** kullanır (K1 tek-kaynak çözümü — iki ayrı scheduler yok).
7. **$0 / self-hosted:** Zorunlu ücretli servis yok; env'siz açılışta CRUD çalışır, scheduler opsiyonel; cron dep minimal (`croner` MIT veya zero-dep).
8. **Tenant izolasyonu + auth:** `/api/notes/*`, `/api/tasks/*`, `/api/schedules/*` mevcut apikey/tenant middleware'iyle korunur; çapraz-tenant sızıntı yok.
9. **Kalite kapısı:** `npm run typecheck && npm run lint && npx vitest run` (notes/tasks test dosyaları dahil) yeşil; mevcut v6 migration zinciri kırılmamış; orchestration `task-progress.ts`/`note.ts` (isim-çakışması) etkilenmemiş.

---

## 6. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tür | Madde | Etki | Azaltma |
|---|---|---|---|---|
| K1 | Çözüldü (önceki calendar-K1) | "notes/tasks scheduler altyapısı var mı?" → **Kullanıcı-yüzeyli YOK**; ama `webhooks/outbound.ts` (DB claim/retry) + `reconcile.ts --watch` (in-process interval) desenleri VAR. | Sıfırdan yazmak yerine kanıtlı desen kopyalanır. | Faz 4 scheduler = `webhooks/outbound` şablonu; calendar reminders bu `cron.ts`'i paylaşır (tek zamanlayıcı). |
| K2 | Risk (isim çakışması) | `orchestration/bin/lib/task-progress.ts` + `note.ts` zaten "task"/"note" isimli — ama dev-loop. Yeni `server/tasks`/`server/notes` ile karışma/yanlış-import riski. | Yanlış modül import = derleme/mantık hatası. | Net ayrım: kullanıcı özelliği **`server/`** altında; orchestration **`orchestration/`** altında kalır. Import-guard/lint ile çapraz-import yasak. |
| K3 | Bilinmeyen | Agent yürütme yüzeyi: `server/agent-events.ts` mi, `backend/orchestrator` (Rust `hardware_orchestrator`) mi, `server/orchestrator.ts` (JOB_STORE) mi çağrılacak? Üçü de var, sözleşmeleri farklı. | Yanlış agent-runner köprüsü = agent-assign çalışmaz. | Faz 5'ten önce `agent-events.ts` public API'sini + gerçek chat/agent-loop giriş noktasını teyit et; en stabil public API'yi seç. |
| K4 | Risk | Cron dep seçimi: `croner` (MIT, `nextRun` hazır) vs tam zero-dep custom parser. Custom = DST/edge riskleri. | Yanlış `nextRun` = kaçan/çift tetik. | `croner` tercih (savaş-testli, timezone-aware); zero-dep istenirse yalnız 5-alan + `@every` alt-küme, kapsamlı test. |
| K5 | Varsayım | SQLite adapter (`db-adapter.ts` + `sqlite-vec`) yeni 4 tabloyu + `next_run_at` range/due sorgularını sorunsuz kaldırır; pg yolunda da geçer. | Migration/sorgu performansı + dialect farkı. | Faz 0 testi hem sqlite hem (mümkünse) pg üstünde; due-index (`next_run_at`) ekle; ISO-UTC lexicographic karşılaştırma (mevcut `expires_at` deseni). |
| K6 | Bilinmeyen | Auth modeli: `/api/notes|tasks/*` **tenant/apikey** mı yoksa Firebase-user mı? (Diğer server API'leri apikey/tenant; bazı UI panel'leri Firebase.) | Yanlış auth = sızıntı veya çift-auth. | Faz 1'den önce `server.ts` korunan-route middleware desenini teyit et; calendar planıyla (K5) aynı kararı ver — tutarlı ol. |
| K7 | Risk | Scheduler `setInterval` süreç modeli: tek-replica varsayar. Postgres multi-replica'da iki scheduler aynı schedule'ı iki kez tetikleyebilir. | Çift-tetik (multi-replica prod). | `claimDueTasks` atomik claim (SKIP LOCKED / sqlite single-writer) — `webhooks` deseni zaten çok-replica-güvenli; `withLock` ile tick serialize opsiyonu. |
| K8 | Risk | Agent-runner uzun-süren/başarısız yürütme scheduler tick'ini bloke edebilir veya `task_runs`'ı `running`'de bırakabilir. | Loop tıkanması / orphan `running`. | Agent çağrısı async + timeout; `running` için de `reclaimStaleTasks` (stale-window); tick agent'ı **beklemez** (fire-and-track). |
| K9 | Bilinmeyen | Cron timezone kaynağı: kullanıcı-başına TZ mı, sunucu TZ mı, UTC mi? `task_schedules.timezone` kolonu var ama UI/agent hangi TZ'yi yazacak belirsiz. | Yanlış saatte tetik. | `timezone` IANA string sakla (default `UTC`); `nextRun` TZ-aware; UI kullanıcı TZ'sini gönderir; testte Europe/Istanbul DST. |
| K10 | Kapsam | 2FA/RBAC (odysseus admin/non-admin tool-policy) — agent-assign bir agent'a **tool-exec** yetkisi verir; kimin hangi agent'a görev atayabileceği RBAC gerektirir. | Yetki yükseltme (düşük-yetkili kullanıcı güçlü agent'ı tetikler). | Bu plan görev CRUD'u tenant-scoped bırakır; agent-assign yetkisi 04-security RBAC modülüne bağlanır; başta yalnız tenant-admin atayabilir. |
| K11 | Varsayım | `croner` yeni dep — supply-chain (mevcut minimal-dep felsefesi). | Bağımlılık yüzeyi büyür. | MIT + zero-transitive-dep doğrula (`npm ls croner`); alternatif zero-dep parser hazır tut; lockfile pin. |

---

## 7. Uygulama Sırası (özet)

`Faz 0 (DB v7-v10)` → `Faz 1 (Notes CRUD) ∥ Faz 2 (Tasks CRUD)` → `Faz 3 (cron engine, SAF)` → `Faz 4 (scheduler loop, crash-safe)` → `Faz 5 (agent-assign)` → `Faz 6 (UI)` → `Faz 7 (config/MCP)`.
Her fazda: **test-once (kırmızı) → implement (yeşil) → typecheck+lint+vitest → commit** (`feat(notes|tasks): <faz>`).

**Yeniden-kullanım altın kuralı (kanıta dayalı):** yeni scheduler `server/webhooks/outbound.ts` (claim/retry/dead-letter) + `orchestration/bin/reconcile.ts --watch` (interval+backoff) desenlerini kopyalar; `cron.ts` calendar reminders ile **ortak** kalır. Sıfırdan zamanlayıcı icat edilmez.
