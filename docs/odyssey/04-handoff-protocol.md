# ODYSSEY O3 — Claude Design Handoff → Claude Code İmplementasyon Protokolü

> **Belge:** `docs/odyssey/04-handoff-protocol.md`
> **Odak (O3):** Her Claude Design **handoff-bundle**'ının (HTML/CSS/JS + screenshot + design-intent) mevcut ollamas **Vite + React 19** component'ine nasıl çevrileceği + backend'e nasıl bağlanacağı. **Adım-adım, tekrarlanabilir** protokol.
> **Girdi:** `docs/odyssey/03-claude-design-ui.md` (8 panel brief'i + ortak bundle şablonu).
> **Referans mantık:** `figma-design-to-code` skill (design → code: **reference'ı verbatim yapıştırma; mevcut component/token/convention'ları yeniden kullan**).
> **Dil:** TR (kod/komut/dosya-yolu/prop-adı EN).
> **Üretim tarihi:** 2026-07-10.

---

## 0. Bu belgenin yeri (O2 → O3 → O-backend)

```
O2 (03-claude-design-ui.md)   →  panel brief'leri: Claude Design'a NE tasarlatılacak
O3 (BU BELGE)                 →  handoff-bundle → ollamas React component'i NASIL çevrilir + backend'e NASIL bağlanır
O-backend (05-features/*)     →  her panelin server/*.ts servisi + endpoint sözleşmesi
```

**Değişmez kural (03 §0'dan devralınır):** Claude Design **frontend-only UI-tasarım aracı**dır — backend/DB/host üretmez, `/api/*` çağıramaz, canlı state/SSE/auth yoktur. Bundle **mock veriyle** gelir. **O3'ün tüm işi:** bu ölü-mock UI'ı, ollamas'ın canlı `apiClient` + token + i18n + capability katmanlarına **cerrahi** olarak dikmektir. Backend'i bundle **belirlemez**; endpoint sözleşmesi 05-features'ta yaşar.

**Golden Rule (figma-design-to-code §2'den):** Bundle HTML/CSS/JS = **REFERANS**, final kod değil. Verbatim kopyalanmaz. Mevcut `src/components/*` desenine, `apiClient`'a, `--ollamas-*` token'larına **adapte edilir**.

---

## 1. Mevcut frontend yapısı — çeviri hedefi (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas/src` okundu (2026-07-10). Bu tablo **çeviri sözleşmesi**dir — her bundle bu kolonlara oturur.

### 1.1 Stack + iskelet
- **Vite + React 19 + TypeScript**, Tailwind **v4** (`@theme` inline, `dark:` prefix YOK), `lucide-react` ikon.
- **Entry:** `src/main.tsx` → `StrictMode > ErrorBoundary(ErrorFallback) > ThemeProvider > I18nProvider > App`. **Her render crash → `logClientEvent('react_error')`.** Yeni panel bu ağacın altında mount olur; ayrı provider **eklenmez**.
- **Shell:** `src/App.tsx` — tek dosya; header + sol `tabs[]` nav + `lg:col-span-3` dinamik panel gövdesi. Panel mount deseni: `activeTab === "<id>" && <Panel .../>`.

### 1.2 Backend çağrı deseni — TEK choke-point (`src/lib/apiClient.ts`)
Component'ler **ASLA** `fetch`/`EventSource` doğrudan çağırmaz (FRONTEND_AGENTS.md §1/§4). Tüm I/O buradan:

| Yöntem | İmza | Kullanım |
|---|---|---|
| `api.get<T>(ep, opts?)` | GET, retry=2 default | polling / snapshot |
| `api.post<T>(ep, body?, opts?)` | POST, retry=0 default | mutation |
| `api.put` / `api.del` | — | update / delete |
| `api.streamPost(ep, body, {onChunk,onError,signal,retries})` | SSE-over-POST | chat token akışı, pipeline |
| `api.uploadFile(relPath, data, {signal})` | octet-stream binary | dosya upload |
| `api.downloadFile(relPath, {signal})` | → Blob | dosya download |
| `logClientEvent(note, meta?)` | best-effort → `/api/logbook` | telemetri (UI'a asla throw etmez) |
| `ApiError` | `{status, endpoint, body}` | tüm hata yolu bu tipi fırlatır |

**Kritik detaylar (çeviride korunacak):**
- Auth başlıkları `authHeaders()` ile **otomatik** enjekte edilir (`X-Admin-Token`, `Bearer` — localStorage'dan). Yeni panel header wiring **YAZMAZ**.
- `401/403` = birinci-sınıf auth durumu (hata sayılmaz, RUM'a `api_error` yazılmaz). `429/5xx` = transient → retry + log.
- Beklenen-degradable (opsiyonel entegrasyon/offline alt-servis) çağrılarda `{soft:true}` geç → 5xx `api_error` olarak loglanmaz.
- Stream: chunk gelmeye başladıktan sonra **reconnect edilmez** (LLM üretimi resume olamaz); mid-stream drop → `onError`, `signal.aborted` = sessiz iptal.

### 1.3 Tasarım-token / tema (mevcut, korunacak — bundle'ın renkleri buraya remap edilir)
- **Katman:** `tokens/*.json` (**tek doğruluk kaynağı**) → `style-dictionary` → `src/styles/tokens.css` (`:root` = dark) + `tokens-light.css` (`[data-theme="light"]`). **`tokens.css` EL İLE DÜZENLENMEZ** → `npm run tokens` ile regenerate.
- **Tailwind eşlemesi** (`src/index.css` `@theme`):

  | Utility class | Token var | Değer (dark) |
  |---|---|---|
  | `bg-immersive-bg` | `--ollamas-color-bg-base` | `#050608` |
  | `bg-immersive-sidebar` | `--ollamas-color-bg-sidebar` | `#08090d` |
  | `bg-immersive-panel` | `--ollamas-color-bg-panel` | `#0a0b10` |
  | `bg-immersive-inset` | `--ollamas-color-bg-inset` | `#04050a` |
  | `border-immersive-border` | `--ollamas-color-border-subtle` | `rgba(255,255,255,.05)` |
  | `text-immersive-text-bright/muted/dim` | `--ollamas-color-text-*` | `#f8fafc / #94a3b8 / dim` |
  | `text-status-accent/ok/warn/err/info` | `--ollamas-color-status-*` | `indigo / #34d399 / #fbbf24 / #fb7185 / #22d3ee` |
  | `font-sans` / `font-mono` | Inter / JetBrains Mono | — |

- **Tema:** `src/lib/theme.tsx` — `useTheme()` context; tek `[data-theme]` attribute ile flip. Component **theme-agnostic** kalır (`dark:` prefix yasak; sadece token utility). Yeni renk gerekirse → `tokens/*.json`'a ekle, `dark:` yazma.

### 1.4 Capability gate (`src/lib/capabilities.ts`)
- `CapabilityGate need="fileRead|fileWrite|commandExec|git"` + `CapabilityDenied`. **Deny-by-default** (perms null → kilitli). Bu **RBAC değil** — backend `telemetry.permissions{}` yansıması; gerçek sınır backend ToolRegistry tier-allowlist.
- Panel bir yazma/exec eylemi yapıyorsa gate **zorunlu**; `TAB_CAPABILITY` map'ine tab-id eklenir.

### 1.5 i18n (`src/lib/i18n.ts` + `src/locales/{en,tr}.ts`)
- Lingui **runtime** (macro yok). `_(\`app.tab.${id}\`)` sekme etiketini döner; **anahtar yoksa id string'i döner** (sessiz bozulma). Her yeni panel → `app.tab.<id>` **EN+TR** zorunlu; panel-içi tüm metin `_('<panel>.<key>')`.

### 1.6 Component konvansiyonu (örnek: `cockpit/KeyHealthPanel.tsx` — kanonik referans)
```
function XPanel(): React.ReactElement {
  const [snap, setSnap] = useState<T | null>(null);        // null = "henüz hazır değil"
  useEffect(() => {                                         // polling: alive flag + clearInterval cleanup
    let alive = true;
    const load = async () => { try { setSnap(await api.get<T>("/api/…")); } catch {/* transient */} };
    load(); const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // 4-durum: !snap → loading skeleton · boş → honest empty · ApiError → error+retry · ok → içerik
  return <div className="bg-immersive-sidebar border border-immersive-border rounded p-5 …">…</div>;
}
```
Desen kuralları: `null`-guard `.map` öncesi (`Array.isArray(snap?.x)`), status→renk **`Record<Status,string>` tone map**, ikon `lucide-react`, başlık `font-mono uppercase tracking-wider`, metin `text-[9px..12px]` mono ölçek.

---

## 2. HANDOFF PROTOKOLÜ — adım-adım (her bundle için AYNI 8 adım)

> Girdi: `docs/odyssey/handoff/<panel>/` (bundle: `PROMPT.md, design.html, screenshot.png[, screenshot-light.png], HANDOFF.md, tokens.snippet.css` + panel-özel `*.spec.md`).
> Çıktı: `src/components/<Panel>.tsx` (+ opsiyonel alt-component'ler) + i18n anahtarları + App.tsx mount + testler + geçen gate.
> **Disiplin:** TDD (test-önce), implementer ≠ verifier, root-cause-önce, evidence-önce (03 §4 T0 kapıları).

### Adım 1 — BUNDLE-AL (ingest & doğrula)
1. Bundle'ı `docs/odyssey/handoff/<panel>/` altına yerleştir (yoksa klasör oluştur; 03 §3 şablonu).
2. **5 dosya var mı** denetle: `design.html`, `screenshot.png`, `HANDOFF.md`, `PROMPT.md`, `tokens.snippet.css`. Eksikse → **DUR**, Emre'den iste (figma-design-to-code §Error Recovery: eksik context'le screenshot'tan el-yazımı YASAK).
3. `HANDOFF.md`'yi oku → çıkar: **component adı**, **prop imzası**, **i18n anahtar listesi**, **`/api` sözleşmesi (mock→real map)**, **durum-listesi (4-durum)**.
4. `design.html` + `screenshot.png`'yi **niyet (intent)** için oku — **layout/hiyerarşi/durum** çıkar, inline CSS'i **değer olarak alma** (K2: Claude Design token değil ham hex üretir).

### Adım 2 — COMPONENT-EŞLE (reuse-first envanter)
> figma-design-to-code §3: yeni yazmadan önce projede mevcut karşılığı ara.
1. 03 §1.4 eşleme tablosundan panelin **durumunu** (VAR/KISMİ/YOK) al:
   - **VAR / KISMİ** → mevcut dosyayı **genişlet** (state/logic KORUNUR, sadece görsel katman). Örn. `chat → ReactAgentTab.tsx`, `documents → WorkspaceTree.tsx`, `calendar → GoogleCalendarBrowser.tsx`, `settings → SecurityPolicies.tsx`.
   - **YOK** → yeni `src/components/<Panel>.tsx` (örn. `notes`, `research`, `email`, `cookbook`).
2. Bundle'daki **tekrar eden birim**leri (kart, satır, rozet, çip) mevcut primitive'e eşle: `Skeleton.tsx`, `Sparkline.tsx`, `OfflineBadge.tsx`, `CapabilityGate.tsx`, status-tone map deseni. **Yeni eşdeğer üretme** — varsa yeniden kullan.
3. Panel-özel `*.spec.md`'deki prop imzasını (`TRACE_CARD.spec.md`, `MODEL_CARD.spec.md` vb.) TypeScript `interface`'e çevir → `src/types.ts`'e ekle (mevcut tip stiliyle).

### Adım 3 — TOKEN-UYGULA (renk/space/font remap)
> **En kritik manuel adım (K2).** Bundle inline hex/px üretir; ollamas token utility'sine remap edilir.
1. `tokens.snippet.css`'i **kaynak** al; bundle'daki her ham değeri en yakın `--ollamas-*` var'a / `bg-immersive-*` / `text-status-*` utility'ye eşle (§1.3 tablosu).
2. **`dark:` prefix YAZMA** — dark/light paritesi token katmanından gelir. `#0a0b10` → `bg-immersive-panel`, `#6366f1` → `text-status-accent`, `#34d399` → `text-status-ok`, vb.
3. Bundle'da **token'da olmayan** yeni renk varsa → `tokens/*.json`'a ekle + `tokens-light.css` karşılığı + `npm run tokens` (tokens.css el-ile düzenleme YASAK). Utility eşlemesi gerekiyorsa `src/index.css` `@theme`'e satır ekle.
4. Radius/space: `rounded` (md 8px) / `rounded-sm` (3px), `p-4/p-5`, `gap-1.5..3` mevcut ölçeğe hizala. Font: başlık `font-mono uppercase tracking-wider`, gövde `font-sans`.
5. Screenshot ile **light varyantı** da kontrol et (`screenshot-light.png` varsa); token remap iki temada da doğru render etmeli.

### Adım 4 — COMPONENT-YAZ (React 19 + convention)
1. §1.6 kanonik deseniyle component iskeletini kur: function component, `useState<T|null>`, `useEffect` (alive+cleanup), 4-durum blok.
2. Prop imzasını `HANDOFF.md`'den al; App.tsx'in verdiği ortak prop'lara uy: `onNotify?: (msg,type)=>void`, `telemetry`/`workspacePath` gerekiyorsa. Mevcut panel prop'larıyla tutarlı isimlendir.
3. Tüm metin `_('<panel>.<key>')` — **hardcoded string YASAK**. İkonlar `lucide-react`.
4. a11y: liste `role="list"`/`role="log"`, canlı akış `aria-live="polite"`, buton `aria-label`, focus-visible, `prefers-reduced-motion` (mevcut `.animate-fade-in` / skeleton zaten saygılı).

### Adım 5 — APICLIENT-BAĞLA (mock → canlı)
> Bundle'daki mock array'ler `apiClient` çağrılarıyla değiştirilir. **Endpoint sözleşmesi `HANDOFF.md` "mock→real map" + 05-features'tan gelir.**
1. Snapshot/liste → `api.get<T>('/api/<panel>/…', {soft?})` (opsiyonel/degradable ise `soft:true`).
2. Mutation → `api.post/put/del`; upload → `api.uploadFile`; download → `api.downloadFile`.
3. Streaming (chat/research/pipeline) → `api.streamPost(ep, body, {onChunk, onError, signal})`; abort için `AbortController`, `useEffect` cleanup'ta `ctrl.abort()`.
4. **Doğrudan `fetch`/`EventSource` YASAK** (§1.2). Auth wiring yazma (otomatik). Hata → `ApiError` yakala → 4-durum "error" bloğu + `onNotify`. `logClientEvent` gerekiyorsa best-effort.
5. **Endpoint henüz YOKSA (backend O-backend işi, K3):** `apiClient` çağrısını yaz ama arkasında endpoint yoksa panel **honest-empty / "not available"** durumuna düşmeli (`soft:true` + boş-durum). Panel, backend gelene kadar **çökmeden** mock-boş render eder. Backend sözleşmesi 05-features'ta implemente edilince mock kaldırılır.

### Adım 6 — MOUNT-ET (App.tsx + i18n + capability)
1. `src/App.tsx` `tabs[]`'a `{ id: "<panel>", icon: <Icon className="w-4 h-4 …" /> }` ekle (uygun `lucide-react` ikon).
2. Panel gövdesine mount blok: `{activeTab === "<panel>" && (<div className="animate-fade-in"><Panel …/></div>)}`. Yazma/exec varsa `CapabilityGate need="…" fallback={<CapabilityDenied …/>}` sarmalı + `TAB_CAPABILITY` map'ine ekle.
3. `src/locales/en.ts` + `tr.ts`'e **`app.tab.<panel>`** + tüm `<panel>.*` anahtarları (EN+TR **eşit sayıda** — K9: eksik anahtar runtime'da id sızdırır).
4. **Nav taşma riski (K4):** 21 sekme zaten uzun; 6+ yeni sekme sidebar'ı taşırır. Bu adımda **kategori-gruplama veya ⌘K komut paleti** değerlendir (App.tsx nav refactor = ayrı iş, ama mount sırasında not düş).

### Adım 7 — TEST-ET (TDD kırmızı→yeşil)
1. **Test-önce** (03 her panel §TDD adımlarından): `<Panel>.test.tsx` — 4-durum render (loading/empty/error/ok), prop akışı, i18n anahtar varlığı, a11y rol. Backend varsa `server/__tests__/<panel>.test.ts` (mock fetch, sözleşme bütünlüğü).
2. Testler **kırmızıyken** UI'ı handoff'a göre yaz → **yeşile** çek.
3. Görsel parity: `screenshot.png` referans; `mcp__Claude_Preview__preview_*` veya Playwright ile dark+light render doğrula.

### Adım 8 — GATE + SHIP (T0 kapısı)
```
npm run typecheck  ✓   →   npm run lint  ✓   →   npm test (fresh)  ✓   →   commit
```
- Gate geçmeden commit YASAK (CLAUDE.md Kalite Kapısı). Unused code silinir. Commit: `feat(<panel>): …` conventional.
- **implementer ≠ verifier:** yazan agent ≠ doğrulayan agent (ecyproskill:code-reviewer / pbvc-runner). CRITICAL bulgu ilk sırada, gizleme YASAK.

---

## 3. Her-panel handoff checklist (03'ün 8 paneli — bundle → done)

> Ortak 8 adım (§2) sabittir; aşağıdaki tablo **her panele özel sapmalar**ı verir. Sıra = 03 §4 bağımlılık sırası (T0 kapılı).

| # | Panel (id) | Mevcut → hedef dosya | apiClient bağlama (Adım 5) | Capability | Backend (05-features) | Panel-özel not |
|---|---|---|---|---|---|---|
| 1 | **chat** (`react-agent`) | GENİŞLET `ReactAgentTab.tsx` + `AgentMessage.tsx` | `api.streamPost` (token akışı + trace step) | yok | `chat-agents.md` (VAR) | State/trace state KORUNUR; sadece görsel katman + trace-card. ⌘Enter gönder. |
| 2 | **cookbook** (`cookbook`) | YENİ `CookbookPanel.tsx` | `api.get('/api/cookbook', {soft})` + pull-progress SSE `streamPost` | yok | `05-features` cookbook (YOK) | HW-fit rozeti renk mantığı `MODEL_CARD.spec.md`'den; `cockpit/ModelsPanel` model listesine bağla. |
| 3 | **documents** (`documents`) | GENİŞLET `WorkspaceTree.tsx` + YENİ `DocumentEditor.tsx` | `api.get` (tree) + `api.uploadFile` + `api.downloadFile` + `api.put` (save) | **`fileWrite`** gate zorunlu | `documents.md` (KISMİ) | MD split-editör dirty/save state; upload dropzone progress. |
| 4 | **research** (`research`) | YENİ `ResearchPanel.tsx` (ECySearcher feed kaynak) | `api.streamPost` (adım akışı) + `api.get` (kaynak liste) `{soft}` | yok | `research-searxng.md` (YOK) | `[n]` atıf çipi → kaynak scroll; SearXNG-down honest-empty; `ENABLE_RESEARCH` toggle-gate. |
| 5 | **notes** (`notes`) | YENİ `NotesPanel.tsx` | `api.get/post/put/del` (CRUD) + cron-preview | yok | `notes-tasks.md` (YOK) | Notes/Tasks sekme; cron doğal-dil→string önizleme; `memory-stats` katmanına bağlanabilir. |
| 6 | **calendar** (`calendar-caldav`) | GENİŞLET `GoogleCalendarBrowser.tsx` → `CalendarPanel.tsx` | `api.get` (event) + `api.post/put/del` + ICS upload | yok | `calendar-caldav.md` (KISMİ) | Google-read KAYNAK KORUNUR; CalDAV/ICS eklenir; hafta-grid + event drawer. |
| 7 | **email** (`email`) | YENİ `EmailPanel.tsx` (Gmail'e DOKUNMA) | `api.get` (IMAP list) + `api.post` (SMTP send) `{soft}` | yok (credential `KeyVault`) | `email-mcp.md` (KISMİ) | K7: `GmailBrowser` metadata-only privacy-law KORUNUR; ayrı IMAP kanalı; triage çip filtresi. |
| 8 | **settings/2FA** (`settings`) | GENİŞLET `SecurityPolicies.tsx` → `SettingsPanel.tsx` | `api.post` (TOTP verify) + `api.get/put` (RBAC/toggle) | yok (kendisi RBAC kaynağı) | `05-features` auth/rbac (KISMİ) | K6 güvenlik-kritik: backend TOTP time-window + RBAC enforcement **yeşil olmadan UI ship YASAK**; UI tek başına sahte-güvenlik. |

**Her satır için değişmez checklist (mount öncesi ✓):**
- [ ] Bundle 5-dosya tam + `HANDOFF.md` mock→real map okundu (Adım 1)
- [ ] Mevcut component/primitive reuse edildi, yeni eşdeğer üretilmedi (Adım 2)
- [ ] Ham hex/px → `--ollamas-*` / `bg-immersive-*` / `text-status-*` remap; `dark:` prefix yok (Adım 3)
- [ ] `apiClient` üzerinden bağlandı, doğrudan `fetch` yok; endpoint yoksa honest-empty (Adım 5)
- [ ] `app.tab.<id>` + `<panel>.*` EN+TR eşit; capability gate (gerekiyorsa) (Adım 6)
- [ ] 4-durum test + görsel parity (dark+light); gate ✓ (Adım 7-8)

---

## 4. Kör-Nokta Ledger (Claude Design çıktı-kalitesi · token-uyum · manuel-adımlar)

> 03 §5'ten devralınan K1–K9'un **O3'e özgü** uzantıları. Yeni ID'ler H-serisi.

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| H1 | **VARSAYIM** | Claude Design export şeması (`design.html + screenshot.png + HANDOFF.md + PROMPT.md + tokens.snippet.css`) 03'te tarif edildiği gibi. Gerçek Nisan-2026 export dosya-adları/yapısı doğrulanmadı (K1). | Adım 1 ingest denetimi yanlış dosya arayabilir | İlk panelde (chat) **gerçek export yap → §2 protokolünü + §3 checklist'i kalibre et**; bu belgeyi güncelle. |
| H2 | **BİLİNMEYEN** | Claude Design inline CSS üretir, `--ollamas-*` **token değişkeni değil** ham hex/px (K2). Renk eşleşmesi yaklaşık olabilir (canvas'ın seçtiği hex ≠ tam token değeri). | Adım 3 token remap'te manuel yargı + drift riski | `tokens.snippet.css`'i brief'e **zorunlu** göm (03 §3); remap'i screenshot ile göz-doğrula; şüpheli renk → token'a en-yakın-eşle, ham bırakma. |
| H3 | **MANUEL** | Adım 3 (token remap) + Adım 5 (mock→real) **otomatikleştirilemez** — insan/agent yargısı gerekir. Bundle bunları çözmez. | Handoff hiçbir zaman %100 otomatik değil; her panel manuel dikiş | Bu belge = tekrarlanabilir **manuel** protokol; agent'a `figma-design-to-code` + `jeff-react-expert` route et. |
| H4 | **RİSK** | Bundle JS **interaktif logic** içerebilir (mock event handler, local state). Bu logic ollamas state modeliyle (React 19 hooks + `apiClient`) çelişebilir; verbatim taşınırsa çift-state / bug. | Adım 4'te "kolaycılık" ile bundle JS kopyalanırsa mimari bozulur | Golden Rule: bundle JS = davranış-**referansı**, kod değil. State DAİMA §1.6 deseniyle yeniden yazılır. |
| H5 | **RİSK** | 5 panelin (`cookbook, research, notes, email, settings-rbac`) **backend'i YOK** (K3). Adım 5 çağrısı boşa düşer. | Panel canvas'ta güzel ama runtime'da ölü | Adım 5.5 kuralı: `soft:true` + honest-empty → panel çökmeden mock-boş render eder; backend 05-features'ta gelince mock kaldırılır. **O3 tek başına canlı-panel garanti etmez.** |
| H6 | **VARSAYIM** | Claude Design İngilizce mock üretir; TR anahtarları Adım 6'da **el ile** yazılır (K9). Eksik `<panel>.*` TR → runtime id sızıntısı (Lingui fallback = id). | Yarım i18n = TR kullanıcıda ham anahtar görünür | Her `HANDOFF.md`'ye i18n-anahtar checklist; Adım 6'da EN==TR anahtar-sayısı diff kontrolü (CI grep). |
| H7 | **BİLİNMEYEN** | Bundle'ın a11y kalitesi belirsiz (Claude Design ARIA/kontrast garanti etmez). ollamas AA + `role`/`aria-live` + focus-visible bekler. | Adım 4'te a11y bundle'dan gelmezse regresyon | a11y **her zaman elle eklenir** (bundle'a güvenme); mevcut `KeyHealthPanel` kontrast-yorumları örnek; axe/Playwright a11y testi Adım 7. |
| H8 | **RİSK** | Nav taşması (K4): her başarılı handoff +1 sekme → 21→27 sidebar taşar. | Mount (Adım 6) UX'i bozar | ≥24 sekmede **⌘K komut paleti / kategori-grup** refactor'ı tetikle (ayrı iş, ama handoff sırasında karar noktası). |
| H9 | **MANUEL** | `tokens/*.json` değişikliği gerektiren bundle (yeni renk) → `npm run tokens` **el ile** çalıştırılmalı; unutulursa utility class boşa çıkar. | Adım 3.3 atlanırsa panel renksiz | Adım 3'te "yeni token mı?" kontrolü + `npm run tokens` regenerate zorunlu; `tokens.css` diff'i commit'e dahil. |
| H10 | **RİSK** | GENİŞLET edilen paneller (`chat, documents, calendar, settings`) mevcut **çalışan state/logic** taşır. Bundle'ın görsel katmanı bunu ezerse regresyon. | Görsel yükseltme mevcut davranışı bozabilir | Adım 2 kuralı: **state/logic KORUNUR, sadece görsel katman değişir**; mevcut testler yeşil kalmalı (regresyon gate). |

---

## 5. Parity Kabul Kriteri (O3 = handoff protokolü DONE koşulu)

Bir panelin handoff'u **DONE** sayılır ancak-ve-ancak:

- [ ] **§2'nin 8 adımı** sırayla uygulandı (bundle-al → component-eşle → token-uygula → component-yaz → apiClient-bağla → mount-et → test-et → gate).
- [ ] Bundle **verbatim kopyalanmadı**; mevcut `src/components` deseni + `apiClient` + `--ollamas-*` token + Lingui i18n **yeniden kullanıldı** (figma-design-to-code Golden Rule).
- [ ] **Doğrudan `fetch`/`EventSource` YOK** — tüm I/O `apiClient` üzerinden; auth wiring otomatik; hata `ApiError` → 4-durum.
- [ ] **`dark:` prefix YOK** — dark/light paritesi token katmanından; `screenshot.png` (dark) + light varyant görsel parity geçti.
- [ ] **4-durum** (loading/empty/error/ok) render edildi; honest-empty (backend yoksa `soft`+boş, çökme yok).
- [ ] **i18n `app.tab.<id>` + `<panel>.*` EN==TR** anahtar-sayısı eşit; hardcoded string yok.
- [ ] Yazma/exec paneli **`CapabilityGate`** ile sarıldı; `TAB_CAPABILITY` güncel.
- [ ] a11y (ARIA rol + `aria-live` + focus-visible + `prefers-reduced-motion` + AA kontrast) **elle** eklendi (H7).
- [ ] Gate: `typecheck ✓ lint ✓ test(fresh) ✓`; implementer ≠ verifier; unused code silindi; conventional commit.
- [ ] **Kör-Nokta:** panelin H1–H10'dan geçerli riskleri `HANDOFF.md`'de not düşüldü (özellikle backend-yok → H5, güvenlik → K6/H-settings).

**O3 belgesi nihai parity testi:** İlk gerçek Claude Design export'u (chat paneli) §2 protokolüyle uçtan-uca çevrildiğinde — bundle → canlı ollamas component'i, `apiClient`'a bağlı, dark/light + 4-durum + i18n EN/TR + gate-yeşil — **ve §3 checklist + H1 kalibrasyonu bu belgeye geri işlendiğinde**, O3 (handoff protokolü) **DONE**. Sonraki 7 panel aynı tekrarlanabilir protokolü izler.
