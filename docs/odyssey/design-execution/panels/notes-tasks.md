# ODYSSEY-DESIGN — Panel: Notes & Tasks (memory + cron scheduler + agent-atanabilir todo) (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/notes-tasks.md`
> **Odak:** Notlar & Görevler paneli — kalıcı **notes/memory** + **tasks/todo** (durum/öncelik/due) + **cron/interval scheduler** + **agent-atama** + **reminder-zaman**. odysseus `notes/tasks` modülü parity hedefi.
> **Backend kaynağı:** `docs/odyssey/05-features/notes-tasks.md` (server/notes + server/tasks + `cron.ts` engine + `scheduler.ts` loop + `agent-runner.ts` köprü + migrations v7→v10).
> **UI kaynağı:** `docs/odyssey/03-claude-design-ui.md` §3.5 (notes/tasks brief iskeleti).
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** mock (backend/API/localhost YOK). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Durum (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read`/`Grep` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10) + backend planı `05-features/notes-tasks.md`.

### 1.1 Kullanıcı-yüzeyli notes/tasks UI = TAM SIFIR

- **`src/components/`'te `NotesPanel` / `TasksPanel` YOK.** `grep -l "note|task|todo" src/components/` sonucu yalnız **isim-yakınlığı** olan başka paneller döner (`CommandLineTerminal`, `UsagePanel`, `TelemetryCockpit`, `GitHubSearchPanel`, `ObservabilityPanel`, `ClusterManager`, `cockpit/OrchestraPanel`, `SaaSAdmin`, `cockpit/CouncilPanel`, `ReactAgentTab`, `KeyVault`) — hiçbiri not/görev defteri değil.
- **`App.tsx` 21-sekme düz listesinde `notes` / `tasks` sekmesi YOK** (`00-shell-nav.md` §1.3). Bu panel **yeni sekme** olarak eklenecek.
- **Backend `/api/notes/*` · `/api/tasks/*` · `/api/schedules/*` route'ları YOK** (`05-features/notes-tasks.md` §1.2 doğrulaması). UI mock, statik-HTML üretir; gerçek CRUD Claude Code handoff işi.

### 1.2 İSİM ÇAKIŞMASI UYARISI (kritik — tasarımcıyı yanıltmasın)

ollamas'ta "task" ve "note" isimli kod **ZATEN VAR** ama anlamı **tamamen farklı** — bu panel onlarla **ilgisiz**:

| Mevcut kod | Gerçek anlamı | Bu panel ile ilişki |
|---|---|---|
| `orchestration/bin/lib/task-progress.ts` | build-catalog **tamamlama defteri** (conductor dev-loop; `pending/proposed/done`) | **İLGİSİZ** — kullanıcı todo'su değil |
| `orchestration/bin/lib/task-catalog.ts` + `TASKS.json` | orchestration **build görev kataloğu** (lane'li dev task) | **İLGİSİZ** — dev-loop |
| `orchestration/bin/lib/note.ts` + `plans/notes/*.md` | persona **teşhis-notu** (` ```note ` JSON blok) | **İLGİSİZ** — kullanıcı-notu değil |
| `.claude/commands/tasks.md`, `docs/TASKS.md` | Claude Code slash-komut / proje planı markdown | **İLGİSİZ** — app değil |

**Sonuç:** "task-progress" = **dev-orchestration loop** (task-ilerleme = geliştirme döngüsü ilerlemesi). Bu panelin tasarladığı **kullanıcı-yüzeyli** not defteri + görev listesi ile **isim çakışır ama işlev örtüşmez**. Tasarım bu ayrımı korumalı: panel başlığı "Notes & Tasks" (kullanıcı memory + todo), orchestration task-progress'e HİÇ atıf yapmaz.

### 1.3 Yeniden-kullanılabilir mevcut desen (arka plan bağlamı — tasarımı etkilemez ama handoff'a girer)

- **Scheduler analogu VAR:** `server/webhooks/outbound.ts` (DB claim/retry/dead-letter) + `orchestration/bin/reconcile.ts --watch` (in-process interval + backoff). Yeni cron scheduler bunları kopyalar (sıfırdan değil). → UI için: cron/reminder rozetlerinin **arkasında gerçek bir scheduler** olacağı garanti; mock bu güveni yansıtabilir.
- **Store katmanı VAR:** `server/store/index.ts` async adapter (SQLite/pg), migrations son sürüm **v6**; yeni `notes/tasks/task_schedules/task_runs` tabloları v7→v10 append-only.

---

## 2. Hedef Panel — odysseus `notes/tasks` parity

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır; gerçek CRUD, cron `nextRun` hesabı, scheduler tetikleme, agent yürütme **Claude Code handoff** aşamasında implemente edilir (`05-features/notes-tasks.md` Faz 0-7). Claude Design yalnız **görsel iskelet + 4 mock durum** üretir.

**odysseus parity yüzeyleri (bu panelin karşılaması gereken):**

1. **Notes / memory** — kalıcı serbest-metin not; başlık + markdown gövde + etiket + pin; arama; agent'ın okuyabildiği "memory".
2. **Tasks / todo** — durum (`todo|doing|done|blocked`) + öncelik + son-tarih (due) + etiket; liste + filtre; tamamlananlar ayrı grup.
3. **task_scheduler (cron)** — bir göreve **cron ifadeli** (`*/15 * * * *`) veya **interval** (`@every 30s`) veya **once** zamanlama; doğal-dil ("her gün 09:00") → cron string önizleme.
4. **Agent-assign** — göreve bir **agent** atanır (rozet); scheduler tetiklediğinde agent otomatik yürütür → sonuç göreve yazılır (run-geçmişi).
5. **Reminder-zaman** — görev/hatırlatma zamanı; calendar reminders ile **ortak scheduler** (`cron.ts` tek kaynak).

**Panel iç düzeni (3-bölge):**

```
┌─ SOL: not/görev listesi ────┬─ ORTA/SAĞ: editör + detay ─────────────┐
│ mod-toggle [Notes | Tasks]  │  NOTES modu → markdown editör          │
│ + New   [arama]             │    (başlık + gövde + etiket + pin)     │
│ ── Notes ──                 │                                        │
│  • not-satırı (başlık +     │  TASKS modu → görev-detay:             │
│    snippet + tarih + pin)   │    checkbox durum, başlık, öncelik,    │
│ ── Tasks (aktif) ──         │    due, etiket                         │
│  ☐ görev + [cron @daily]    │    ┌ SCHEDULE satırı:                  │
│    rozet + [agent] rozet    │    │  doğal-dil "her gün 09:00"        │
│    + due-zaman              │    │  → cron önizleme "0 9 * * *"      │
│ ── Tamamlanan (ayrı) ──     │    │  [interval | cron | once] seçici  │
│  ☑ görev (üstü çizili)      │    └ AGENT-ATAMA: dropdown + rozet     │
│                             │    RUN geçmişi: son tetik + sonuç     │
└─────────────────────────────┴────────────────────────────────────────┘
```

**Yeni tab-id:** `notes` (App.tsx sekmesi). Shell'de `00-shell-nav.md` §2 gruplamasında **AI WORKSPACE** grubuna girer (`Notes` etiketi). i18n anahtar-uzayı `notes.*` (EN+TR).

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul).

```
[GOAL]
Design the "Notes & Tasks" panel for a self-hosted, local-first AI workspace
("ollamas", odysseus-parity). This panel is the user-facing memory notebook +
todo list + cron/interval task scheduler + agent-assignable tasks. It is a
SINGLE feature panel that mounts inside the existing app-shell content area (the
shell — header, sidebar, Cmd+K — is designed separately in 00-shell-nav).
Two modes toggled at top-left: NOTES (persistent markdown memory) and TASKS
(todo with status/priority/due, schedulable via cron, assignable to an agent).
This is NOT a dev build-progress tracker — it is the user's own notes and todos.

[LAYOUT]
- Panel = 2-region split: LEFT list rail (~320px) + RIGHT editor/detail (fluid).
- LEFT RAIL top: a segmented mode toggle [ Notes | Tasks ], a "+ New" primary
  button, and a search input (placeholder "Search notes & tasks…").
- LEFT RAIL — NOTES mode: vertical list of note rows. Each row = title (bold) +
  1-line snippet (muted) + relative date + a pin icon (pinned rows float to top
  with a subtle accent left-border). Active row = indigo tint + left accent bar.
- LEFT RAIL — TASKS mode: task rows grouped:
    • "Active" group: each row = checkbox (unchecked) + title + inline badges:
      a cron/interval badge (e.g. "@daily", "*/15m", "once"), an agent badge
      (small avatar/chip e.g. "◆ react-agent"), and a due-time chip (e.g.
      "due 18:00" or "tomorrow"). Priority shown as a small colored dot
      (high=err / med=warn / low=muted).
    • "Completed" group (collapsed by default): checked rows, title
      strikethrough, muted.
- RIGHT REGION — NOTES mode: markdown editor. Header row = editable title + pin
  toggle + tag chips (add-tag "+"). Body = markdown textarea with a light
  formatting hint bar. A subtle "Saved · 2s ago" / "Editing…" status label.
- RIGHT REGION — TASKS mode: task detail:
    • Header = editable title + status selector (todo / doing / done / blocked)
      + priority selector + due date-time picker + tag chips.
    • SCHEDULE block (the signature UI): a natural-language input ("every day
      09:00") that live-previews the resulting cron string ("0 9 * * *") below
      it in mono; a small type selector [ interval | cron | once ]; a reminder
      time field; an enabled toggle. Invalid expression → inline error state
      (red border + "Couldn't parse — try 'every day 9am'").
    • AGENT-ASSIGN block: a dropdown "Assign to agent" (options from workspace
      agents) that renders the chosen agent as a badge; a helper line "Runs
      automatically when scheduled".
    • RUN HISTORY: a compact list of last runs (timestamp + status pill
      done/failed/running + 1-line result/error).
- Quick-add affordance: an always-visible one-line "Quick add task…" input at
  the bottom of the TASKS rail (Enter to create).

[CONTENT]
Mock data (use verbatim):
  NOTES (3): "Weekly review checklist" (pinned) · "Model quant notes — qwen3:8b
  fits 16GB" · "Outreach draft — do not spam".
  TASKS (5, 2 completed):
    Active:
      ☐ "Backup vault nightly"  badge @daily "0 2 * * *"  agent ◆ backup-agent
        due 02:00  priority·med
      ☐ "Draft revenue email"   no schedule  agent ◆ react-agent  due tomorrow
        priority·high
      ☐ "Refresh model benchmarks"  badge "*/30m" interval  no agent
        priority·low
    Completed:
      ☑ "Rotate API keys"   done
      ☑ "Write onboarding note"   done
  SCHEDULE preview example: input "every day 09:00" → mono preview "0 9 * * *".
  RUN HISTORY example (for "Backup vault nightly"): "02:00 · done · 1.2GB
  archived" / "yesterday 02:00 · done" / "2d ago · failed · disk full".
  AGENT dropdown options: react-agent · backup-agent · research-agent · (none).

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Badges (cron/agent/due) use mono for the expression, subtle inset bg, 1px border.
Priority dots: high #fb7185 · med #fbbf24 · low #94a3b8.
Dark is primary; ALSO produce a light variant (token-driven, no dark: prefixes).
Motion: fade-in 0.25s; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR panel states:
  1. EMPTY — no notes/tasks yet: centered illustration + "No notes or tasks yet"
     + "+ New note" / "+ New task" CTAs + one-line hint "Tasks can run on a
     schedule and be handed to an agent."
  2. EDITING — a note open in the editor with unsaved changes: title + body
     being typed, status label shows "Editing…", left row highlighted.
  3. SAVED — after save: same note, status label "Saved · just now" (ok tint,
     fades), left row snippet updated. (Tasks variant: a task just created,
     schedule preview valid, agent badge assigned.)
  4. CRON-ERROR — task schedule with an unparseable expression: natural-language
     input in error state (red border), preview area shows "Couldn't parse —
     try 'every day 9am'", Save disabled, rest of task detail still usable
     (non-blocking — only the schedule block errors).
Responsive:
  • DESKTOP (≥1024px): 2-region split (list rail + editor) side by side.
  • TABLET (768–1023px): single column — list rail is primary; opening a
    note/task slides the editor over as a full-width detail view with a back
    arrow; mode toggle + search stay pinned at top.
Accessibility: role="list"/"listitem" on rows, checkbox is a real
role="checkbox" aria-checked, aria-live on the save/cron-preview status,
aria-invalid on the cron input in error state, focus-visible rings, contrast AA,
strikethrough completed tasks also carry aria-label "completed".
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

| Durum | Panel görünümü | Kritik detay |
|---|---|---|
| **1. Boş** | Not/görev yok; ortada illüstrasyon + "No notes or tasks yet" + `+ New note`/`+ New task` CTA + ipucu satırı | onboarding; scheduler+agent değerini bir cümlede satar |
| **2. Düzenleniyor** | Not editörde açık, gövde yazılıyor; status `Editing…`; sol satır vurgulu | canlı yazma hali; kaydedilmemiş değişiklik |
| **3. Kaydedildi** | Aynı not; status `Saved · just now` (ok tint, solar); sol snippet güncel. **Task varyantı:** yeni görev, cron önizleme geçerli, agent rozeti atanmış | happy-path referans |
| **4. Cron-hatalı** | Görev schedule bloğu: doğal-dil input **error state** (kırmızı border) + önizleme "Couldn't parse — try 'every day 9am'" + Save disabled; görevin geri kalanı kullanılabilir | **non-blocking** — yalnız schedule bloğu hatalı, panel çökmez |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema).

---

## 5. Responsive (desktop + tablet)

| Viewport | Panel düzeni | Detay-görünüm | Not |
|---|---|---|---|
| **Desktop (≥1024px)** | 2-bölge yan-yana (liste-rail ~320px + editör/detay akışkan) | Editör sağ bölgede sabit görünür | Shell 2-kolon grid içinde `.lg:col-span-3` content'e oturur (`00-shell-nav.md` §5) |
| **Tablet (768–1023px)** | Tek-kolon; liste-rail birincil | Not/görev açılınca editör **tam-genişlik detay** olarak üste kayar (geri-ok) | mode-toggle + arama üstte sabit; schedule bloğu tabletde dikey yığılır |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` genel "mobil bozulmayan grid" kriteri geçerli, detay tasarımı ayrı iş (Kör-Nokta KN5).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk 2-bölge iskeletini üretir (muhtemel: notes editör + basit task listesi, schedule/agent eksik olabilir).
2. **İnline-comment #1:** "Task satırına 3 rozet ekle: cron/interval badge (mono, örn. '@daily'), agent badge (chip '◆ react-agent'), due-time chip. Öncelik = küçük renkli nokta."
3. **Chat iterasyon #2:** "Task detayına SCHEDULE bloğunu ekle: doğal-dil input ('every day 09:00') → altında mono cron önizleme ('0 9 * * *'); [interval|cron|once] seçici; reminder-zaman; enabled toggle."
4. **İnline-comment #3:** "AGENT-ASSIGN bloğu: 'Assign to agent' dropdown → seçilen agent rozet olarak render; 'Runs automatically when scheduled' yardım satırı. Altına RUN HISTORY listesi (timestamp + status pill + sonuç)."
5. **Chat iterasyon #4:** "4 panel durumunu ayrı frame üret: boş / düzenleniyor / kaydedildi / cron-hatalı. Cron-hatalı yalnız schedule bloğunu kırar (non-blocking), gerisi kullanılabilir."
6. **İnline-comment #5:** "Light varyantı token-driven üret (dark: prefix yok). Tablet tek-kolon + editör tam-genişlik detay (geri-ok) varyantını ekle."
7. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula; `CRON_INPUT.spec.md` + `TASK_ROW.spec.md` sözleşmelerini netleştir.

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/notes-tasks/` altına:

```
notes-tasks/
  PROMPT.md              # §3'teki tam brief (token + mock + 4-state)
  design.html            # Claude Design export (self-contained, inline CSS)
  screenshot-empty.png   # 4 durum × dark
  screenshot-editing.png
  screenshot-saved.png
  screenshot-cron-error.png
  screenshot-*-light.png # her durumun light varyantı
  screenshot-tablet.png  # tek-kolon + detay-overlay
  HANDOFF.md             # ↓ zorunlu içerik
  tokens.snippet.css     # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  TASK_ROW.spec.md       # task-satırı prop imzası (durum/öncelik/cron-badge/agent-badge/due)
  CRON_INPUT.spec.md     # doğal-dil→cron önizleme sözleşmesi + hata durumu + type-seçici
  AGENT_ASSIGN.spec.md   # agent dropdown + rozet + run-history prop imzası
```

**HANDOFF.md zorunlu içeriği:**
- Panel component ağacı: `NotesTasksPanel` → `ModeToggle` / `ListRail(notes[] | tasks[])` / `NoteEditor` / `TaskDetail(ScheduleBlock, AgentAssignBlock, RunHistory)` / `QuickAdd`.
- **Backend eşleşmesi:** UI → `05-features/notes-tasks.md` fazları. `NoteEditor` → `/api/notes/*` (Faz 1); `TaskDetail` → `/api/tasks/*` (Faz 2); `ScheduleBlock` cron önizleme → `server/tasks/cron.ts nextRun` (Faz 3, SAF); `AgentAssignBlock` → `agent-runner.ts` (Faz 5); `RunHistory` → `task_runs` tablosu (Faz 0, v10).
- **İsim-çakışması notu (zorunlu):** yeni panel kullanıcı-yüzeyli; `orchestration/bin/lib/task-progress.ts` + `note.ts` (dev-loop) ile **KARIŞMAZ**. Import-guard: `src/components/NotesTasksPanel.tsx` yalnız `/api/notes|tasks|schedules/*` çağırır, `orchestration/*` import ETMEZ.
- i18n anahtar listesi: yeni `notes.mode.notes/tasks`, `notes.new`, `notes.search.placeholder`, `notes.task.status.{todo|doing|done|blocked}`, `notes.schedule.nlHint`, `notes.schedule.cronPreview`, `notes.schedule.parseError`, `notes.agent.assign`, `notes.run.{done|failed|running}` — EN+TR çift.
- Cron önizleme sözleşmesi: UI doğal-dil string'i backend'e gönderir; backend `nextRun` + geçerlilik döndürür (UI kendi parse ETMEZ — `05-features` K4: `croner`/zero-dep backend'te). Hata → `aria-invalid` + kullanıcı mesajı, throw değil.
- Agent-assign gate: `AgentAssignBlock` dropdown seçenekleri tenant-scoped; atama yetkisi **04-security RBAC**'e bağlı (başta yalnız tenant-admin — `05-features` K10).

---

## 8. Kabul Kriteri (bu notes-tasks brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = OK)**
- [ ] **Notes modu:** not-listesi (başlık + snippet + tarih + pin) + markdown editör (başlık + gövde + etiket + save-status).
- [ ] **Tasks modu:** görev-listesi (checkbox + öncelik-noktası) + **cron/interval rozeti** + **agent rozeti** + **due-zaman chip**; tamamlananlar ayrı grup.
- [ ] **SCHEDULE bloğu:** doğal-dil → mono cron önizleme + [interval|cron|once] seçici + reminder-zaman + enabled toggle.
- [ ] **AGENT-ASSIGN bloğu:** dropdown → agent rozeti + "runs automatically" + RUN HISTORY (timestamp + status pill + sonuç).
- [ ] **4 panel durumu** (boş / düzenleniyor / kaydedildi / cron-hatalı) ayrı frame; cron-hatalı **non-blocking**.
- [ ] **Responsive:** desktop 2-bölge + tablet tek-kolon detay-overlay.
- [ ] Dark + light token-driven parity (`dark:` prefix yok).
- [ ] a11y: `role="list/listitem"`, `role="checkbox" aria-checked`, `aria-live` save/cron-preview, `aria-invalid` cron-error, focus-visible, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `backend eşleşmesi` (fazlar) + **isim-çakışması import-guard notu** + i18n `notes.*` çift-dil.
- [ ] **İsim-çakışması korundu:** panel `orchestration` task-progress/note dev-loop'una atıf/import YOK; yalnız kullanıcı-memory + todo.

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **KN1** | **RİSK (isim çakışması)** | `orchestration/bin/lib/task-progress.ts` + `note.ts` zaten "task"/"note" isimli — ama **dev-loop** (`05-features` K2). Tasarımcı/Claude Code yanlış modeli/anlamı referans alabilir. | Yanlış kavram → panel dev-progress'e benzer tasarlanır (yanlış) veya yanlış-import derleme hatası | Panel başlığı "Notes & Tasks" (kullanıcı memory+todo); HANDOFF.md import-guard (`orchestration/*` import yasak); §1.2 çakışma tablosu brief'e taşınır |
| **KN2** | **YENİ (backend YOK)** | `/api/notes|tasks|schedules/*` + `NotesTasksPanel` **sıfırdan** (`05-features` §1.2). Claude Design yalnız UI üretir; CRUD/cron/scheduler/agent-runner Claude Code işi (Faz 0-7). | UI tek başına canlı çalışmaz | Bu belge UI-brief; backend `05-features/notes-tasks.md` fazlarına HANDOFF.md'de map'lenir (K3 `03-ui` paraleli) |
| **KN3** | **VARSAYIM (cron-UI parse yeri)** | Cron önizleme kimde? Karar: **UI parse ETMEZ** — doğal-dil'i backend'e yollar, `nextRun` + geçerlilik döner (`05-features` K4: `croner`/zero-dep backend). Mock statik önizleme gösterir. | UI'da parse yapılırsa çift-kaynak + `croner`'ı bundle'a sokma | Tasarımda önizleme **read-only mock**; sözleşme `CRON_INPUT.spec.md`'de; canlı parse handoff'ta backend'e bağlanır |
| **KN4** | **BİLİNMEYEN (reminder-zaman TZ)** | Reminder/due zamanı hangi timezone? Kullanıcı-TZ mı, sunucu mı, UTC mi (`05-features` K9). UI hangi TZ'yi gösterip yollayacak belirsiz. | Yanlış saatte tetik / kafa karıştıran gösterim | UI kullanıcı-TZ gösterir + IANA string yollar (default UTC); due/reminder chip TZ-etiketli; `nextRun` backend TZ-aware |
| **KN5** | **KAPSAM (mobil)** | Mobil (<768px) 2-bölge/detay-overlay bu belgede DIŞI. | Küçük ekranda düzen doğrulanmadı | Tablet tek-kolon deseni mobile taban; ayrı mobil panel işi; `03-ui` genel "mobil bozulmayan grid" kriteri geçer |
| **KN6** | **RİSK (agent-atama RBAC)** | Agent-assign bir agent'a **tool-exec** tetikler; kimin hangi agent'ı atayabileceği RBAC gerektirir (`05-features` K10, **O8/04-security bağlı**). UI dropdown yetkiyi göstermezse yetki-yükseltme illüzyonu. | Düşük-yetkili kullanıcı güçlü agent'ı tetikler sanır | UI dropdown tenant-scoped; yetkisiz agent grileşir/gizlenir; atama yetkisi 04-security RBAC'e bağlı (başta tenant-admin); HANDOFF.md gate notu |
| **KN7** | **VARSAYIM (design-system)** | `01-design-system.md` ön-koşul mevcut/tam kabul; badge (cron/agent/due) + priority-dot token'ları oradan sadık. | Token uyuşmazlığı → rozet/nokta görsel drift | `tokens.snippet.css` brief'e gömülü; badge mono + inset-bg + 1px-border + priority-dot renkleri §3 [BRAND]'te sabit; ilk export token-remap denetimi |
| **KN8** | **BİLİNMEYEN (run-history derinliği)** | RUN HISTORY kaç kayıt, sayfalama var mı, sonuç ne kadar gösterilir (`task_runs.result/error` uzun olabilir). UI kesme/expand kararı belirsiz. | Uzun sonuç panel taşırır | Mock son 3 run + 1-satır kısaltma + "view all"; tam geçmiş ayrı görünüm/expand; sözleşme `AGENT_ASSIGN.spec.md`'de |

---

**Sonraki adım:** Emre onayı (T0) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `05-features/notes-tasks.md` fazları (DB v7-v10 → Notes/Tasks CRUD → cron engine → scheduler → agent-assign → `NotesTasksPanel` → config/MCP) TDD ile. Bu belge **UI-brief kaynağıdır, implementasyon değil** (KN2/KN3 gate).
