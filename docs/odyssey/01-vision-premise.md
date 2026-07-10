# ODYSSEY 01 — Vizyon + Premise (Doğrulanmış)

> **Belge amacı:** ollamas'ı odysseus-kalitesinde bir self-hosted AI-workspace'e evrimleştiren
> "Odyssey" programının kuzey yıldızı. Her iddia mevcut ollamas koduna karşı doğrulandı
> (Read/Grep, `/Users/emrecnyngmail.com/Desktop/ollamas`, tarih 2026-07-10).
> **Premise düzeltmesi burada yapılır:** Claude Design frontend-only'dir — app-runtime değildir.

---

## 0. TL;DR (tek nefes)

ollamas bugün **güçlü bir agent/chat + operasyon-kokpiti** (163k satır tek `server.ts`, 30+
React tab, MCP-server host'u, orchestra fleet). Ama odysseus'un **"kişisel AI-ofis"** modüllerinin
(research, documents, email-as-MCP, notes/tasks, calendar-as-MCP, local-model cookbook) **çoğu YOK**.
Odyssey = bu boşluğu **MCP-as-extension + modular-services + config-driven** deseniyle kapatmak.
**Claude Design** bu programda yalnızca **UI-prototip üreticisi**dir (HTML+screenshot+README handoff);
backend/DB/host üretmez, localhost'a bağlanamaz. Convergence = "her modülün UI'ı Claude Design'da
prototiplenip Claude Code ile mevcut ollamas frontend+backend'e implemente edilmesi + odysseus-parity
kabul kriterinin geçmesi".

---

## 1. Premise Düzeltmesi — Claude Design'ın rol sınırı (KRİTİK)

Önceki planlarda örtük bir hata riski var: "Claude Design ile modül yapalım" cümlesi,
Claude Design'ı bir **app-runtime / backend generator** sanmaya yol açabilir. **Yanlış.**

### 1.1 Claude Design NE'dir
- **Frontend-only UI tasarım canvası** (claude.ai/design, Nisan 2026).
- Çıktısı: **handoff bundle** = statik `HTML` + `screenshot` + `README` (tasarım niyeti/spec).
- Görevi: bir modülün **görünümünü ve etkileşim iskeletini** hızlı prototiplemek.

### 1.2 Claude Design NE DEĞİL'dir (sınır)
- ❌ Backend/API **üretmez** (Node `server.ts`, route, iş mantığı yok).
- ❌ Veritabanı/şema **üretmez** (JSON store / SQLite / vektör-DB yok).
- ❌ Host/deploy **yapmaz**; `localhost`, ollamas server'ı veya MCP server'a **bağlanamaz**.
- ❌ Canlı veri **çekemez** (fetch to localhost/MCP yok) → prototip mock/statik veriyle çalışır.

### 1.3 Doğru workflow (üç aşama)
```
[1] Claude Design  →  UI prototip (mock data) → handoff bundle (HTML + screenshot + README)
[2] Claude Code    →  bundle'ı MEVCUT ollamas'a implemente:
                       - frontend: src/components/<Modül>.tsx  (React+Vite, mevcut tab sistemi)
                       - backend : server.ts route + server/<modül>.ts servis + persistence
                       - MCP     : server/mcp/* (extension olarak email/rag/vs.)
[3] deploy         →  mevcut ollamas boot/launch pipeline (Docker + bin/ollamas-boot.sh)
```
**Kural:** Claude Design'dan çıkan hiçbir şey "çalışan modül" sayılmaz; yalnızca **spec + UI iskelet**tir.
Runtime davranışı, veri, güvenlik, MCP her zaman Claude Code tarafında ollamas koduna yazılır.

---

## 2. Mevcut ollamas — VAR / YOK Envanteri (koda karşı doğrulanmış)

**Kaynak-of-truth:** ana kaynak ağacı (`src/`, `server.ts`, `server/`, `server/mcp/`, `orchestration/`).
`.claude/worktrees/*`, `contract/`, `docs/` **envanter dışı** (yardımcı/ayrı araçlar) sayıldı.

### 2.1 VAR (parity için "brownfield" — üstüne inşa edilecek)

| Yetenek | Kanıt (dosya:satır / route) | Not |
|---|---|---|
| **Agent chat + tool-exec loop** | `server.ts:1399` `POST /api/agent/chat`; `server.ts:2994` `plan.runAgentLoop` | odysseus `agent_loop` muadili — **VAR** |
| **Agent oturumları / event stream** | `/api/agent/sessions`, `/api/agent/sessions/:id/events`, `/api/agent/approve-write` | approve-write = human-in-loop |
| **AI generate / model listesi / transcribe** | `/api/ai/generate`, `/api/ai/models`, `/api/ai/transcribe`; `server/ai.ts` | Ollama+qwen ref `server/ai.ts` |
| **$0-local model + cloud katalog** | `server/embed-catalog.ts`, `server/cockpit-models.ts`; `.env` `OLLAMA_HOST` | local qwen3:8b + cloud toggle |
| **MCP server host'u** | `server/mcp/{server,client,catalog,supervisor,upstream-guard,oauth-*}.ts` | odysseus "MCP-as-extension" temeli **VAR** |
| **Orchestration / fleet / conductor** | `orchestration/bin/{orchestra,conduct,converge,fleet-*}.ts`; `/api/orchestra`, `/api/pipeline` | odysseus'ta yok — ollamas'ın **fazlası** |
| **Frontend tab-shell (30+ tab)** | `src/App.tsx` (id: telemetry, swarm, saas, pipeline, files, search, terminal, keys, security…) | modüler tab sistemi hazır iskele |
| **Theme toggle** | `src/components/ThemeToggle.tsx` | theming kısmen VAR |
| **Search (kod/GitHub)** | `/api/github/search`, `server/ecysearch*.ts`, `ECySearcherPanel.tsx` | ama **web-deep-research değil** (bkz 2.3) |
| **Files / workspace** | `/api/*` files, `WorkspaceTree.tsx`, `FileTransfer.tsx`, `server/files.ts` | ama **PDF/office/markdown editör değil** |
| **Billing / SaaS / RBAC-benzeri katman** | `/api/billing/*`, `/api/saas/*`, `SaaSAdmin.tsx`, `SecurityPolicies.tsx` | multi-tenant var; **TOTP/2FA yok** (2.3) |

### 2.2 YOK (odysseus-parity boşluğu — Odyssey'in inşa hedefi)

| Odysseus modülü | ollamas'ta durum | Kanıt (arama sonucu) |
|---|---|---|
| **Research (deep_research + SearXNG)** | ❌ YOK | `searxng` → hiç eşleşme; `research` yalnızca worktrees'te |
| **Documents (PDF/office/markdown editör + upload)** | ❌ YOK | `document` → yalnızca `contract/` (ayrı araç); editör yok |
| **Email (IMAP/SMTP MCP server + triage)** | ❌ YOK | `imap` → 0 eşleşme; `smtp` yalnızca `contract/`; `triage` operasyon-triage, e-posta değil |
| **Notes / Tasks (memory + cron scheduler)** | ❌ YOK | `notes` yalnızca worktrees; kalıcı not/task modülü ana ağaçta yok |
| **Calendar (CalDAV / ICS)** | ❌ YOK (self-hosted) | `caldav` → 0 eşleşme (bkz 2.3 nüansı) |
| **Local-models Cookbook (donanım-farkında öneri)** | ❌ YOK | `cookbook` → 0 eşleşme; katalog var ama donanım-farkında öneri motoru yok |

### 2.3 Nüanslar / yanıltıcı benzerlikler (plan yaparken tuzak)

1. **Google tab'ları ≠ odysseus modülleri.** `App.tsx`'te `gmail`, `calendar`, `drive`, `sheets`
   tab'ları VAR **ama** bunlar **Google SaaS OAuth browser** panelleri
   (`GmailBrowser.tsx`, `GoogleCalendarBrowser.tsx`). Odysseus'un **self-hosted IMAP/SMTP ve
   CalDAV/ICS MCP server** modeli DEĞİL. Parity için: harici-SaaS bağımlılığı yerine
   **kendi-barındırılan protokol MCP server'ı** gerekiyor. (UI tab iskeleti yeniden kullanılabilir.)
2. **Persistence uçurumu.** odysseus = **SQLite + ChromaDB (vektör/RAG)**. ollamas `server/db.ts`
   = **JSON-dosya store** (`JSON.stringify` + `atomicWriteFileSync`, db.ts:306). Vektör-DB/embedding
   kalıcılığı YOK. Research/documents/notes-memory modülleri **RAG storage katmanı** olmadan parity'ye ulaşamaz.
3. **Config-driven yarı-parity.** odysseus "40+ .env toggle" ile övünür; ollamas `.env.example`
   = **~21 anahtar**. Modular-services açık/kapa toggle deseni genişletilmeli.
4. **2FA/RBAC.** odysseus TOTP + admin/non-admin tool-policy. ollamas'ta gerçek TOTP kütüphanesi
   ana ağaçta **yok** (yalnızca test/cli izleri); `SecurityPolicies.tsx`/`SaaSAdmin.tsx` policy iskeleti var
   ama TOTP 2FA eksik.
5. **PWA.** `public/manifest.json` / webmanifest **yok** → PWA parity için eklenecek.
6. **server.ts monolit riski.** 3191 satır tek dosya. Yeni modüller buraya route eklerken
   **modular-services** ayrıştırması (server/<modül>.ts) yapılmazsa teknik borç patlar.

---

## 3. Odysseus Referans Modeli (parity hedefi)

**odysseus** (github.com/pewdiepie-archdaemon/odysseus, 82k★): self-hosted AI workspace.
Stack: **FastAPI + VanillaJS + SQLite + ChromaDB + Docker**.
Extensibility sırrı (Odyssey'in kopyalayacağı 3 desen):

1. **MCP-as-extension** — email / image / memory / rag modülleri birer MCP server olarak takılır.
2. **Modular-services** — her modül bağımsız servis; açık/kapa edilebilir.
3. **Config-driven** — `.env` 40+ toggle ile davranış runtime'da şekillenir.

Ek parity boyutları: 2FA/RBAC (TOTP + admin/non-admin tool-policy), theming/PWA.

> **Not — stack farkı stratejik:** ollamas FastAPI değil **Node/TS**, VanillaJS değil **React+Vite**.
> Odyssey **birebir port değil, kavram-parity** hedefler: aynı *modül yetenekleri* + aynı *extensibility desenleri*,
> ollamas'ın kendi stack'inde. odysseus'un fazlası (orchestra fleet, saas-billing) korunur.

---

## 4. Convergence Tanımı

**Odyssey convergence**, aşağıdakilerin tümü sağlandığında gerçekleşir:

1. **Modül-parity:** 2.2'deki 6 YOK-modülün her biri ollamas'ta çalışır (route + servis + UI tab + persistence).
2. **Extensibility-parity:** her yeni modül **MCP-as-extension** veya **modular-service** olarak
   ollamas'ın mevcut `server/mcp/*` host'una takılır; `.env` toggle ile açılıp kapanır.
3. **Handoff-disiplini:** her modülün UI'ı önce Claude Design'da prototiplenir → handoff bundle →
   Claude Code ile ollamas'a implemente (§1.3). Claude Design çıktısı asla "runtime" sayılmaz.
4. **Kabul-kapısı (§7):** her modül odysseus-parity kabul kriterini + kalite kapısını (typecheck+lint+test) geçer.

**Convergence ölçütü (tek sayı):** `parity_score = (geçen_kabul_kriteri) / (toplam_kabul_kriteri)` → hedef **1.0**.

---

## 5. Hedef Plan (TDD-adımlı, test-önce)

> Her modül için **önce test yazılır (RED), sonra implement (GREEN), sonra refactor**.
> Sıra bağımlılığa göre: **Faz 0 (temel katman) diğer her şeyi kilitler.**

### Faz 0 — Temel Katman (blocker; diğer fazlar buna bağlı)
Amaç: RAG/persistence + config-toggle + MCP-extension iskeleti (odysseus SQLite+ChromaDB muadili).
- **RED:** `server/__tests__/persistence-vector.test.ts` — "embedding yaz → benzerlik sorgusu doğru döner" (kasıtlı fail).
- **RED:** `server/__tests__/module-toggle.test.ts` — "`.env` `MODULE_RESEARCH=0` iken /api/research 404".
- **GREEN:** `server/store/` altında vektör-store adaptörü (SQLite + local embedding; ChromaDB opsiyonel MCP);
  `server/module-registry.ts` config-driven toggle.
- **REFACTOR:** `server.ts` route kaydını modül-registry üzerinden yap (monolit hafifletme).
- **Çıkış kapısı:** her iki test GREEN + typecheck+lint temiz.

### Faz 1 — Research (deep_research + SearXNG)
- **RED:** `server/__tests__/research.test.ts` — mock SearXNG ile "sorgu → kaynak listesi + sentez" iddiası.
- **GREEN:** `server/research.ts` (SearXNG adapter, self-hosted/opsiyonel), `/api/research/*`; Faz 0 vektör-store'a yaz.
- **UI:** Claude Design prototip → `src/components/ResearchPanel.tsx` (mevcut tab sistemine `id: "research"`).
- **Kabul:** §7 R-kriterleri.

### Faz 2 — Documents (upload + PDF/office/markdown + editör)
- **RED:** `server/__tests__/documents.test.ts` — "PDF upload → metin çıkarımı → markdown editöre yüklenir".
- **GREEN:** `server/documents.ts` (parse+store), `/api/documents/*`; Faz 0 store + RAG indeksleme.
- **UI:** Claude Design → `DocumentsPanel.tsx` (markdown editör iskeleti).
- **Kabul:** §7 D-kriterleri.

### Faz 3 — Email (IMAP/SMTP MCP server + triage)
- **RED:** `server/mcp/__tests__/email-server.test.ts` — mock IMAP "gelen kutusu listesi + triage etiketi".
- **GREEN:** `server/mcp/email-server.ts` (**MCP-as-extension**, self-hosted IMAP/SMTP); `App.tsx` `gmail` tab'ı
  yeniden kullanılabilir ama backend Google değil kendi MCP'ye bağlanır.
- **Kabul:** §7 E-kriterleri.

### Faz 4 — Notes/Tasks (memory + cron scheduler)
- **RED:** `server/__tests__/notes-scheduler.test.ts` — "not oluştur → cron tetikler → hatırlatma event'i".
- **GREEN:** `server/notes.ts` + scheduler (mevcut webhook/worker interval altyapısını yeniden kullan);
  memory Faz 0 vektör-store'a bağlanır.
- **Kabul:** §7 N-kriterleri.

### Faz 5 — Calendar (CalDAV/ICS)
- **RED:** `server/mcp/__tests__/calendar-server.test.ts` — mock CalDAV "etkinlik oku/yaz + ICS export".
- **GREEN:** `server/mcp/calendar-server.ts` (**MCP-as-extension**, self-hosted CalDAV/ICS).
- **Kabul:** §7 C-kriterleri.

### Faz 6 — Local-models Cookbook (donanım-farkında öneri)
- **RED:** `server/__tests__/cookbook.test.ts` — "RAM/VRAM girdisi → uygun qwen/model önerisi".
- **GREEN:** `server/cookbook.ts` (donanım algıla → `embed-catalog`/`cockpit-models` ile eşle).
- **Kabul:** §7 K-kriterleri.

### Faz 7 — Cross-cutting parity (2FA/RBAC, theming/PWA)
- **RED:** TOTP doğrulama testi + admin/non-admin tool-policy testi + PWA manifest varlık testi.
- **GREEN:** TOTP (server/auth), tool-policy (mevcut `SecurityPolicies.tsx`'i besle), `public/manifest.json`.
- **Kabul:** §7 X-kriterleri.

> **Paralellik notu (CLAUDE.md Tier-1 kuralı):** Faz 1–6 birbirinden bağımsız → Faz 0 GREEN olduktan
> sonra paralel sub-agent'lara dağıtılabilir. Faz 0 bitmeden hiçbir modül fazı spawn edilmez.

---

## 6. Claude Design ↔ Claude Code Handoff Sözleşmesi (her faz için)

| Adım | Sahibi | Çıktı | Kabul |
|---|---|---|---|
| UI prototip | Claude Design | `HTML + screenshot + README` (mock data) | Emre görsel onay |
| Implement | Claude Code | `src/components/*.tsx` + `server/*.ts` + test | typecheck+lint+test GREEN |
| Persist/MCP | Claude Code | Faz 0 store / `server/mcp/*` extension | ilgili test GREEN |
| Deploy | Claude Code | mevcut boot pipeline | `/api/health` yeşil |

**Değişmez:** Claude Design bundle'ı `localhost`/MCP'ye bağlanmaz; canlı veri Claude Code entegrasyonunda gelir.

---

## 7. odysseus-Parity Kabul Kriteri (modül başına)

Bir modül **"parity"** sayılır ⇔ **6 kriterin tamamı** GREEN:

1. **Fonksiyon:** odysseus'un o modüldeki ana yeteneği ollamas'ta çalışır (yukarıdaki RED testi artık GREEN).
2. **Extensibility:** modül **MCP-as-extension** veya **modular-service** olarak takılı; kod `server.ts` monolitine gömülü değil.
3. **Config-driven:** `.env` toggle (`MODULE_<AD>=0/1`) modülü açıp kapatır; kapalıyken route 404/gizli.
4. **Persistence:** veri Faz 0 store'a yazılır; süreç yeniden başlayınca kalıcı (JSON-only regresyon yasak — RAG gerekiyorsa vektör-store).
5. **UI:** Claude Design prototipinden türetilmiş tab `App.tsx`'e entegre; tema + i18n (`src/locales`) uyumlu.
6. **Kalite kapısı:** typecheck ✓ lint ✓ test suite (fresh run) ✓ — CLAUDE.md pre-ship zorunluluğu.

**Program-düzeyi kabul:** `parity_score = 1.0` (6 modül × 6 kriter = 36 kapı) **+** cross-cutting (2FA/RBAC/PWA) GREEN.

---

## 8. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

| # | Tip | Madde | Etki | Azaltma |
|---|---|---|---|---|
| KN-1 | Bilinmeyen | odysseus repo'su (github.com/pewdiepie-archdaemon/odysseus) **doğrulanmadı** — koddan değil task-brief'ten alındı; 82k★ ve modül listesi **varsayım** | Parity hedefi yanlış kalibre olabilir | Faz 0 öncesi odysseus README/mimari **fetch+doğrula**; sapma varsa bu belgeyi güncelle |
| KN-2 | Varsayım | Claude Design'ın "HTML+screenshot+README handoff" formatı (Nisan 2026) brief'e dayanıyor; gerçek export şeması doğrulanmadı | Handoff sözleşmesi (§6) kayabilir | İlk modülde gerçek bir Design export ile pilot yap; §6'yı ampirik düzelt |
| KN-3 | Risk | **Persistence uçurumu** — JSON store → SQLite+vektör-DB geçişi Faz 0'da yapılmazsa research/docs/notes parity imkansız | Program blocker | Faz 0 kesin blocker; vektör-store adaptörü seçimi (SQLite-vss vs ChromaDB-MCP) erken karar |
| KN-4 | Risk | **server.ts 3191-satır monolit**; her modül route buraya eklenirse teknik borç patlar | Bakım/çakışma | Faz 0'da `module-registry` + `server/<modül>.ts` ayrıştırması zorunlu |
| KN-5 | Belirsizlik | Google gmail/calendar tab'ları **korunacak mı yoksa self-hosted MCP ile değiştirilecek mi?** | Kapsam/çift-bakım | Emre kararı (T0): "harici-SaaS + self-hosted yan-yana" mı "yalnız self-hosted" mı |
| KN-6 | Varsayım | `.env` toggle'ın ~21→40+ genişletilmesi odysseus config-parity için gerekli sayıldı; hangi toggle'ların gerçekten gerektiği modül-bazında netleşecek | Fazla mühendislik riski | Toggle'ları modül ihtiyaç doğunca ekle (YAGNI); §7-3 minimum `MODULE_*` yeterli |
| KN-7 | Risk | SearXNG / IMAP / CalDAV **self-hosting** kullanıcıdan altyapı ister (ek servis/Docker) | Kurulum sürtünmesi | Her modül "opsiyonel + toggle-off default"; mock-adapter ile testler altyapısız geçer |
| KN-8 | Bilinmeyen | 2FA/TOTP için kütüphane seçimi (`otplib` vb.) ve mevcut `SaaSAdmin`/`SecurityPolicies` ile entegrasyon yüzeyi henüz haritalanmadı | Faz 7 tahmini kaba | Faz 7 başında `SecurityPolicies.tsx` + saas-auth path'ini oku, sonra tahmin et |

---

## 9. Sonraki Belge

`docs/odyssey/02-*.md` → Faz 0 (temel katman: vektör-store + module-registry + config-toggle) detaylı TDD planı.
Bu belge Faz 0 başlamadan **KN-1 (odysseus doğrulama)** ve **KN-5 (Emre kapsam kararı)** ile güncellenmeli.
