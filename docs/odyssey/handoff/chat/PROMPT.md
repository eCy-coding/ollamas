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
