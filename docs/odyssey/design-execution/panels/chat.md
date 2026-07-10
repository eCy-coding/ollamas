# ODYSSEY-DESIGN Yürütme Planı — CHAT / AGENTS paneli (PİLOT)

> **Belge:** `docs/odyssey/design-execution/panels/chat.md`
> **Panel:** `react-agent` (odysseus `chat/agents` → agent-loop UI) · **Durum:** VAR (UX yükseltme, sıfırdan değil)
> **Rol:** **PİLOT panel** — bu, `design-execution` altındaki İLK operasyonel Claude Design yürütme planı. Handoff şablonu (03 §3 + 04) burada **ampirik** test edilecek; ilk gerçek Claude Design export bu panelde alınacak. Bulunan tüm sapmalar §7 PİLOT-notu'na ve geriye 03/04 belgelerine yansıtılacak.
> **Kaynak brief:** `docs/odyssey/03-claude-design-ui.md §3.1` (UI brief) + `docs/odyssey/05-features/chat-agents.md` (backend plan) + `docs/odyssey/04-handoff-protocol.md` (çeviri protokolü).
> **Dil:** TR (anlatı) · kod/komut/dosya-yolu/prop-adı EN.
> **Üretim tarihi:** 2026-07-10.

---

## 0. Amaç ve Kapsam

**Amaç:** Mevcut `ReactAgentTab` chat UI'ını odysseus-kalitesinde yeniden tasarlamak — **backend state/logic'e DOKUNMADAN**, yalnızca görsel/UX katmanını Claude Design → handoff → Claude Code zinciriyle yükseltmek.

**Değişmez kısıt (03 §0 + 04 §0):** Claude Design frontend-only UI-tasarım aracıdır. Mock veriyle tasarlar; `/api/*` çağıramaz, canlı SSE/state/auth yoktur. Bu planın işi ölü-mock tasarımı **canlı `ReactAgentTab` state makinesine cerrahi olarak dikmek** — yeni dispatch yolu, yeni backend endpoint YOK.

**Kapsam-DIŞI (bu panel değil):** Backend eksenler (token-delta streaming, spawn_subagent, ToolPolicy motoru) `05-features/chat-agents.md`'de yaşar — O-backend işi. Bu belge yalnızca **görsel katman** (03 §3.1). Streaming UI'ı **mock imleçle** tasarlanır; gerçek `token` frame'i backend Eksen A tamamlanınca bağlanır (o zamana kadar mevcut adım-bazlı `message` frame'i korunur).

---

## 1. Mevcut Chat UI — koda karşı DOĞRULANMIŞ envanter

> Kaynak: `Read` ile aşağıdaki dosyalar okundu (2026-07-10). Bu tablo **korunacak state/logic sözleşmesi**dir — redesign bunu bozamaz.

### 1.1 `src/components/ReactAgentTab.tsx` (ana bileşen, ~999 satır)

