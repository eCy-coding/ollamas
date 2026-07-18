# HANDOFF — chat (PİLOT) · ÇEVİRİ SÖZLEŞMESİ [İSKELET — Claude Design export bekliyor]

> DURUM: **BEKLEMEDE** — `design.html` + `screenshot*.png` Claude Design "Handoff to Claude Code"
> export'undan gelecek (Emre, claude.ai/design). Bu iskelet 6 zorunlu alanın ön-doldurulmuş hâlidir
> (HANDOFF-PIPELINE §1.1); export inince mock→real map tamamlanır. Screenshot'tan el-yazımı YASAK.

## 1. Component adı
`ReactAgentTab` (GENİŞLET — sıfırdan değil; ~999 satır mevcut state makinesi KORUNUR).
Muhtemel alt-component'ler: `ToolCallCard`, `ReasoningTrace` (export'a göre kesinleşir).

## 2. Prop imzası
Ana: `{ onNotify(msg: string, type: string) }` (ReactAgentTab.tsx:33-35 — DEĞİŞMEZ).
Alt-component prop'ları: export sonrası `<PANEL>.spec.md`'ye.

## 3. i18n anahtar listesi
`app.tab.react-agent` + mevcut `react.*` anahtarları korunur; yeni anahtarlar EN mock'tan
çıkarılıp `src/locales/{en,tr}.ts`'e EŞİT sayıda eklenir. [export sonrası liste]

## 4. /api sözleşmesi (mock→real map)
Yeni endpoint YOK (panels/chat.md §0 kapsam-dışı kuralı). Mevcut bağlar:
- model listesi → `api.get('/api/models/'+prov)` · per-model ayar → `api.get/put('/api/model-overrides')`
- chat dispatch → mevcut `/api/agent/*` akışı (adım-bazlı `message` frame'i korunur; token-delta = O-backend)
[export'taki her mock array → bu tabloya satır]

## 5. 4-durum listesi
S1 boş/greeting · S2 streaming(mock imleç) · S3 hata/retry · S4 dolu — mevcut state map:
`loading` / `messages.length===0` / `error` / default. [export screenshot'ları: s1..s4]

## 6. Kör-nokta notu
H5 (backend-yok mock'un canlı-SSE'ye dikişi) · K6 (güvenlik: yeni route açılmaz, guard yüzeyi değişmez) ·
K2 (ham hex → token remap, tokens.snippet.css) · a11y: WCAG AA kontrast (V9 f93705a dersleri — purple-300/rose kontrast tuzakları).
