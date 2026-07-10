# Chat / Agents — ODYSSEY Feature Plan

> ODYSSEY / 05-features / chat-agents
> Hedef: odysseus `chat/agents` modülü paritesini (agent_loop.py 261KB çok-adımlı reasoning + chat_processor streaming + tool_execution 43KB dinamik schema + tool_policy/security) ollamas'ın **mevcut ReAct döngüsü + ToolRegistry choke-point** mimarisi üzerine, ikinci bir dispatch yolu **açmadan** genişletmek.
> Dil: TR (anlatı) · kod/komut/dosya-yolu/id: EN.

---

## 0. Yönetici Özeti (TL;DR)

- **ollamas'ta çalışan bir agent döngüsü ZATEN VAR** ve odysseus'un iskeletini karşılıyor: `server.ts:1399` `POST /api/agent/chat` gerçek bir ReAct (Reason→Act→Observe) döngüsüdür — `while (stepNum <= maxSteps)` (`server.ts:1477`), her adımda `ProviderRouter.generate({ tools: AGENT_TOOLS })`, `tool_calls` çözümlemesi, `ToolRegistry.execute()` çağrısı, `tool` rolüyle geri besleme (`server.ts:1510-1593`) ve SSE ile canlı stream (`sendEvent`, `server.ts:1429`). odysseus'un `agent_loop.py` + `chat_processor` + `tool_execution` üçlüsünün **karşılığı burada tek dosyada ve tek choke-point'te** toplanmış.
- **Tool-schema registry VAR ve çok-backend'e normalize:** `server/tool-registry.ts` tek choke-point (`ToolRegistry.schemas()` OpenAI function-calling şeması döner, `:833`); `ProviderRouter` bunu ollama-local/ollama-cloud/gemini/anthropic/openai formatlarına çevirir (`server/providers.ts:1199,1375,827,957`). odysseus'un `tool_execution.py` dinamik-schema katmanının paritesi mevcut — **eksik olan dinamik/runtime tool ekleme UX'i ve policy zenginliği**, çekirdek değil.
- **tool-policy/security VAR:** tier modeli (`safe|host|privileged|host_upstream`, `tool-registry.ts:43`), per-tenant allowlist + OAuth scope gate + owner map (`tool-registry.ts:900-910`), PRE/POST interceptors (`tool-interceptors.ts`), write_file için insan-onaylı `halt` akışı (`server.ts:1560,1595` + `POST /api/agent/approve-write:1669`). odysseus `tool_policy` paritesi büyük ölçüde karşılanıyor.
- **odysseus'un ÖNE GEÇTİĞİ yerler (gerçek boşluklar):** (1) **token-delta streaming yok** — ollamas her adımda `stream:false` çeker ve tüm adım metnini tek `message` frame'i olarak yollar (`server.ts:1486,1499`); odysseus `chat_processor` token-token stream'ler. (2) **Multi-agent alt-görev delegasyonu döngü içinde yok** — tek ajan tek session; `MultiAgentPipeline` (architect→coder→reviewer) ayrı bir sabit-boru hattıdır, ReAct döngüsünün spawn edebildiği bir alt-ajan değil. (3) **tool-policy statik** — plan-bazlı tier allowlist var ama **kural motoru** (per-tool rate/argüman/pattern reddi, onay eşiği) yok. (4) **Dinamik tool registry runtime'da genişletilemiyor** ReAct'tan — `register()` var ama sadece upstream MCP supervisor'dan (`mcp/supervisor.ts`); ajan kendi çalışırken tool ekleyemez. (5) **Session-typed reasoning kaydı zayıf** — `messages[]`'a düz kayıt (`agent-events.ts` başlık notu); thought/action/observation ayrı tipli değil, replay `messages` index'i üzerinden yapılıyor.
- **Plan:** Yeni dispatch yolu YOK. Mevcut `POST /api/agent/chat` döngüsünü **beş cerrahi eksende** genişlet — (A) token-delta SSE streaming, (B) tipli reasoning-trace persisti, (C) kural-tabanlı `ToolPolicy` katmanı (interceptor'ların üstünde), (D) ReAct-içi `spawn_subagent` tool'u (multi-agent'ı döngüye taşır), (E) runtime tool-registry introspeksiyon/genişletme tool'ları. Her eksen TDD ile (test-önce → RED → implement → GREEN → commit).

---

## 1. Mevcut Durum — Kanıt Tabanlı (ollamas)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **Read/Grep ile doğrulanmıştır** (2026-07-10).

### 1.1 ReAct döngüsü — NE VAR (çekirdek)
| Kanıt | Dosya:Satır | Anlamı |
|---|---|---|
| **ReAct döngü gövdesi** — `while (stepNum <= maxSteps && !shouldHalt)` | `server.ts:1477` | Çok-adımlı reasoning: `maxSteps` default 8 (`:1400`), her adım thought→action→observation |
| **Model çağrısı + tool şeması** — `ProviderRouter.generate({ provider, model, messages: activeHistory, tools: AGENT_TOOLS, stream:false })` | `server.ts:1481-1488` | Tek adım = tek LLM turu; tool'lar registry'den (`AGENT_TOOLS = ToolRegistry.schemas()`, `:1442`) |
| **tool_calls çözümleme + yürütme** — `for (const tc of result.toolCalls) { ... ToolRegistry.execute(toolName, args, ctx) }` | `server.ts:1516-1593` | Odysseus `tool_execution` paritesi: arg-onarım (`repairJson`, `:1524`), tier metering, `tool` rolüyle observation geri-besleme (`:1587`) |
| **Malformed-arg onarımı** — `repairBudget = 2` + `getToolArgError` + retry mesajı | `server.ts:1475,1527-1536` | Try-Rewrite-Retry: bozuk JSON args boş `{}` ile ÇALIŞTIRILMAZ, modele hata geri döner |
| **write_file onay akışı** — `if (r.halt) shouldHalt = true` → `sendEvent("paused")` | `server.ts:1560,1595-1597` | `autoApply=false` iken döngü durur, insan onayı bekler (`POST /api/agent/approve-write`, `:1669`) |
| **Opt-in verifier gate** — `if (verify && _combo.verifier?.model) { ... VERDICT: PASS/FAIL }` | `server.ts:1619-1635` | implementer≠verifier: bağımsız model final cevabı denetler (additive, best-effort) |
| **Combination model seçimi** — `loadAgentCombination()` → `MODEL_SELECTION.json` champions.combination | `server.ts:1391-1397` | implementer=`qwen3-coder:480b-cloud`, verifier=`qwen3:8b` (`orchestration/MODEL_SELECTION.json:33-39`) |
| **SSE frame'leri** — `sendEvent(type, payload)` → `data: {type, ...}` | `server.ts:1429-1431` | `model/thought/message/step/repair/paused/verify/done/error` frame tipleri |
| **Session persisti** — `sess.messages = activeHistory.map(...)` + `db.save()` | `server.ts:1637-1655` | Session-based (odysseus paritesi); title ilk user mesajından türetilir |
| **Sır sızıntı koruması** — `redactDeep(result.toolCalls)` frame'e çıkmadan | `server.ts:1514` | tool_call args'taki secret-şekilli substring'ler client'a gitmeden maskelenir |
| **Seyir defteri kaydı** — `logSeyir({ kind:"agent_step", tool, args, ok, latencyMs, summary })` | `server.ts:1576-1585` | Her adım audit trail'e yazılır (args 200 char, summary 160 char kesik) |

### 1.2 Tool registry + policy — NE VAR
| Yetenek | Dosya:Satır | Anlamı |
|---|---|---|
| **Tek choke-point** — `ToolRegistry.execute()` | `tool-registry.ts:882` | Her tool tek yerden; normalize `{ok, output, diff, applied, halt}`, asla throw etmez |
| **OpenAI-format şema üretimi** | `tool-registry.ts:833` `schemas()` | ReAct `tools:` param'ı + MCP `inputSchema` aynı kaynaktan |
| **Tier modeli** — `type ToolTier = "safe"\|"host"\|"privileged"\|"host_upstream"` | `tool-registry.ts:43` | Güvenlik sınıflandırması |
| **Per-tenant allowlist + owner gate** — `allowedTiers`, `OWNERS` map | `tool-registry.ts:846,900-904` | deny-by-default cross-tenant reddi |
| **OAuth scope gate** — `tools:<tier>` scope zorunlu | `tool-registry.ts:907-910` | Scoped key/JWT için |
| **PRE/POST interceptors** — `runPre(name,args,ctx,tier)` / `runPost` | `tool-registry.ts:11,919` + `tool-interceptors.ts` | Cache-hit short-circuit, post-processing |
| **outputSchema doğrulama** — ajv, sadece structured output | `tool-registry.ts:26-35,944` | Untrusted upstream output DoS-hardened (`allErrors:false`) |
| **Dinamik tool kaydı** — `register(name, def, owner?)` / `unregisterByPrefix()` | `tool-registry.ts:852,858` | Upstream MCP tool'ları choke-point'e girer (`mcp/supervisor.ts:111,161`) |
| **Multi-backend tool_calls** — ollama-local/cloud, gemini, anthropic, openai | `providers.ts:827,957,1199,1375` | Her backend'e şema map + `tool_calls`→`ToolCall` normalize (`providers.ts:874,1041,1244`) |

### 1.3 Frontend + orkestrasyon — NE VAR
| Yetenek | Dosya:Satır | Anlamı |
|---|---|---|
| **ReAct chat UI** — SSE tüketici, trace-step render, onay UI | `src/components/ReactAgentTab.tsx:284,307-386` | `thought/message/step/paused/model/repair/verify/done/error` frame'lerini işler; `autoApply` toggle (`:57`), write onay diyaloğu (`:449 approveWrite`) |
| **Adım mesajı bileşeni** | `src/components/AgentMessage.tsx` | Per-step assistant metni + tool trace |
| **Multi-agent boru hattı** — architect→coder→reviewer (+self-improve) | `src/components/MultiAgentPipeline.tsx:20,38-46` | **Sabit 3-rol pipeline** (`/api/pipeline`), her rol ayrı model; ReAct döngüsünden BAĞIMSIZ |
| **CLI conductor daemon** — `orchestra.ts` (FSM, $0-local) | `orchestration/bin/orchestra.ts:1-40` | OBSERVE→ACT FSM; ollama-only self-healing; ReAct `/api/agent/chat` ile AYRI süreç |
| **Zero-touch conductor** — `conduct.ts` (read-only sinyal→tek-eylem) | `orchestration/bin/conduct.ts:1-10` | Deterministik öncelik motoru; CONDUCTOR.md üretir; lane'i act ETMEZ |
| **MCP expose/consume** — `server/mcp/{server,client,supervisor,catalog}.ts` | `mcp/server.ts:95,152` | Registry tool'ları `/mcp` üzerinde otomatik expose; upstream tool'ları consume |
| **SSE live-tail helper'ları** — pure, I/O-free | `server/agent-events.ts:32-98` | `sessionEventsSince/isSessionDone/formatSseEvent`; `GET /api/agent/sessions/:id/events` replay (`server.ts:1727`) |

### 1.4 NE YOK / NE ZAYIF (odysseus'un öne geçtiği eksenler)
- **Token-delta streaming yok.** ReAct döngüsü her adımda `stream:false` (`server.ts:1486`) → adım metni tamamlandığında tek `message` frame'i (`:1499`). odysseus `chat_processor` token-token akıtır. (`generateTextStream` `ai.ts:126`'da VAR ama ReAct döngüsü onu KULLANMIYOR — sadece tek-prompt `/api/generate` yolunda.)
- **ReAct-içi alt-ajan spawn YOK.** Tek session = tek ajan. Multi-agent yalnızca `MultiAgentPipeline` sabit boru hattında (architect/coder/reviewer) — ReAct döngüsünün bir tool ile `spawn_subagent("review this diff")` çağırıp sonucu observation olarak alma yeteneği yok. odysseus `agent_loop` iç-içe ajan delegasyonu yapabiliyor.
- **Kural-tabanlı ToolPolicy YOK.** Var olan gate'ler statik (tier allowlist, scope, owner). Per-tool **rate limit**, **argüman-pattern reddi** (örn. `run_command` içinde `rm -rf /`), **onay-eşiği** (tehlikeli arg → otomatik `halt`) yok. `tool-interceptors.ts` PRE hook'u bunun doğal yeri ama bir policy motoru değil.
- **Tipli reasoning-trace persisti zayıf.** `agent-events.ts` başlık notu: session'lar `messages[]`'a düz kayıt tutar, `steps[]`/`status`/`done` alanı YOK; thought/action/observation ayrı tipli değil — replay `messages` index'i üzerinden quiescence ile sezilir (`isSessionDone`, `:56`). odysseus tipli step kaydı tutar.
- **Runtime tool introspeksiyon/genişletme ReAct'tan yok.** Ajan çalışırken hangi tool'ların mevcut olduğunu (tier/schema) sorgulayamaz veya geçici tool tanımlayamaz; `register()` sadece MCP supervisor'dan çağrılır.
- **Yorgun-döngü/bütçe kontrolü zayıf.** Sadece `maxSteps` (adım) ve `repairBudget` (arg) var; **token bütçesi**, **wall-clock timeout**, **tekrar-eden-tool döngü tespiti** (aynı args ile aynı tool N kez → dur) yok.

---

## 2. odysseus Referansı (Parite Kaynağı)

odysseus `chat/agents` modülü:

| odysseus bileşeni | Davranış | ollamas karşılığı (mevcut / hedef) |
|---|---|---|
| **`agent_loop.py`** (261KB) | Çok-adımlı reasoning + tool invocation döngüsü; alt-görev delegasyonu | `server.ts:1477` ReAct döngüsü **VAR**; alt-ajan spawn **HEDEF** (Eksen D) |
| **`chat_processor`** | Streaming — token-token akıtma, incremental render | `server.ts` adım-bazlı `message` frame'i (delta yok); **HEDEF** token-delta (Eksen A) |
| **`tool_execution.py`** (43KB) | Dinamik schema, tool dispatch, sonuç normalize | `ToolRegistry.execute()` + `schemas()` **VAR**; runtime genişletme **HEDEF** (Eksen E) |
| **`tool_policy` / security** | Kural motoru: hangi tool ne zaman, argüman denetimi, onay | tier/scope/owner gate'leri **VAR**; kural motoru **HEDEF** (Eksen C) |
| **Çok-backend** (Ollama/cloud) | Backend-agnostik model çağrısı | `ProviderRouter` ollama/gemini/anthropic/openai **VAR** (parite) |
| **WebSocket streaming, session-based** | Canlı iki-yönlü, oturum başına durum | SSE (tek-yön) + session persisti **VAR**; WS opsiyonel değerlendirilir (Kör-Nokta R5) |

> **Sonuç:** ollamas'ın ReAct döngüsü odysseus `agent_loop`'un **çekirdek fonksiyonelliğine sahip** ve tek choke-point sayesinde güvenlik/metering/audit'i bedavaya veriyor. Parite boşluğu **kalite eksenlerinde** (streaming granülaritesi, alt-ajan, policy zenginliği, tipli trace) — mimari yeniden yazım gerektirmez, mevcut döngü **genişletilir**.

---

## 3. Hedef Plan — TDD Adımlı (test-önce → RED → implement → GREEN → commit)

> Genel kural: her eksen için ÖNCE test dosyası (`server/__tests__/agent-*.test.ts` veya `agent-events` pattern'i), koştur → **RED**, sonra implement → **GREEN**, kalite kapısı (`npm run lint` = `tsc --noEmit` ✓ + `npm test` fresh ✓), sonra `git_commit` (conventional). Choke-point'i (`ToolRegistry.execute`) ve tek-dispatch-yolu kuralını ASLA bozma.

### Eksen A — Token-delta streaming (odysseus `chat_processor` paritesi)
- **A0 (test-önce):** `agent-stream.test.ts` — pure helper: `formatSseToken(delta)` → `data:{type:"token",delta,step}` frame üret; sıralı delta'lar birleşince tam adım metnini vermeli. → RED.
- **A1 (implement):** `server/agent-events.ts`'e `formatSseToken` + `formatSseTokenDone` ekle (pure, I/O-free — mevcut `formatSseEvent` komşuluğu). → GREEN.
- **A2 (test-önce):** ReAct döngüsü stream=true iken her chunk'ı `token` frame'i olarak yollamalı, adım sonunda tek `message` frame'i (geriye-uyum). Contract test `server.ts` handler'ı mock ProviderRouter ile. → RED.
- **A3 (implement):** `server.ts:1481` `generate()` çağrısını `stream:true` + chunk callback'e çevir (mevcut `ProviderRouter.generate(config, onChunk)` imzası zaten VAR — `ai.ts:146` bunu kullanıyor); callback `sendEvent("token", {delta, step:stepNum})`. Adım sonunda mevcut `message` frame'i korunur. **DİKKAT:** `tool_calls` yalnızca stream sonunda toplanır (`providers.ts:1000-1049` ollama stream tool_calls accumulation'ı VAR) — token stream ederken tool_call'ları kaybetme. → GREEN.
- **A4 (frontend):** `ReactAgentTab.tsx:307` switch'e `case "token"` ekle — incremental append (mevcut `message` case'i step-keyed append yapıyor, `:310`). Geriye-uyum: `token` gelmezse `message` yolu çalışır. → GREEN.
- **Commit:** `feat(agent): token-delta SSE streaming in ReAct loop`

### Eksen B — Tipli reasoning-trace persisti
- **B0 (test-önce):** `agent-trace.test.ts` — pure: `buildTraceStep({kind:"thought"|"action"|"observation", ...})` → tipli kayıt; `reconstructTrace(session)` düz `messages[]`'ı tipli trace'e çevirir (geriye-uyum: eski session'lar da parse olmalı). → RED.
- **B1 (implement):** `agent-events.ts`'e tipli `TraceStep` union + builder. `ChatSession` (`db.ts:42`) opsiyonel `trace?: TraceStep[]` alanı (additive, migration'sız — yoksa `messages[]`'tan türet). → GREEN.
- **B2 (implement):** `server.ts:1637` session persistinde `messages[]` yanında `trace[]` de yaz (thought=`sendEvent("thought")`, action=tool call, observation=tool result). `isSessionDone` heuristiği korunur. → GREEN.
- **Commit:** `feat(agent): typed thought/action/observation trace persistence`

### Eksen C — Kural-tabanlı ToolPolicy motoru
- **C0 (test-önce):** `tool-policy.test.ts` — pure `evaluatePolicy(toolName, args, tier, rules)` → `{decision:"allow"|"deny"|"halt", reason?}`. Kurallar: per-tool rate (N/dk), argüman-regex reddi (örn `run_command` args `\brm\s+-rf\s+/`), tehlikeli-arg → `halt` (insan onayı). → RED.
- **C1 (implement):** `server/tool-policy.ts` (yeni, pure) — kural şeması + evaluator. Kurallar `~/.ollamas/tool-policy.json`'dan (yoksa güvenli varsayılan: deny yok, sadece bilinen tehlike pattern'leri halt). → GREEN.
- **C2 (implement):** `tool-interceptors.ts` `runPre`'ye policy çağrısı bağla — **choke-point'in ÜSTÜNE değil, PRE hook içine** (ikinci dispatch yolu YOK). `deny`→ok:false, `halt`→`{halt:true}` (mevcut write_file halt akışını yeniden kullan). → GREEN.
- **C3 (test):** ReAct döngüsü `run_command('rm -rf /')` denerse → `halt` frame'i, döngü durur, onay bekler. → GREEN.
- **Commit:** `feat(agent): rule-based ToolPolicy (rate/pattern/approval-threshold)`

### Eksen D — ReAct-içi alt-ajan spawn (multi-agent'ı döngüye taşı)
- **D0 (test-önce):** `agent-subagent.test.ts` — `spawn_subagent` tool'u registry'de kayıtlı, tier `safe`, schema `{task, role?, maxSteps?}`. İç-döngü mock'lanarak: alt-ajan çalışır, sonucu string observation döner, **derinlik sınırı** (maxDepth=2) aşılırsa reddeder. → RED.
- **D1 (implement):** `tool-registry.ts`'e `spawn_subagent` tool'u ekle — invoke, mevcut ReAct çekirdeğini **fonksiyon olarak** çağırır (döngüyü `runReactLoop(messages, opts)` şeklinde `server.ts`'ten çıkarıp saf-çekirdek yap; handler onu sarar). `MultiAgentPipeline` rolleri (`MODEL_SELECTION.json` roles.architect/reviewer) alt-ajan `role` param'ıyla erişilebilir. **Sonsuz-özyineleme koruması:** `ctx.depth` + `maxDepth`. → GREEN.
- **D2 (test):** Ana ajan `spawn_subagent({task:"review", role:"reviewer"})` → alt-ajan verifier modeliyle koşar, verdict observation olarak ana döngüye döner. → GREEN.
- **Commit:** `feat(agent): in-loop spawn_subagent tool with depth guard`

### Eksen E — Runtime tool introspeksiyon
- **E0 (test-önce):** `agent-introspect.test.ts` — `list_tools` tool'u (tier `safe`) mevcut tool adları+tier+kısa-schema döner (registry'den, `ToolRegistry.list()` sarmalı). → RED.
- **E1 (implement):** `tool-registry.ts`'e `list_tools` tool'u — `list(tiers?)` çıktısını ajan-okunur özet yapar (owner/tenant filtresi korunur). Ajan "hangi araçlar var?" diye sorabilir → daha az halüsinasyon-tool çağrısı. → GREEN.
- **Commit:** `feat(agent): list_tools introspection tool for the ReAct loop`

### Eksen F — Döngü bütçe/güvenlik sertleştirme (küçük, yüksek-değer)
- **F0 (test-önce):** `agent-budget.test.ts` — `isLoopStuck(history)` aynı tool+aynı args ardışık 3× → true; `isTokenBudgetExceeded(usedTokens, budget)` → true. → RED.
- **F1 (implement):** `server.ts` döngüsüne wall-clock timeout (mevcut `ac.signal` altyapısını kullan) + tekrar-tool tespiti + opsiyonel token bütçesi (`req.body.tokenBudget`). Aşımda `done` frame `status:"budget"|"stuck"|"timeout"`. → GREEN.
- **Commit:** `feat(agent): loop budget guards (token/wall-clock/repeat-tool)`

> **Sıralama (bağımlılık):** A ve B bağımsız (paralel). C, mevcut interceptor'a dokunur — B'den sonra (trace policy kararını da kaydeder). D, çekirdeği fonksiyona çıkarmayı gerektirir — en riskli, C'den sonra. E ve F küçük, herhangi bir sırada. **Önerilen:** A → B → E → F → C → D.

---

## 4. Kör-Nokta Ledger (Bilinmeyen / Varsayım / Risk)

| # | Tür | İçerik | Azaltma |
|---|---|---|---|
| **A1** | Varsayım | odysseus `agent_loop.py` "261KB / çok-adımlı reasoning" ve `tool_execution.py` "43KB / dinamik schema" tanımı **prompt'tan**; kaynak repo (`github.com/pewdiepie-archdaemon/odysseus`) bu oturumda **okunmadı** (WebFetch çağrılmadı). Parite tablosu prompt'un özetine dayanır. | Kodlama-öncesi odysseus dosyalarını gerçek-oku; parite kriterlerini (§6) dosya-satır kanıtına bağla. Şu an: **davranışsal parite** hedefi, satır-satır değil. |
| **R1** | Risk | **Token stream + tool_calls yarışı** — ollama stream'de tool_calls yalnızca sonda toplanır (`providers.ts:1000-1049`); gemini/anthropic stream tool-call semantiği farklı. Token frame'i ederken tool_call kaybı olabilir. | Eksen A3'te: tool_calls olan adımda token stream ETME ya da adım-sonu accumulation'ı doğrula; contract test her backend için. |
| **R2** | Risk | **Alt-ajan özyineleme/maliyet patlaması** (Eksen D) — cloud implementer (`qwen3-coder:480b-cloud`) alt-ajanla N× çağrı → maliyet/latency. | `maxDepth=2` + alt-ajan default $0-local (`qwen3:8b`); cloud alt-ajan opt-in. Token bütçesi (Eksen F) alt-ajanı da kapsar. |
| **R3** | Risk | **Çekirdek çıkarımı regresyonu** (D1) — ReAct döngüsünü `server.ts`'ten saf `runReactLoop`'a taşımak mevcut SSE/session/abort/verify davranışını bozabilir. | Çıkarımı **davranış-koruyucu refactor** olarak yap; mevcut `/api/agent/chat` e2e (`ReactAgentTab` akışı) snapshot testiyle önce-sonra karşılaştır. Ayrı commit. |
| **R4** | Bilinmeyen | **ToolPolicy kural şeması** son hali (Eksen C) — rate window, regex allowlist/denylist formatı belirsiz. Fazla katı → ajan çalışmaz; fazla gevşek → değersiz. | C1'de minimal güvenli varsayılan (yalnız bilinen tehlike pattern'leri `halt`, deny YOK); kurallar `~/.ollamas/tool-policy.json` opt-in genişler. |
| **R5** | Karar | **SSE vs WebSocket** — odysseus WS kullanıyor; ollamas SSE + session-poll (`agent-events.ts`). WS geçişi tek-yön→iki-yön kazandırır ama tüm frontend/handler'ı etkiler. | **Karar: SSE'de kal.** İki-yön ihtiyacı (client→server mid-loop input) yoksa WS gereksiz karmaşa. `onElicit` (MCP elicitation, `tool-registry.ts:82`) zaten server→client soru yolu sağlıyor. Yeniden değerlendir: mid-loop kullanıcı müdahalesi gerekirse. |
| **R6** | Risk | **Geriye-uyum** — `trace[]`/`token` frame/`spawn_subagent` eski session ve eski frontend'i bozmamalı. | Hepsi **additive**: yeni alan/frame yoksa eski yol çalışır (B1 migration'sız opsiyonel alan; A4 `token` yoksa `message` fallback). |
| **A2** | Varsayım | `MODEL_SELECTION.json` champions.combination her ortamda var sayılıyor; yoksa `loadAgentCombination()` `{}` döner (graceful, `server.ts:1396`). | Kanıtlı graceful-absent — ek azaltma gerekmez. Alt-ajan role çözümü de aynı fallback'i kullanmalı. |
| **R7** | Risk | **`stream:false` metering'e bağımlı** — `result.tokens` billing için kullanılıyor (`server.ts:1492`); stream'de token sayımı farklı gelebilir. | A3'te stream sonu `tokens` alanını doğrula (ollama stream `eval_count` verir); metering regresyon testi. |