| Öğe | Dosya:Satır | Anlamı / korunacak sözleşme |
|---|---|---|
| **Props** — `{ onNotify(msg, type) }` | `ReactAgentTab.tsx:33-35` | Tek prop; toast bildirimi App'ten. Redesign prop imzasını **değiştirmez**. |
| **Provider/model state** — `provider`, `model`, `modelsList`, `loadingModels` | `:42-45` | Default `ollama-local` ($0-local kimlik); mount'ta ilk RUNNING local model seçilir (`fetchModels`, `:224`). |
| **Mesaj state** — `messages: Message[]` (role: user/assistant/system/tool + `step?`) | `:24-31, 48-53` | Server adım-başına tek `message` frame'i yollar → `step` ile key'lenir (yeni step append, aynı step overwrite). Redesign bu append mantığını **korur**. |
| **Trace state** — `traceSteps: TraceStep[]` (stepNum, tool, args, ok, latency, result, diff?, applied?) | `:13-22, 55` | Tool-call trace; `step` frame'inden upsert (`:332-341`). **Tasarımın kalbi**: her step bir kart. |
| **Streaming/lifecycle** — `isLoading`, `currentStepInfo`, `runStatus` (`complete`/`limit`), `lastTokS` | `:56-65` | Streaming durum çubuğu + run özeti (tok/s, temiz-bitiş vs kesildi). |
| **Toggle state** — `autoApply` (default true), `verify` (default false) | `:57-60` | Üst bar toggle'ları; `autoApply=false` → write onay wizard'ı. |
| **Session state** — `sessions`, `activeSessionId`, `loadingSessions` | `:68-70` | Sol sütun oturum listesi; CRUD (`loadSessions/selectSession/startNewSession/deleteSession`, `:81-177`). |
| **Onay state** — `pendingApproval` (path, content, diff, stepIndex), `approving` | `:180-187` | write_file `halt` akışı → sağ kolonda diff onay wizard'ı (`:836-869`). |
| **Genişletme state** — `expandedStep` | `:190` | Trace satırı tıklanınca args/result/diff açılır (`:956-986`). |
| **Abort/mount guard** — `abortRef`, `mountedRef`, `runningRef` | `:74-79` | vF8: unmount/yeni-run'da stream iptali + senkron in-flight guard. **Redesign bu ref'lere dokunmaz.** |
| **SSE tüketici** — `streamAgent(history, sessionId)` → `api.streamPost("/api/agent/chat", …)` | `:274-409` | Frame switch: `thought/message/step/paused/model/repair/verify/done/error` (`:307-389`). **Tek I/O yolu.** |
| **Gönder** — `handleSendMessage` (Enter=gönder, Shift+Enter=newline) | `:412-447, 746-751` | ⌘/Enter gönder mevcut (`:747`). |
| **Provider listesi** — 9 provider (gemini/openai/anthropic/openrouter/ollama-local/cloud/vllm/llamacpp/gemini-cli) | `:211-221` | Üst bar seçici; ikon+label. |
| **Tools paneli** — statik 5 tool kartı (list_tree, read_file, write_file, run_command, grep_search) | `:786-833` | Sağ kolon; şu an sabit liste (backend Eksen E `list_tools` ile dinamikleşebilir — kapsam-dışı). |
| **a11y** — mesaj listesi `role="log"` `aria-live="polite"` | `:681-685` | Streaming çıktı AT'a duyurulur. **Redesign korur.** |

### 1.2 `src/components/AgentMessage.tsx` (markdown-ish renderer, 77 satır)
- **Zero-dep** markdown renderer: fenced code (```lang) + inline `code` (`AgentMessage.tsx:17-29, 31-43`). Full markdown DEĞİL (heading/tablo yok) — bundle boyutu için kasıtlı minik.
- `parseSegments(src)` pure/total (any string → valid React, asla throw). Code blok kopyalanabilir (`:57-70`).
- **Redesign hedefi:** kod-blok görselini iyileştir (syntax-tint, dil rozeti) ama `parseSegments` sözleşmesini koru.

### 1.3 `src/components/MultiAgentPipeline.tsx` (ayrı sabit boru hattı, 533 satır)
- **Bu panelin PARÇASI DEĞİL** ayrı bir `/api/pipeline` akışıdır: architect→coder→reviewer DAG (`MultiAgentPipeline.tsx:38-46, 424-484`), her rol ayrı model/provider seçici, self-improve loop.
- Chat panelinin "çok-ajan sekmeleri" tasarımı için **görsel referans**: DAG node kartları (running/done/fail renk), tok/s rozeti, stage çıktı `pre` blokları.
- **Karar (K-reuse):** Chat redesign'ında "çok-ajan" görünümü ya (a) `MultiAgentPipeline`'ı chat panelinde ikinci bir sekme olarak **gömer**, ya (b) backend Eksen D (`spawn_subagent`, kapsam-dışı) gelince ReAct trace'ine alt-ajan kartı olarak entegre eder. **PİLOT için:** mevcut `MultiAgentPipeline`'ı BOZMA; chat tasarımına "Pipeline" sekmesi olarak sadece **yerini ayır** (tab shell), içeriği mevcut component kalır.

### 1.4 Mevcut UI'ın odysseus-altı kaldığı yerler (redesign hedefi)
- Mesaj balonları düz (avatar "U"/"A" harf); **reasoning-trace** (thought) yalnızca alt durum çubuğunda geçici görünür (`currentStepInfo`, `:733`), mesaj akışında kalıcı değil.
- Tool-call trace ayrı bir tablo olarak **en altta** (`:891-995`), mesaj akışından kopuk — odysseus inline tool-call kartı gösterir.
- Streaming yalnızca "ping" animasyonlu durum çubuğu (`:726-736`); token-token imleç yok (backend `stream:false`, chat-agents.md §1.4).
- Model-seçici üst barda düz dropdown; "hangi model çalıştı" bilgisi geçici `currentStepInfo`'da.
- Çok-ajan yok (tek ajan tek session); `MultiAgentPipeline` erişimi ayrı sekmede.

---

## 2. Claude Design PROMPT — TAM taslak (canvas'a yapıştırılacak)

> **Kullanım:** Bu blok `claude.ai/design` chat-prompt'una **verbatim** yapıştırılır. Şablon: `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`. Ön-koşul: **design-system-first** — token alt-kümesi (§2.5) prompt'a gömülür (K2: Claude Design ham hex üretir, token değişkeni değil → HANDOFF'ta remap).

### 2.1 [GOAL]
> Dark developer-cockpit için **AI agent chat paneli** tasarla. Bu bir ReAct (Reason→Act→Observe) agent döngüsünün canlı arayüzü: kullanıcı görev yazar, agent çok-adımlı düşünür, araç (tool) çağırır, sonucu gözlemler, cevap üretir. Panel **odysseus-kalitesinde** olmalı: mesaj akışı + inline tool-call görünürlüğü + reasoning-trace + streaming imleç + çok-ajan + model-seçici. Amaç görsel/UX yükseltme; state mantığı mevcut (mock veriyle tasarla).

### 2.2 [LAYOUT]
> **İki-bölge + üst bar** (üç-panel değil, boğmayan iki-panel — 03 §2/1):
> - **Üst kontrol barı** (tam genişlik): provider seçici (dropdown, `ollama-local` default seçili), model dropdown, `auto-apply` toggle (açık), `verify` toggle (kapalı). Sağda küçük "run özeti" alanı (step sayısı · tok/s · durum rozeti).
> - **Sol dar sütun** (~%22): oturum (session) listesi — her satır başlık + saat + model rozeti; üstte "New chat" butonu; aktif oturum vurgulu. Boş durumda "no sessions" honest-empty.
> - **Sağ geniş sütun** (~%78): dikey `mesaj akışı` (üstte, scroll) + altta sabit `prompt kutusu` (textarea + gönder butonu, "Enter gönderir, Shift+Enter satır" ipucu).
> - **Mesaj akışının sağında** (opsiyonel dar rail, geniş viewport'ta): "Tools" listesi (5 araç kartı) + write onay wizard'ı (koşullu).
> - **Çok-ajan:** mesaj akışının üstünde küçük sekme çubuğu — "Agent" (default, ReAct chat) | "Pipeline" (architect→coder→reviewer DAG görünümü). Pilot'ta Pipeline sekmesi sadece yer-tutucu.
> Responsive: `xl` altında Tools rail alta iner; `lg` altında sol session sütunu daralır/gizlenir (üstte session dropdown'a dönüşür).

### 2.3 [CONTENT] — mesaj akışı öğe tipleri (mock veriyle)
> Mesaj akışında **dört öğe tipi** ayırt edilebilir olmalı:
> 1. **user mesajı** — sağa yaslı balon, indigo dolgu, "U" avatar. Mock: `"refactor the auth middleware and run the tests"`.
> 2. **assistant mesajı** — sola yaslı balon, panel-yüzeyli, mono; markdown+kod-blok render (dil rozeti + kopyala). Mock: kısa açıklama + bir ```ts kod bloğu.
> 3. **tool-call kartı** (inline, akış içinde) — step#, tool adı (ikon), argüman özeti (tek satır truncate), latency `ms`, ok/fail rozeti; **tıklanınca açılır**: tam args (JSON pretty) + result + varsa diff. Mock: 2 kart — `read_file {path:"src/auth.ts"}` 42ms OK, `run_command {cmd:"npm test"}` 1840ms OK.
> 4. **reasoning-trace (thought)** — akış içinde soluk/italik "düşünce" satırı, tool-call'dan görsel olarak ayrı (örn. sol kenarda ince accent şerit). Mock: `"I'll read the middleware first, then run the test suite."`.
> **Streaming imleci:** en son assistant mesajının sonunda yanıp sönen imleç (`▋`) + üstte küçük "step 2 · running" göstergesi.

### 2.4 [CONTENT] — üst bar + onay wizard'ı (mock)
> - **Provider seçici:** ikonlu dropdown, seçili `🏠 Ollama (Local Engine)`. Model dropdown: `qwen3:8b` seçili.
> - **Toggle'lar:** `auto-apply` (yeşil, açık) — kapalıyken agent dosya yazmadan önce durur; `verify` (sarı, kapalı) — bağımsız model final cevabı denetler.
> - **Write onay wizard'ı** (sağ rail, koşullu): amber uyarı kartı — "Agent proposes writing `src/auth.ts`" + diff önizleme (`+`/`-` satırlar) + Approve (yeşil) / Reject (kırmızı) butonları. Mock: 6-satır diff.
> - **Run özeti** (bitişte): `3 steps · 48 tok/s · [Complete]` yeşil rozet (veya `[Truncated]` amber).

### 2.5 [BRAND] — ollamas token alt-kümesi (prompt'a göm; kaynak `src/styles/tokens.css`)
> ```
> Renkler (dark cockpit):
>   bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
>   border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim (soluk)
>   accent-indigo #6366f1 · ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
> Font: sans = Inter; mono = JetBrains Mono (kod, tool adı, latency, rozet mono).
> Radius: sm 3px · md 8px · lg 12px. Space: 4/8/12/16px.
> Başlık stili: font-mono, UPPERCASE, tracking-wider. Metin ölçeği: 9-12px mono.
> Hareket: fade-in 0.25s; prefers-reduced-motion saygılı (imleç yanıp-sönme kapanır).
> ```
> Not: `dark:` prefix KULLANMA — dark/light paritesi token katmanından. Light varyant için ayrıca bir ekran daha üret (aynı layout, açık tema).

### 2.6 [CONTEXT] — 4-STATE + responsive (aşağıda §3 detaylı)
> Dört durumu da ayrı ekran/frame olarak tasarla: (1) boş-konuşma (greeting), (2) streaming-yükleniyor (imleç + step göstergesi), (3) hata-retry, (4) dolu-konuşma. Ek: dark + light varyant; mobil (dar viewport) düzeni.

---

## 3. 4-STATE Mock Tanımları (her durum ayrı canvas frame)

> odysseus UI kalite kriteri (03 §2/2): **dört durumun da** tasarlanması — "honest empty state" zorunlu. Her frame ayrı export edilir; screenshot'ları handoff bundle'ına girer.

| # | Durum | Mock içerik | Görsel odak |
|---|---|---|---|
| **S1** | **Boş konuşma** (greeting) | Sadece bir assistant greeting balonu (`"ReAct agent ready. Describe a task…"`); boş prompt kutusu; sol session listesi boş ("No sessions yet"); trace/özet yok. | Honest-empty: davet edici, örnek görev ipucu (opsiyonel chip'ler). |
| **S2** | **Streaming / yükleniyor** | 1 user mesajı + akmakta olan assistant mesajı (imleç `▋`) + 1 tamamlanmış tool-call kartı (`read_file` OK) + 1 "running" tool-call (spinner) + üstte `step 2 · running`. | Canlı feedback: imleç, spinner, "running" step göstergesi, aria-live. |
| **S3** | **Hata / retry** | 1 user mesajı + kırmızı hata satırı (`"Agent runtime failed: model timeout"`) + "Retry" butonu; kısmi trace (1 fail rozetli tool-call). | Kurtarılabilir hata: net mesaj + tek-tık retry; fail rozeti kırmızı. |
| **S4** | **Dolu konuşma** | 3 mesajlı sohbet (user → thought → assistant+kod) + 2 tool-call kartı (biri açık: args+result+diff görünür) + run özeti `3 steps · 48 tok/s · Complete`; sol session listesinde 2 oturum (biri aktif). | Tam senaryo: inline tool-call, reasoning-trace, kod-blok, run özeti. |

**Ek varyantlar:** her state'in **dark + light** hali; ayrıca **S4'ün mobil** (dar) düzeni (session sütunu üstte dropdown, Tools rail gizli).

**Mock veri notu (minimum, brief §3.1'den):** en az 3-mesajlı sohbet + 2 trace step. Pilot'ta S4 bu minimumu karşılar; S2/S3 alt-küme sahneler.

---

## 4. İterasyon Adımları (Claude Design canvas'ta, 3-5 döngü)

> Mekanik: chat-prompt (ilk üretim) + inline-comment (nokta düzeltme) + slider (yoğunluk/varyant). Her döngü bir hedefe kilitlenir; canvas'ta ilerler.

1. **Döngü 1 — İskelet & layout.** İlk prompt (§2) yapıştır → iki-bölge + üst bar + mesaj akışı iskeleti üret. Kontrol: sol session sütunu, sağ akış+prompt kutusu, üst bar toggle'ları yerinde mi? Inline-comment ile bölge oranlarını (%22/%78) düzelt.
2. **Döngü 2 — Mesaj akışı öğe tipleri.** 4 öğe tipini (user/assistant/tool-call/thought) görsel olarak **ayırt edilebilir** kıl. Inline-comment: "tool-call kartı mesaj balonundan farklı görünmeli — daha teknik, mono, kenar rozeti". Kod-blok dil rozeti + kopyala butonu ekle.
3. **Döngü 3 — Streaming & tool-call açılır detay.** S2 frame'i: imleç + "running" spinner + step göstergesi. Tool-call kartına **tıkla-aç** etkileşimi (args/result/diff). Inline-comment: "açık kartta diff `+`/`-` renk kodlu (ok/err token)".
4. **Döngü 4 — 4-state + onay wizard'ı.** S1/S3/S4 frame'lerini üret; write onay wizard'ını (amber + diff + approve/reject) sağ rail'e yerleştir. Run özeti rozetini ekle. Honest-empty (S1) tonunu ayarla.
5. **Döngü 5 — Tema paritesi & responsive & cila.** Light varyant frame'i (aynı layout). Mobil (dar) düzeni: session dropdown + Tools rail gizle. Erişilebilirlik cilası (focus-visible, kontrast AA), hareket (fade-in), mono ölçek tutarlılığı. Son inline-comment turu.

> **Yoğunluk (slider) notu:** görsel yoğunluğu "orta-yoğun cockpit" seviyesinde tut — bilgi-yoğun ama boğmayan. Fazla dekorasyon (gradient, gölge şişkinliği) YASAK; ollamas estetiği düz-yüzey + ince kenar + mono.

---

## 5. Handoff Bundle İçeriği (export → `docs/odyssey/handoff/chat/`)

> Claude Design "Export" + "Handoff to Claude Code" bundle'ı buraya iner. 03 §3.1 + 04 §Adım-1'e göre **6 zorunlu dosya + panel-özel spec**:

```
docs/odyssey/handoff/chat/
  PROMPT.md            # §2'deki TAM Claude Design prompt'u (token'lar + mock + 4-state) — arşiv
  design.html          # Claude Design export (self-contained, inline CSS) — S4 (dolu) ana ekran
  screenshot.png       # canvas görüntüsü (dark, S4)
  screenshot-light.png # light varyant (S4)
  screenshot-s1.png    # boş (greeting) — opsiyonel ama pilot için ÖNERİLEN (4-state kanıtı)
  screenshot-s2.png    # streaming
  screenshot-s3.png    # hata/retry
  HANDOFF.md           # component adı, prop imzası, i18n anahtar listesi, /api sözleşmesi (mock→real map), 4-durum listesi
  tokens.snippet.css   # brief'e gömülen ollamas token alt-kümesi (kaynak: src/styles/tokens.css)
  TRACE_CARD.spec.md   # tool-call step kartı prop imzası (stepNum, tool, args, ok, latency, result, diff?, applied?, expanded?)
```

**HANDOFF.md'nin içermesi zorunlu (04 §Adım-1/3):**
- **Component adı:** `ReactAgentTab` (mevcut genişletilir — YENİ dosya değil) + opsiyonel alt-component `ToolCallCard.tsx`, `ReasoningTrace.tsx`.
- **Prop imzası:** `{ onNotify(msg, type) }` **değişmez** (§1.1). Alt-component prop'ları `TRACE_CARD.spec.md`'de.
- **i18n anahtar listesi:** mevcut `react-agent.*` anahtarları KORUNUR (greeting.welcome/back/initialized, trace.*, approval.*, summary.*, notify.* — `ReactAgentTab.tsx` boyunca); yeni görsel öğe metni varsa EN+TR eklenir. **`react-agent.greeting.welcome` korunur** (03 §3.1 TDD-4).
- **`/api` sözleşmesi (mock→real map):** tasarımın mock akışı → gerçek `POST /api/agent/chat` SSE frame'leri (`thought`→reasoning-trace, `message`→assistant balon, `step`→tool-call kartı, `paused`→onay wizard, `done`→run özeti, `error`→S3). Endpoint **değişmez** (chat-agents.md §9: tek dispatch yolu).
- **4-durum listesi:** S1-S4 (§3) → mevcut state'lere map (`messages.length` greeting, `isLoading` streaming, `onNotify(error)`+`runStatus` hata, dolu = normal).

---

## 6. Claude Code İmplementasyon Hedefi (handoff sonrası)

> Bu bölüm handoff bundle geldikten SONRA çalışır (04 §2 8-adım protokolü). Burada **hedef + TDD** özetlenir; tam protokol 04'te.

- **Genişletilecek dosya:** `src/components/ReactAgentTab.tsx` — **mevcut trace/session/stream state KORUNUR**, yalnızca görsel katman (JSX + Tailwind token utility). `src/components/AgentMessage.tsx` kod-blok görseli iyileştirilir (parseSegments sözleşmesi korunur).
- **Yeni alt-component (opsiyonel, reuse-first):** `ToolCallCard.tsx` (mevcut trace tablosu satırından çıkarılmış inline kart), `ReasoningTrace.tsx` (thought satırı). Yeni tip → `src/types.ts`'e `TraceStep` interface (zaten `ReactAgentTab.tsx:13-22`'de var, dışa taşınır).
- **Token remap (04 §Adım-3, en kritik):** bundle ham hex → `bg-immersive-*` / `text-status-*` utility. `dark:` prefix YASAK.

**TDD adımları (03 §3.1'den, test-önce):**
1. **RED:** `ReactAgentTab.test.tsx` — (a) greeting render (`react-agent.greeting.welcome`), (b) streaming step append **step-keyed** (yeni step append, aynı step overwrite — `:311-319` davranışı), (c) verify-toggle prop akışı, (d) tool-call kartı ok/fail rozeti + latency görünür.
2. **GREEN:** UI'yi handoff'a göre güncelle; a11y korunur (`role="log"` `aria-live="polite"`, `:681-685`).
3. **i18n:** `react-agent.*` EN+TR senkron; yeni anahtar varsa iki dilde.
4. **Kapı:** `tsc --noEmit` ✓ + `vitest run` fresh ✓ → commit (`feat(chat): odysseus-quality ReactAgentTab redesign`).

**Parity kabul (03 §3.1):** streaming imleç + step trace kartı + provider/model/verify barı + 4 durum + dark/light + ⌘Enter gönder. Hepsi görsel/mevcut-state ile karşılanır; token-delta (gerçek imleç) backend Eksen A'ya bağlı (kapsam-dışı, mock imleç yeterli).

---

## 7. PİLOT Notu — handoff şablonunu buradan ampirik düzelt

> **Bu panelin özel görevi:** `design-execution` altındaki İLK gerçek Claude Design export'u burada alınır. 03 §5 K1/K2 kör-noktaları (export formatı + token remap) **doğrulanmamış varsayım**. Bu pilot onları ampirik test eder ve şablonu kalibre eder.

**Export sonrası zorunlu kalibrasyon adımları:**
1. **Bundle şeması doğrula (K1):** Claude Design "Handoff to Claude Code" gerçekte hangi dosyaları verdi? (HTML tek dosya mı, component başına mı? Screenshot dahil mi? README/component-list formatı ne?) → §5'teki 6-dosya şablonunu gerçekle karşılaştır; sapma varsa **03 §3'ün ortak bundle şablonunu düzelt**.
2. **Token sadakati ölç (K2):** Export inline hex mi üretti, yoksa CSS değişkeni mi? ollamas `#0a0b10` → çıktıda ne göründü? → manuel remap yükünü ölç; ağırsa 04 §Adım-3'e "otomatik remap script" görevi ekle.
3. **HTML→React çeviri eforu:** design.html'i `ReactAgentTab`'a dikmek kaç saat/sapma? → 04 §2 8-adım protokolünün gerçekçiliğini doğrula.
4. **i18n boşluğu:** Claude Design İngilizce mock üretti; TR anahtar boşluğu (K9) gerçekte kaç anahtar? → HANDOFF.md i18n-checklist'inin yeterliliğini ölç.
5. **Şablon geri-yaz:** bulunan tüm sapmaları (1-4) hem **bu belgenin §5'ine** hem **03 §3 + 04 §Adım-1-3'e** yansıt. Diğer 7 panel (cookbook, documents, research, notes, calendar, email, settings) bu kalibre edilmiş şablonu devralır.

**PİLOT çıktısı:** kalibre edilmiş handoff şablonu + "gerçek Claude Design export şu şekilde çalışıyor" kanıt notu (03 K1/K2 kapanır).

---

## 8. Kabul Kriteri (bu yürütme planı için)

Bu belge **DONE** sayılır ancak:

- [x] Mevcut chat UI **koda karşı doğrulandı** (dosya:satır — `ReactAgentTab.tsx`, `AgentMessage.tsx`, `MultiAgentPipeline.tsx`). **(§1)**
- [x] Claude Design **TAM prompt taslağı** ([GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]) yazıldı — mesaj-akışı (user/assistant/tool-call/reasoning), streaming, model-seçici, çok-ajan sekmeleri, input+tool-toggle. **(§2)**
- [x] **4-STATE mock** tanımlı (boş / streaming / hata-retry / dolu) + dark/light + mobil varyant. **(§3)**
- [x] **İterasyon adımları** (3-5 döngü) canvas mekaniğiyle (prompt+inline-comment+slider). **(§4)**
- [x] **Handoff-bundle içeriği** listelendi (6 zorunlu dosya + `TRACE_CARD.spec.md`). **(§5)**
- [x] **PİLOT notu** — handoff şablonunu ampirik düzeltme protokolü (K1/K2/K9 kalibrasyonu). **(§7)**
- [x] **Kör-Nokta Ledger** ≥ 5 kayıt. **(§9)**

**Parity nihai testi (implementasyon sonrası, gelecekte):** panel S1-S4'ü render eder, dark/light çalışır, streaming imleç + inline tool-call kartı + reasoning-trace görünür, ⌘Enter gönderir, mevcut `POST /api/agent/chat` SSE'ye gerçek bağlı → chat paneli = odysseus-kalitesinde.

---

## 9. Kör-Nokta Ledger (PİLOT-spesifik)

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **C1** | **VARSAYIM** | Claude Design export formatı (HTML+screenshot+README+component-list bundle) 03 K1'de tarif edildiği gibi; gerçek "Handoff to Claude Code" çıktısı **hiç görülmedi** (bu ilk pilot). | §5 bundle şablonu yanlış olabilir | §7 kalibrasyon adım-1: gerçek export'u §5 ile karşılaştır, sap → şablonu düzelt |
| **C2** | **BİLİNMEYEN** | Claude Design mesaj-akışında **inline tool-call kartı** + **reasoning-trace şeridi** gibi cockpit-spesifik öğeleri prompt'tan ne kadar sadık üretir (chat UI'ları genelde düz balon). | Tool-call görselliği zayıf çıkabilir → iterasyon-2/3 uzar | §4 döngü-2/3 inline-comment ile zorla; çıkmıyorsa design.html'i Claude Code'da elle güçlendir (04 reuse: mevcut trace tablosu `:891-995` referans) |
| **C3** | **RİSK** | **Streaming imleci mock'ta statik** (Claude Design canlı SSE yapamaz — 03 §0). Gerçek token-token imleç backend Eksen A'ya bağlı (`chat-agents.md` §3 Eksen A, kapsam-DIŞI). | Tasarım "streaming" gösterir ama implement'te mevcut adım-bazlı `message` frame'i var; imleç sahte kalabilir | Mock imleç = görsel niyet; HANDOFF.md mock→real map'te "token frame Eksen A bekliyor, o zamana kadar step-bazlı" notu; S2 imleci `▋` CSS-blink |
| **C4** | **KARAR** | **Çok-ajan sekmesi** ("Pipeline") — mevcut `MultiAgentPipeline` chat paneline mi gömülecek yoksa ayrı mı kalacak? Pilot'ta yer-tutucu (§1.3). | Tasarım sekme gösterir ama içerik mevcut ayrı component; entegrasyon eforu belirsiz | Pilot: Pipeline sekmesi = tab shell + mevcut `MultiAgentPipeline` mount; backend Eksen D (`spawn_subagent`) gelince inline alt-ajan kartına evrilir (ayrı iş) |
| **C5** | **VARSAYIM** | Redesign `ReactAgentTab`'ın **prop imzasını (`onNotify`) ve state makinesini bozmadan** yalnız görsel katmanı değiştirebilir. Ama inline tool-call kartı, trace tablosunu (`:891-995`) mesaj akışına taşımayı gerektirir → state yeniden-yapılanması olabilir. | "Sadece görsel katman" iddiası kısmen yanlış çıkabilir | TDD-önce (§6/1) mevcut davranışı (step-keyed append, upsert) snapshot'la; taşıma **davranış-koruyucu refactor** olarak, ayrı commit (chat-agents.md R3 deseni) |
| **C6** | **BİLİNMEYEN** | i18n: yeni görsel öğeler (dil rozeti, "running" göstergesi, reasoning-trace başlığı) yeni `react-agent.*` anahtar gerektirir; Claude Design İngilizce üretir, TR boşluğu pilot bitene kadar bilinmez (03 K9). | Eksik TR anahtar = runtime `_()` id-string döner | HANDOFF.md i18n-checklist; yeni anahtarlar EN+TR **implement adımında** (§6/3), export'ta değil |