---

## 5. odysseus-Parity Kabul Kriteri

Aşağıdakilerin **hepsi** sağlandığında chat/agents modülü odysseus-parity kabul edilir:

1. **Çok-adımlı reasoning (VAR, korunur):** `POST /api/agent/chat` `maxSteps`'e kadar thought→action→observation döngüsü koşar, tool sonuçlarını `tool` rolüyle geri besler. *Kanıt: `server.ts:1477-1609` + geçen contract test.*
2. **Streaming (Eksen A):** Yanıt token-token akar (`token` frame'leri); adım-sonu `message` frame'i geriye-uyum için korunur; frontend incremental render eder. *Kabul: `agent-stream.test.ts` GREEN + `ReactAgentTab` `case "token"`.*
3. **Tool-schema registry (VAR + Eksen E):** Tek choke-point'ten OpenAI-format şema; her backend'e (ollama/gemini/anthropic/openai) doğru map; ajan `list_tools` ile runtime introspeksiyon yapabilir. *Kanıt: `tool-registry.ts:833` + `providers.ts` map'ler + `agent-introspect.test.ts`.*
4. **Tool-execution normalize (VAR):** Her tool `{ok,output,diff,applied,halt}` döner, choke-point asla throw etmez, malformed-arg onarımı bütçeli. *Kanıt: `tool-registry.ts:882-955` + `server.ts:1527-1536`.*
5. **Tool-policy (Eksen C):** Kural-tabanlı `allow/deny/halt` motoru PRE-interceptor içinde; tehlikeli args (örn `rm -rf /`) döngüyü `halt` eder; tier/scope/owner gate'leri korunur. *Kabul: `tool-policy.test.ts` GREEN + choke-point'te tek dispatch.*
6. **Multi-agent delegasyon (Eksen D):** ReAct döngüsü `spawn_subagent` ile alt-ajan çağırır, sonucu observation olarak alır, `maxDepth` ile korunur; mevcut `MultiAgentPipeline` bozulmaz. *Kabul: `agent-subagent.test.ts` GREEN.*
7. **Session-based (VAR + Eksen B):** Session persisti + tipli `trace[]`; live-tail SSE replay (`?after=`); implementer≠verifier gate opt-in çalışır. *Kanıt: `server.ts:1637-1655,1727` + `agent-trace.test.ts`.*
8. **Güvenlik/bütçe (VAR + Eksen F):** Sır redaksiyonu (`redactDeep`), abort-on-disconnect, wall-clock/token/repeat-tool bütçe koruması; $0-local varsayılan (`qwen3:8b`), cloud opt-in. *Kanıt: `server.ts:1514,1427` + `agent-budget.test.ts`.*
9. **Tek dispatch yolu (değişmez):** Tüm tool trafiği `ToolRegistry.execute`'tan geçer; yeni eksenlerin HİÇBİRİ ikinci dispatch yolu açmaz (policy PRE-hook içinde, alt-ajan aynı çekirdeği çağırır). *Kanıt: grep — `.execute(` dışında tool-invoke yok.*
10. **Kalite kapısı:** `tsc --noEmit` ✓ + `vitest run` fresh ✓ her eksen commit'inden önce yeşil. *Kanıt: CI/pre-commit.*

---

*Üretici: ODYSSEY planlama üreteci (chat/agents ekseni). Kaynak: `server.ts:1385-1690` (ReAct loop) + `server/tool-registry.ts` (choke-point) + `server/providers.ts` (multi-backend tool_calls) + `server/agent-events.ts` (SSE tail) + `src/components/{ReactAgentTab,AgentMessage,MultiAgentPipeline}.tsx` + `orchestration/bin/{orchestra,conduct}.ts` + `orchestration/MODEL_SELECTION.json`. odysseus referansı: prompt-özeti (kaynak repo bu oturumda okunmadı — Kör-Nokta A1). Doğrulama tarihi: 2026-07-10.*
